"""FastAPI server with WebSocket streaming for Idea Collision."""

import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from config import Config
from providers import (
    PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL,
    list_models, resolve_agent_config, get_default_base_url
)
from arena import Arena
from report import generate_report

app = FastAPI(title="Idea Collision", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Session store with file persistence
SESSIONS_FILE = Path(__file__).parent / "data" / "sessions.json"
SESSIONS_FILE.parent.mkdir(exist_ok=True)

def _load_sessions() -> dict:
    """Load sessions from disk."""
    if SESSIONS_FILE.exists():
        try:
            with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def _save_session(session_id: str, session: dict):
    """Save a single session to disk (exclude non-serializable fields)."""
    all_sessions = _load_sessions()
    # Only save serializable fields
    save_data = {
        "status": session.get("status", ""),
        "topic": session.get("topic", ""),
        "rounds": session.get("rounds", 4),
        "result": session.get("result"),
        "knowledge_stats": session.get("knowledge_stats"),
    }
    all_sessions[session_id] = save_data
    with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(all_sessions, f, ensure_ascii=False, indent=2)

# Load persisted sessions, then overlay with runtime state
_persisted = _load_sessions()
sessions: dict[str, dict] = {}
for sid, data in _persisted.items():
    sessions[sid] = {
        **data,
        "ws_clients": set(),
        "cancelled": False,
        "events": [],
        "agent_configs": [],
        "global_cfg": {},
        "no_knowledge": False,
        "pdf_session_id": "",
    }


# ── Request/Response Models ──

class AgentOverride(BaseModel):
    id: str
    enabled: bool = True
    model: str = ""
    provider: str = ""
    api_key: str = ""
    base_url: str = ""


class CollisionRequest(BaseModel):
    topic: str
    rounds: int = 4
    agents: list[AgentOverride] = []
    global_api_key: str = ""
    global_provider: str = DEFAULT_PROVIDER
    global_base_url: str = ""
    global_model: str = DEFAULT_MODEL
    no_knowledge: bool = False
    pdf_session_ids: list[str] = []  # Optional: use uploaded PDFs as context


# ── API Routes ──

@app.get("/api/providers")
async def get_providers():
    """List all providers and models."""
    return {"providers": PROVIDERS, "models": list_models()}


@app.post("/api/collision")
async def create_collision(req: CollisionRequest):
    """Start a new collision."""
    session_id = f"coll_{int(time.time())}_{uuid.uuid4().hex[:6]}"

    # Resolve global config
    global_cfg = {
        "provider": req.global_provider,
        "model": req.global_model,
        "api_key": req.global_api_key,
        "base_url": req.global_base_url or get_default_base_url(req.global_provider),
    }

    # Resolve per-agent configs
    agent_configs = []
    for a in req.agents:
        if a.enabled:
            resolved = resolve_agent_config(a.id, a.model_dump(), global_cfg)
            agent_configs.append({"id": a.id, **resolved})

    sessions[session_id] = {
        "status": "running",
        "topic": req.topic,
        "rounds": req.rounds,
        "agent_configs": agent_configs,
        "global_cfg": global_cfg,
        "no_knowledge": req.no_knowledge,
        "pdf_session_ids": req.pdf_session_ids,
        "result": None,
        "ws_clients": set(),
        "cancelled": False,
        "events": [],
        "started_at": time.time(),
        "duration": 0,
    }

    # Run collision in background
    asyncio.create_task(_run_collision(session_id))

    return {"session_id": session_id, "status": "running"}


@app.get("/api/collision/{session_id}")
async def get_collision(session_id: str):
    """Get collision status and result."""
    session = sessions.get(session_id)
    if not session:
        return JSONResponse(status_code=404, content={"error": "Session not found"})

    return {
        "session_id": session_id,
        "status": session["status"],
        "topic": session["topic"],
        "result": session["result"],
    }


@app.delete("/api/collision/{session_id}")
async def cancel_collision(session_id: str):
    """Cancel a running collision."""
    session = sessions.get(session_id)
    if not session:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    session["cancelled"] = True
    return {"status": "cancelled"}


@app.delete("/api/collision/{session_id}/delete")
async def delete_collision(session_id: str):
    """Permanently delete a collision record, report file, and related knowledge."""
    session = sessions.get(session_id)
    if not session:
        return JSONResponse(status_code=404, content={"error": "Session not found"})

    # 1. Delete report file
    result = session.get("result", {})
    report_path = result.get("report_path", "")
    if report_path and os.path.exists(report_path):
        os.remove(report_path)

    # 2. Delete related knowledge from ChromaDB
    try:
        store = get_store()
        _delete_session_knowledge(store, session_id)
    except Exception as e:
        print(f"  ⚠ Failed to delete knowledge: {e}")

    # 3. Remove from sessions dict and save
    del sessions[session_id]
    _save_sessions_to_disk()

    return {"status": "deleted", "session_id": session_id}


def _delete_session_knowledge(store, session_id: str):
    """Delete all knowledge entries related to a session."""
    # Delete ideas
    try:
        results = store.ideas_col.get(where={"session_id": session_id})
        if results and results["ids"]:
            store.ideas_col.delete(ids=results["ids"])
            print(f"    Deleted {len(results['ids'])} ideas")
    except Exception:
        pass

    # Delete insights
    try:
        results = store.insights_col.get(where={"session_id": session_id})
        if results and results["ids"]:
            store.insights_col.delete(ids=results["ids"])
            print(f"    Deleted {len(results['ids'])} insights")
    except Exception:
        pass

    # Delete critiques
    try:
        results = store.critiques_col.get(where={"session_id": session_id})
        if results and results["ids"]:
            store.critiques_col.delete(ids=results["ids"])
            print(f"    Deleted {len(results['ids'])} critiques")
    except Exception:
        pass

    # Delete relations from SQLite
    try:
        store.rel_db.execute("DELETE FROM relations WHERE session_id=?", (session_id,))
        store.rel_db.commit()
    except Exception:
        pass


def _save_sessions_to_disk():
    """Save all current sessions to disk."""
    all_sessions = {}
    for sid, session in sessions.items():
        all_sessions[sid] = {
            "status": session.get("status", ""),
            "topic": session.get("topic", ""),
            "rounds": session.get("rounds", 4),
            "result": session.get("result"),
            "knowledge_stats": session.get("knowledge_stats"),
        }
    with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(all_sessions, f, ensure_ascii=False, indent=2)


@app.get("/api/collisions")
async def list_collisions():
    """List all collision sessions, newest first."""
    result = []
    for sid, s in sessions.items():
        result.append({
            "session_id": sid,
            "topic": s["topic"],
            "status": s["status"],
            "agents": len(s.get("agent_configs", [])),
            "rounds": s["rounds"],
            "started_at": s.get("started_at", 0),
            "duration": s.get("duration", 0),
        })
    # Sort by session_id (contains timestamp) descending - newest first
    result.sort(key=lambda x: x["session_id"], reverse=True)
    return {"collisions": result}


@app.get("/api/knowledge/stats/{session_id}")
async def knowledge_stats(session_id: str):
    """Get knowledge stats for a session."""
    session = sessions.get(session_id)
    if not session:
        return JSONResponse(status_code=404, content={"error": "Session not found"})
    return session.get("knowledge_stats", {})


# ── Export ──

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif; background: #fff; color: #111827; max-width: 900px; margin: 0 auto; padding: 2rem; line-height: 1.75; }}
  h1 {{ font-size: 1.75rem; font-weight: 700; margin: 0 0 0.5rem; }}
  h2 {{ font-size: 1.35rem; font-weight: 600; margin: 2rem 0 0.75rem; color: #f59e0b; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; }}
  h3 {{ font-size: 1.15rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }}
  p {{ margin: 0.5rem 0; }}
  ul, ol {{ margin: 0.5rem 0 0.5rem 1.5rem; }}
  code {{ background: #f3f4f6; padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-size: 0.875rem; }}
  pre {{ background: #1f2937; color: #e5e7eb; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.75rem 0; }}
  pre code {{ background: transparent; padding: 0; }}
  blockquote {{ border-left: 3px solid #f59e0b; padding-left: 1rem; color: #6b7280; margin: 0.75rem 0; }}
  strong {{ font-weight: 600; }}
  hr {{ border: none; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }}
  .meta {{ color: #6b7280; font-size: 0.9rem; margin-bottom: 1.5rem; }}
  .agent-tag {{ display: inline-block; padding: 0.15rem 0.5rem; border-radius: 0.25rem; font-size: 0.8rem; font-weight: 600; margin-right: 0.5rem; }}
  .agent-provocateur {{ background: #fef2f2; color: #ef4444; }}
  .agent-researcher {{ background: #eff6ff; color: #3b82f6; }}
  .agent-critic {{ background: #f5f3ff; color: #8b5cf6; }}
  .agent-connector {{ background: #ecfdf5; color: #10b981; }}
  .agent-experimenter {{ background: #fff7ed; color: #f97316; }}
  .agent-synthesizer {{ background: #ecfeff; color: #06b6d4; }}
  .agent-pragmatist {{ background: #f9fafb; color: #6b7280; }}
  @media print {{ body {{ padding: 1rem; }} }}
</style>
</head>
<body>
{content}
</body>
</html>"""

AGENT_CLASS_MAP = {
    "挑衅者": "provocateur", "Provocateur": "provocateur",
    "研究者": "researcher", "Researcher": "researcher",
    "批评家": "critic", "Critic": "critic",
    "连接者": "connector", "Connector": "connector",
    "实验者": "experimenter", "Experimenter": "experimenter",
    "融合者": "synthesizer", "Synthesizer": "synthesizer",
    "务实者": "pragmatist", "Pragmatist": "pragmatist",
}


def _get_agent_class(agent_name: str) -> str:
    for key, cls in AGENT_CLASS_MAP.items():
        if key in agent_name:
            return cls
    return ""


def _build_raw_md(session: dict) -> str:
    """Build raw markdown from session history - no content modification.
    Falls back to the saved report file if history is empty."""
    result = session.get("result", {})

    # If history is empty but report file exists, read the file directly
    if result and not result.get("history"):
        report_path = result.get("report_path", "")
        if report_path and os.path.exists(report_path):
            with open(report_path, "r", encoding="utf-8") as f:
                return f.read()

    if not result:
        return ""

    topic = result.get("topic", session.get("topic", ""))
    history = result.get("history", [])
    agent_count = len(set(e["agent"] for e in history))
    round_count = len(set(e["round"] for e in history if isinstance(e["round"], int)))

    lines = [
        f"# {topic}",
        "",
        f"智能体数: {agent_count} | 碰撞轮次: {round_count}",
        "",
        "---",
        "",
    ]

    round_names = {
        1: "Round 1: 初始想法生成",
        2: "Round 2: 碰撞交锋",
        3: "Round 3: 碰撞交锋",
        4: "Round 4: 碰撞交锋",
        "final": "最终融合",
        "review": "方案审查",
    }

    for entry in history:
        r = entry["round"]
        agent = entry["agent"]
        content = entry["content"]
        if isinstance(content, list):
            content = "\n".join(f"- {c}" for c in content)

        label = round_names.get(r, f"Round {r}")
        lines.append(f"## {label}")
        lines.append("")
        lines.append(f"**{agent}**")
        lines.append("")
        lines.append(content)
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def _build_raw_html(session: dict) -> str:
    """Build raw HTML from session history - no content modification."""
    import markdown as md_lib

    result = session.get("result", {})
    topic = result.get("topic", session.get("topic", ""))

    # Build raw MD first, then convert
    raw_md = _build_raw_md(session)
    if not raw_md:
        return ""

    # Convert markdown to HTML
    html_content = md_lib.markdown(raw_md, extensions=["fenced_code", "tables"])

    # Add agent color tags
    for agent_name, cls in AGENT_CLASS_MAP.items():
        html_content = html_content.replace(
            f"<strong>{agent_name}",
            f'<span class="agent-tag agent-{cls}">{agent_name}</span><strong>'
        )

    return HTML_TEMPLATE.format(title=topic, content=html_content)


@app.get("/api/collision/{session_id}/export/md")
async def export_md(session_id: str):
    """Export collision as Markdown file."""
    from fastapi.responses import Response
    try:
        session = sessions.get(session_id)
        if not session:
            return JSONResponse(status_code=404, content={"error": "Session not found"})

        content = _build_raw_md(session)
        if not content:
            return JSONResponse(status_code=400, content={"error": "No result to export"})

        topic = session.get("topic", "collision")
        safe_name = topic[:30].replace(" ", "_").replace("/", "_")
        filename = f"collision_{safe_name}.md"
        encoded = quote(filename)

        return Response(
            content=content.encode("utf-8"),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/collision/{session_id}/export/html")
async def export_html(session_id: str):
    """Export collision as HTML file."""
    from fastapi.responses import Response
    try:
        session = sessions.get(session_id)
        if not session:
            return JSONResponse(status_code=404, content={"error": "Session not found"})

        content = _build_raw_html(session)
        if not content:
            return JSONResponse(status_code=400, content={"error": "No result to export"})

        topic = session.get("topic", "collision")
        safe_name = topic[:30].replace(" ", "_").replace("/", "_")
        filename = f"collision_{safe_name}.html"
        encoded = quote(filename)

        return Response(
            content=content.encode("utf-8"),
            media_type="text/html; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


# ── PDF Upload ──

# ── Materials (PDF uploads, persistent) ──

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

MATERIALS_FILE = Path(__file__).parent / "data" / "materials.json"
MATERIALS_FILE.parent.mkdir(exist_ok=True)


def _load_materials() -> dict:
    if MATERIALS_FILE.exists():
        try:
            with open(MATERIALS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_materials(materials: dict):
    with open(MATERIALS_FILE, "w", encoding="utf-8") as f:
        json.dump(materials, f, ensure_ascii=False, indent=2)


materials: dict[str, dict] = _load_materials()

# Global KnowledgeStore singleton (avoids reloading embedding model per request)
_global_store = None
def get_store():
    global _global_store
    if _global_store is None:
        from knowledge.store import KnowledgeStore
        _global_store = KnowledgeStore(Config())
    return _global_store


@app.post("/api/materials/upload")
async def upload_materials(files: list[UploadFile] = File(...)):
    """Upload PDF files → extract → store in knowledge base."""
    from pdf_processor import process_pdf

    store = get_store()
    session_id = f"pdf_{uuid.uuid4().hex[:8]}"
    results = []

    for file in files:
        if not file.filename.lower().endswith(".pdf"):
            results.append({"filename": file.filename, "error": "不是 PDF 文件"})
            continue

        file_path = UPLOAD_DIR / f"{session_id}_{file.filename}"
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        result = process_pdf(str(file_path), file.filename, store, session_id)
        results.append(result)

    # Persist
    for r in results:
        if "error" not in r:
            mid = f"{session_id}_{r['filename']}"
            materials[mid] = {
                "id": mid,
                "session_id": session_id,
                "filename": r["filename"],
                "pages": r.get("pages", 0),
                "chunks_stored": r.get("chunks_stored", 0),
                "text_length": r.get("text_length", 0),
                "text_preview": r.get("text_preview", ""),
                "file_path": str(UPLOAD_DIR / f"{session_id}_{r['filename']}"),
                "uploaded_at": time.time(),
            }
    _save_materials(materials)

    return {"session_id": session_id, "files": results}


@app.get("/api/materials")
async def list_materials():
    """List all uploaded materials."""
    result = sorted(materials.values(), key=lambda x: x.get("uploaded_at", 0), reverse=True)
    return {"materials": result}


@app.delete("/api/materials/{material_id}")
async def delete_material(material_id: str):
    """Delete a material and its knowledge chunks."""
    m = materials.get(material_id)
    if not m:
        return JSONResponse(status_code=404, content={"error": "Material not found"})

    # Delete file
    fp = m.get("file_path", "")
    if fp and os.path.exists(fp):
        os.remove(fp)

    # Delete knowledge chunks from ChromaDB
    try:
        store = get_store()
        session_id = m.get("session_id", "")
        if session_id:
            try:
                results = store.ideas_col.get(where={"session_id": session_id})
                if results and results["ids"]:
                    store.ideas_col.delete(ids=results["ids"])
            except Exception:
                pass
    except Exception:
        pass

    del materials[material_id]
    _save_materials(materials)
    return {"status": "deleted"}


@app.get("/api/materials/{material_id}/preview")
async def preview_material(material_id: str):
    """Preview extracted text of a material."""
    m = materials.get(material_id)
    if not m:
        return JSONResponse(status_code=404, content={"error": "Material not found"})
    return {"filename": m["filename"], "text_preview": m.get("text_preview", "")}


@app.get("/api/materials/search")
async def search_materials(q: str, top_k: int = 5):
    """Search material content."""
    from pdf_processor import search_pdf_content
    store = get_store()
    results = search_pdf_content(q, store, top_k=top_k)
    return {"results": results}


# ── WebSocket ──

@app.websocket("/ws/collision/{session_id}")
async def ws_collision(websocket: WebSocket, session_id: str):
    """WebSocket for real-time collision streaming."""
    await websocket.accept()

    session = sessions.get(session_id)
    if not session:
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return

    session["ws_clients"].add(websocket)

    # Send replay of past events for late-connecting clients
    for event in session["events"]:
        try:
            await websocket.send_json(event)
        except Exception:
            break

    # If already done, send completion
    if session["status"] == "done":
        try:
            await websocket.send_json({"type": "collision_done", "result": session["result"]})
        except Exception:
            pass

    try:
        # Keep alive and listen for cancel
        while session["status"] == "running":
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
                msg = json.loads(data)
                if msg.get("type") == "cancel":
                    session["cancelled"] = True
            except asyncio.TimeoutError:
                continue
            except json.JSONDecodeError:
                continue
    except WebSocketDisconnect:
        pass
    finally:
        session["ws_clients"].discard(websocket)


async def broadcast(session_id: str, event: dict):
    """Broadcast event to all WS clients of a session."""
    session = sessions.get(session_id)
    if not session:
        return
    session["events"].append(event)
    dead = set()
    for ws in session["ws_clients"]:
        try:
            await ws.send_json(event)
        except Exception:
            dead.add(ws)
    session["ws_clients"] -= dead


# ── Collision Runner ──

async def _run_collision(session_id: str):
    """Run collision in background with streaming callbacks."""
    session = sessions[session_id]

    try:
        # Build Config
        config = Config()
        config.num_rounds = session["rounds"]
        config.no_knowledge = session["no_knowledge"]

        # Use global API key if provided
        gcfg = session["global_cfg"]
        if gcfg.get("api_key"):
            config.api_key = gcfg["api_key"]
        if gcfg.get("base_url"):
            config.base_url = gcfg["base_url"]

        # Create arena
        arena = Arena(config)

        # Override agent configs (model, api_key, base_url per agent)
        _override_agent_configs(arena, session["agent_configs"], config)

        topic = session["topic"]

        # Stream callback
        async def on_event(event_type: str, data: dict):
            if session["cancelled"]:
                raise CancelledError()
            event = {"type": event_type, **data}
            await broadcast(session_id, event)

        # Run collision with streaming
        result = await _run_collision_streaming(arena, topic, on_event, session)

        session["status"] = "done"
        session["duration"] = round(time.time() - session.get("started_at", time.time()), 1)
        session["result"] = {
            "session_id": session_id,
            "topic": result["topic"],
            "history": result["history"],
            "synthesis": result["synthesis"],
            "review": result["review"],
        }

        # Save report
        report_path = generate_report(session["result"], config.output_dir)
        session["result"]["report_path"] = report_path

        # Knowledge stats
        stats = arena.get_knowledge_stats()
        if stats:
            session["knowledge_stats"] = stats

        await broadcast(session_id, {"type": "collision_done", "result": session["result"]})
        _save_session(session_id, session)
        arena.close()

    except CancelledError:
        session["status"] = "cancelled"
        session["duration"] = round(time.time() - session.get("started_at", time.time()), 1)
        await broadcast(session_id, {"type": "collision_cancelled"})
        _save_session(session_id, session)
    except Exception as e:
        session["status"] = "error"
        session["error"] = str(e)
        session["duration"] = round(time.time() - session.get("started_at", time.time()), 1)
        await broadcast(session_id, {"type": "error", "message": str(e)})
        _save_session(session_id, session)


class CancelledError(Exception):
    pass


async def _run_collision_streaming(arena, topic, on_event, session):
    """Run collision with async streaming callbacks."""
    config = arena.config
    history = []
    session_id_val = arena.session_id

    # Step 1: Knowledge retrieval
    context_map = {}
    if arena._retriever:
        await on_event("status", {"message": "查询知识库..."})
        context_map = arena._retriever.build_context(topic, arena.agents)
        injected = sum(1 for v in context_map.values() if v)
        await on_event("knowledge_loaded", {"injected": injected, "total": len(arena.agents)})

    # Step 1.5: PDF context injection (multiple PDFs)
    pdf_session_ids = session.get("pdf_session_ids", [])
    if pdf_session_ids:
        await on_event("status", {"message": "检索PDF文档..."})
        from pdf_processor import search_pdf_content
        pdf_results = search_pdf_content(topic, arena._knowledge_store, top_k=8)
        if pdf_results:
            pdf_context = "\n[PDF文档相关内容]\n"
            for i, r in enumerate(pdf_results, 1):
                source = r["metadata"].get("agent_name", "").replace("PDF:", "")
                pdf_context += f'{i}. ({source}) {r["document"][:300]}\n'
            for agent in arena.agents:
                if agent.name in context_map:
                    context_map[agent.name] = pdf_context + "\n" + context_map[agent.name]
                else:
                    context_map[agent.name] = pdf_context
            await on_event("pdf_loaded", {"chunks": len(pdf_results)})

    # Round 1
    await on_event("round_start", {"round": 1})
    for agent in arena.agents:
        if session["cancelled"]:
            raise CancelledError()
        await on_event("agent_start", {"agent": agent.name, "round": 1})

        extra = context_map.get(agent.name, "")

        # Run in thread to avoid blocking
        ideas = await asyncio.get_event_loop().run_in_executor(
            None, agent.generate_ideas, topic, config.ideas_per_agent_round1, extra
        )

        content = "\n".join(f"  - {c}" for c in ideas) if isinstance(ideas, list) else str(ideas)
        for token in _tokenize(content):
            await on_event("agent_token", {"agent": agent.name, "token": token})
            await asyncio.sleep(0.01)  # Small delay for streaming effect

        entry = {"round": 1, "agent": agent.name, "content": ideas}
        history.append(entry)
        arena.history.append(entry)
        await on_event("agent_end", {"agent": agent.name, "round": 1})

    await on_event("round_end", {"round": 1})

    # Rounds 2-N
    for r in range(2, config.num_rounds + 1):
        if session["cancelled"]:
            raise CancelledError()
        await on_event("round_start", {"round": r})
        history_text = _format_history(history)

        for agent in arena.agents:
            if session["cancelled"]:
                raise CancelledError()
            await on_event("agent_start", {"agent": agent.name, "round": r})

            extra = context_map.get(agent.name, "")
            response = await asyncio.get_event_loop().run_in_executor(
                None, agent.respond_to_others, topic, history_text, extra
            )

            for token in _tokenize(response):
                await on_event("agent_token", {"agent": agent.name, "token": token})
                await asyncio.sleep(0.01)

            entry = {"round": r, "agent": agent.name, "content": response}
            history.append(entry)
            arena.history.append(entry)
            await on_event("agent_end", {"agent": agent.name, "round": r})

        await on_event("round_end", {"round": r})

    # Synthesis
    await on_event("status", {"message": "最终融合..."})

    synthesizer = arena.agents[2] if len(arena.agents) > 2 else arena.agents[0]
    for a in arena.agents:
        if "融合" in a.name or "Synthesizer" in a.name:
            synthesizer = a
            break

    synth_context = context_map.get(synthesizer.name, "")
    full_history = _format_history(history)
    synthesis = await asyncio.get_event_loop().run_in_executor(
        None, synthesizer.synthesize, topic, full_history, synth_context
    )
    history.append({"round": "final", "agent": synthesizer.name, "content": synthesis})
    arena.history.append({"round": "final", "agent": synthesizer.name, "content": synthesis})

    for token in _tokenize(synthesis):
        await on_event("agent_token", {"agent": synthesizer.name, "token": token})
        await asyncio.sleep(0.01)
    await on_event("agent_end", {"agent": synthesizer.name, "round": "final"})

    # Review
    await on_event("status", {"message": "方案审查..."})

    critic = arena.agents[1] if len(arena.agents) > 1 else arena.agents[0]
    for a in arena.agents:
        if "批评" in a.name or "Critic" in a.name:
            critic = a
            break

    review_prompt = (
        f"主题：{topic}\n\n"
        f"以下是融合者的综合方案：\n{synthesis}\n\n"
        f"请对这个综合方案做最终审查：指出优点、潜在风险、改进建议。"
    )
    review = await asyncio.get_event_loop().run_in_executor(
        None, critic.chat, [{"role": "user", "content": review_prompt}]
    )
    history.append({"round": "review", "agent": critic.name, "content": review})
    arena.history.append({"round": "review", "agent": critic.name, "content": review})

    for token in _tokenize(review):
        await on_event("agent_token", {"agent": critic.name, "token": token})
        await asyncio.sleep(0.01)
    await on_event("agent_end", {"agent": critic.name, "round": "review"})

    # Knowledge extraction
    if arena._extractor and arena._knowledge_store:
        await on_event("status", {"message": "提取知识..."})
        try:
            await asyncio.get_event_loop().run_in_executor(
                None,
                arena._extractor.extract_and_store,
                arena._knowledge_store, session_id_val, topic,
                history, synthesis, review
            )
            stats = arena._knowledge_store.stats()
            await on_event("knowledge_update", stats)
        except Exception as e:
            await on_event("status", {"message": f"知识提取失败: {e}"})

    return {
        "topic": topic,
        "session_id": session_id_val,
        "history": history,
        "synthesis": synthesis,
        "review": review,
    }


def _override_agent_configs(arena, agent_configs, base_config):
    """Override agent LLM configs."""
    for ac in agent_configs:
        for agent in arena.agents:
            # Match by module name (lowercase)
            agent_key = agent.name.split()[0]  # e.g., "挑衅者" from "挑衅者 Provocateur"
            if ac["id"] == agent_key or ac["id"].lower() in agent.name.lower():
                if ac.get("api_key") and ac.get("base_url"):
                    from openai import OpenAI
                    agent.client = OpenAI(
                        api_key=ac["api_key"],
                        base_url=ac["base_url"],
                    )
                if ac.get("model"):
                    agent.model = ac["model"]
                break


def _format_history(history: list[dict]) -> str:
    lines = []
    for entry in history:
        r = entry["round"]
        agent = entry["agent"]
        content = entry["content"]
        if isinstance(content, list):
            content = "\n".join(f"  - {c}" for c in content)
        lines.append(f"[Round {r}] {agent}:\n{content}")
    return "\n\n".join(lines)


def _tokenize(text: str):
    """Split text into small chunks for streaming."""
    # Stream by sentence or paragraph for natural feel
    import re
    # Split by sentence endings or newlines
    parts = re.split(r'(?<=[。\n！？.!?])\s*', text)
    for part in parts:
        if part.strip():
            yield part + " "


# ── Serve Frontend ──

WEB_DIR = Path(__file__).parent / "web" / "dist"

if WEB_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(WEB_DIR / "assets")), name="assets")

    @app.get("/{path:path}")
    async def serve_spa(path: str):
        file_path = WEB_DIR / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(WEB_DIR / "index.html"))
else:
    @app.get("/")
    async def root():
        return {"message": "Idea Collision API v2.0", "docs": "/docs"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
