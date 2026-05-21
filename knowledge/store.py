"""ChromaDB-backed knowledge store."""

import os
import sqlite3
import time
from typing import Optional

# Use HuggingFace mirror for China
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

import chromadb

from knowledge.schema import (
    Idea, Insight, Critique, Concept, Relation, CollisionSession, gen_id
)


# Collection names
COLLECTION_IDEAS = "ideas"
COLLECTION_INSIGHTS = "insights"
COLLECTION_CRITIQUES = "critiques"
COLLECTION_CONCEPTS = "concepts"

ALL_COLLECTIONS = [COLLECTION_IDEAS, COLLECTION_INSIGHTS, COLLECTION_CRITIQUES, COLLECTION_CONCEPTS]


class KnowledgeStore:
    """Persistent knowledge store using ChromaDB (vectors) + SQLite (relations).

    Uses ChromaDB's built-in embedding function by default.
    Supports optional custom embedding function via config.embedding_model.
    """

    def __init__(self, config):
        self.config = config
        db_path = os.path.expanduser(config.knowledge_db_path)
        os.makedirs(db_path, exist_ok=True)

        # ChromaDB client
        self.client = chromadb.PersistentClient(path=db_path)

        # Try to load custom embedding model (sentence-transformers)
        self._custom_embed_fn = None
        if config.embedding_model and config.embedding_model != "default":
            try:
                from sentence_transformers import SentenceTransformer
                print(f"  Loading embedding model: {config.embedding_model} ...")
                model = SentenceTransformer(config.embedding_model)
                dim = model.get_sentence_embedding_dimension()
                print(f"  Embedding model loaded (dim={dim})")

                def embed_fn(texts):
                    return model.encode(texts, normalize_embeddings=True).tolist()

                self._custom_embed_fn = embed_fn
            except ImportError:
                print("  sentence-transformers not installed, using ChromaDB default embedding")
            except Exception as e:
                print(f"  Failed to load embedding model: {e}, using ChromaDB default")

        if not self._custom_embed_fn:
            print("  Using ChromaDB default embedding function")

        # Create collections
        # ChromaDB default embedding is configured per-collection
        self.ideas_col = self.client.get_or_create_collection(COLLECTION_IDEAS)
        self.insights_col = self.client.get_or_create_collection(COLLECTION_INSIGHTS)
        self.critiques_col = self.client.get_or_create_collection(COLLECTION_CRITIQUES)
        self.concepts_col = self.client.get_or_create_collection(COLLECTION_CONCEPTS)

        # SQLite for relations
        relations_path = os.path.expanduser(config.relations_db_path)
        os.makedirs(os.path.dirname(relations_path), exist_ok=True)
        self.rel_db = sqlite3.connect(relations_path)
        self._init_relations_table()

    def _init_relations_table(self):
        """Create relations table if not exists."""
        self.rel_db.execute("""
            CREATE TABLE IF NOT EXISTS relations (
                id TEXT PRIMARY KEY,
                source_type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                relation TEXT NOT NULL,
                context TEXT DEFAULT '',
                session_id TEXT DEFAULT '',
                timestamp REAL NOT NULL
            )
        """)
        self.rel_db.execute("""
            CREATE INDEX IF NOT EXISTS idx_rel_source ON relations(source_type, source_id)
        """)
        self.rel_db.execute("""
            CREATE INDEX IF NOT EXISTS idx_rel_target ON relations(target_type, target_id)
        """)
        self.rel_db.execute("""
            CREATE INDEX IF NOT EXISTS idx_rel_session ON relations(session_id)
        """)
        self.rel_db.commit()

    def _add_to_collection(self, collection, ids, documents, metadatas):
        """Add documents to a collection, using custom or default embedding."""
        if self._custom_embed_fn:
            embeddings = self._custom_embed_fn(documents)
            collection.add(ids=ids, documents=documents, embeddings=embeddings, metadatas=metadatas)
        else:
            collection.add(ids=ids, documents=documents, metadatas=metadatas)

    def _query_collection(self, collection, query_text, n_results, where=None):
        """Query a collection, using custom or default embedding."""
        kwargs = {"query_texts": [query_text], "n_results": n_results}
        if where:
            kwargs["where"] = where
        if self._custom_embed_fn:
            kwargs["query_embeddings"] = self._custom_embed_fn([query_text])
            del kwargs["query_texts"]
        return collection.query(**kwargs)

    # ── Ideas ──

    def add_idea(self, idea: Idea):
        """Store an idea."""
        self._add_to_collection(
            self.ideas_col,
            ids=[idea.id],
            documents=[idea.text],
            metadatas=[{
                "session_id": idea.session_id,
                "agent_name": idea.agent_name,
                "round": idea.round,
                "topic": idea.topic,
                "domain": idea.domain,
                "timestamp": idea.timestamp,
            }]
        )

    def add_ideas(self, ideas: list[Idea]):
        """Batch store ideas."""
        if not ideas:
            return
        self._add_to_collection(
            self.ideas_col,
            ids=[i.id for i in ideas],
            documents=[i.text for i in ideas],
            metadatas=[{
                "session_id": i.session_id,
                "agent_name": i.agent_name,
                "round": i.round,
                "topic": i.topic,
                "domain": i.domain,
                "timestamp": i.timestamp,
            } for i in ideas]
        )

    def search_ideas(self, query: str, top_k: int = 5,
                     domain: str = None, agent_name: str = None) -> list[dict]:
        """Semantic search for ideas."""
        return self._search(self.ideas_col, query, top_k, domain=domain, agent_name=agent_name)

    # ── Insights ──

    def add_insight(self, insight: Insight):
        """Store an insight."""
        self._add_to_collection(
            self.insights_col,
            ids=[insight.id],
            documents=[insight.text],
            metadatas=[{
                "session_id": insight.session_id,
                "insight_type": insight.insight_type,
                "topic": insight.topic,
                "domain": insight.domain,
                "timestamp": insight.timestamp,
            }]
        )

    def add_insights(self, insights: list[Insight]):
        """Batch store insights."""
        if not insights:
            return
        self._add_to_collection(
            self.insights_col,
            ids=[i.id for i in insights],
            documents=[i.text for i in insights],
            metadatas=[{
                "session_id": i.session_id,
                "insight_type": i.insight_type,
                "topic": i.topic,
                "domain": i.domain,
                "timestamp": i.timestamp,
            } for i in insights]
        )

    def search_insights(self, query: str, top_k: int = 3,
                        domain: str = None, insight_type: str = None) -> list[dict]:
        """Semantic search for insights."""
        return self._search(self.insights_col, query, top_k,
                            domain=domain, insight_type=insight_type)

    # ── Critiques ──

    def add_critique(self, critique: Critique):
        """Store a critique."""
        self._add_to_collection(
            self.critiques_col,
            ids=[critique.id],
            documents=[critique.text],
            metadatas=[{
                "session_id": critique.session_id,
                "agent_name": critique.agent_name,
                "severity": critique.severity,
                "topic": critique.topic,
                "domain": critique.domain,
                "target_idea_summary": critique.target_idea_summary,
                "timestamp": critique.timestamp,
            }]
        )

    def add_critiques(self, critiques: list[Critique]):
        """Batch store critiques."""
        if not critiques:
            return
        self._add_to_collection(
            self.critiques_col,
            ids=[c.id for c in critiques],
            documents=[c.text for c in critiques],
            metadatas=[{
                "session_id": c.session_id,
                "agent_name": c.agent_name,
                "severity": c.severity,
                "topic": c.topic,
                "domain": c.domain,
                "target_idea_summary": c.target_idea_summary,
                "timestamp": c.timestamp,
            } for c in critiques]
        )

    def search_critiques(self, query: str, top_k: int = 3,
                         domain: str = None, severity: str = None) -> list[dict]:
        """Semantic search for critiques."""
        return self._search(self.critiques_col, query, top_k,
                            domain=domain, severity=severity)

    # ── Concepts ──

    def add_concept(self, concept: Concept):
        """Store or update a concept."""
        doc_text = concept.name + ": " + concept.description

        # Check if concept already exists
        existing = self.concepts_col.get(where={"name": concept.name})
        if existing and existing["ids"]:
            doc_id = existing["ids"][0]
            meta = existing["metadatas"][0]
            meta["mention_count"] = meta.get("mention_count", 0) + 1
            meta["last_seen"] = time.time()
            if concept.description:
                meta["description"] = concept.description
            self.concepts_col.update(
                ids=[doc_id],
                documents=[doc_text],
                metadatas=[meta]
            )
        else:
            self._add_to_collection(
                self.concepts_col,
                ids=[concept.id],
                documents=[doc_text],
                metadatas=[{
                    "name": concept.name,
                    "domain": concept.domain,
                    "mention_count": 1,
                    "first_seen": concept.first_seen,
                    "last_seen": concept.last_seen,
                }]
            )

    def add_concepts(self, concepts: list[Concept]):
        """Batch store/update concepts."""
        for c in concepts:
            self.add_concept(c)

    def search_concepts(self, query: str, top_k: int = 5,
                        domain: str = None) -> list[dict]:
        """Semantic search for concepts."""
        return self._search(self.concepts_col, query, top_k, domain=domain)

    def get_concepts_by_name(self, names: list[str]) -> list[dict]:
        """Get concepts by exact name match."""
        if not names:
            return []
        results = []
        for name in names:
            res = self.concepts_col.get(where={"name": name})
            if res and res["ids"]:
                for i, doc_id in enumerate(res["ids"]):
                    results.append({
                        "id": doc_id,
                        "document": res["documents"][i],
                        "metadata": res["metadatas"][i],
                    })
        return results

    # ── Relations (SQLite) ──

    def add_relation(self, relation: Relation):
        """Store a relation."""
        self.rel_db.execute(
            """INSERT INTO relations (id, source_type, source_id, target_type,
               target_id, relation, context, session_id, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (relation.id, relation.source_type, relation.source_id,
             relation.target_type, relation.target_id, relation.relation,
             relation.context, relation.session_id, relation.timestamp)
        )
        self.rel_db.commit()

    def add_relations(self, relations: list[Relation]):
        """Batch store relations."""
        if not relations:
            return
        self.rel_db.executemany(
            """INSERT INTO relations (id, source_type, source_id, target_type,
               target_id, relation, context, session_id, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [(r.id, r.source_type, r.source_id, r.target_type, r.target_id,
              r.relation, r.context, r.session_id, r.timestamp) for r in relations]
        )
        self.rel_db.commit()

    def get_relations_for(self, entity_type: str, entity_id: str,
                          direction: str = "both") -> list[dict]:
        """Get all relations involving an entity."""
        rows = []
        if direction in ("outgoing", "both"):
            cur = self.rel_db.execute(
                "SELECT * FROM relations WHERE source_type=? AND source_id=?",
                (entity_type, entity_id)
            )
            rows.extend(self._rows_to_dicts(cur))
        if direction in ("incoming", "both"):
            cur = self.rel_db.execute(
                "SELECT * FROM relations WHERE target_type=? AND target_id=?",
                (entity_type, entity_id)
            )
            rows.extend(self._rows_to_dicts(cur))
        return rows

    def get_session_relations(self, session_id: str) -> list[dict]:
        """Get all relations from a session."""
        cur = self.rel_db.execute(
            "SELECT * FROM relations WHERE session_id=?", (session_id,)
        )
        return self._rows_to_dicts(cur)

    # ── Stats ──

    def stats(self) -> dict:
        """Return collection statistics."""
        return {
            "ideas": self.ideas_col.count(),
            "insights": self.insights_col.count(),
            "critiques": self.critiques_col.count(),
            "concepts": self.concepts_col.count(),
            "relations": self.rel_db.execute("SELECT COUNT(*) FROM relations").fetchone()[0],
        }

    # ── Internal ──

    def _search(self, collection, query: str, top_k: int, **filters) -> list[dict]:
        """Generic semantic search with optional metadata filters."""
        if collection.count() == 0:
            return []

        # Build where clause
        where = {}
        for key, val in filters.items():
            if val is not None:
                where[key] = val

        n = min(top_k, collection.count())
        results = self._query_collection(collection, query, n, where=where if where else None)

        items = []
        for i in range(len(results["ids"][0])):
            items.append({
                "id": results["ids"][0][i],
                "document": results["documents"][0][i],
                "metadata": results["metadatas"][0][i],
                "distance": results["distances"][0][i] if results.get("distances") else None,
            })
        return items

    def _rows_to_dicts(self, cursor) -> list[dict]:
        """Convert SQLite cursor rows to dicts."""
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def close(self):
        """Close connections."""
        self.rel_db.close()
