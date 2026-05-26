"""LLM-based knowledge extraction from collision reports."""

import json
import re
import time
from openai import OpenAI

from knowledge.schema import (
    Idea, Insight, Critique, Concept, Relation, CollisionSession, gen_id
)


class KnowledgeExtractor:
    """Extracts structured knowledge from collision history using LLM."""

    def __init__(self, config):
        self.config = config
        self.client = OpenAI(
            api_key=config.api_key,
            base_url=config.base_url,
        )
        self.model = config.model

    def extract_and_store(self, store, session_id: str, topic: str,
                          history: list[dict], synthesis: str, review: str):
        """Full extraction pipeline: analyze collision → store knowledge.
        Uses parallel LLM calls for speed."""
        import concurrent.futures

        print("  📦 Extracting knowledge from collision...")

        # Store reference for cross-session concept matching
        self._store_ref = store

        # Build full text for extraction (truncate to reduce tokens)
        full_text = self._build_full_text(history, synthesis, review)
        text_for_extraction = full_text  # Use full text

        # Step 1: Extract domain (fast, keep sequential)
        domain = self._extract_domain(topic)

        # Steps 2-5: Run in parallel
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            future_ideas = executor.submit(self._extract_ideas, text_for_extraction, topic, session_id, domain)
            future_critiques = executor.submit(self._extract_critiques, text_for_extraction, topic, session_id, domain)
            future_insights = executor.submit(self._extract_insights, text_for_extraction, topic, session_id, domain)
            future_summary = executor.submit(self._extract_summary, topic, synthesis)

            # Collect results
            ideas = future_ideas.result()
            critiques = future_critiques.result()
            insights = future_insights.result()
            summary = future_summary.result()

        # Store ideas, critiques, insights
        if ideas:
            store.add_ideas(ideas)
            print(f"    ✓ {len(ideas)} ideas stored")
        if critiques:
            store.add_critiques(critiques)
            print(f"    ✓ {len(critiques)} critiques stored")
        if insights:
            store.add_insights(insights)
            print(f"    ✓ {len(insights)} insights stored")

        # Extract concepts (depends on ideas/critiques/insights results)
        concepts, relations = self._extract_concepts_and_relations(
            text_for_extraction, topic, session_id, domain, ideas, critiques, insights
        )
        if concepts:
            store.add_concepts(concepts)
            print(f"    ✓ {len(concepts)} concepts stored")
        if relations:
            store.add_relations(relations)
            print(f"    ✓ {len(relations)} relations stored")

        # Store session record
        session = CollisionSession(
            topic=topic,
            summary=summary,
            agent_names=list(set(e["agent"] for e in history)),
            domain=domain,
            id=session_id,
        )

        print(f"  📦 Knowledge extraction complete")

    def _build_full_text(self, history: list[dict], synthesis: str, review: str) -> str:
        """Build full text from collision components."""
        parts = []
        for entry in history:
            r = entry["round"]
            agent = entry["agent"]
            content = entry["content"]
            if isinstance(content, list):
                content = "\n".join(f"  - {c}" for c in content)
            parts.append(f"[Round {r}] {agent}:\n{content}")
        parts.append(f"\n[Final Synthesis]\n{synthesis}")
        parts.append(f"\n[Review]\n{review}")
        return "\n\n".join(parts)

    def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        """Make an LLM call."""
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=4096,
            temperature=0.3,  # Lower temperature for extraction
        )
        return resp.choices[0].message.content

    def _parse_json(self, text: str) -> dict | list | None:
        """Extract JSON from LLM response."""
        # Try to find JSON block
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
        if json_match:
            text = json_match.group(1)
        # Try parsing
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try finding array or object
            for pattern in [r'\[[\s\S]*\]', r'\{[\s\S]*\}']:
                match = re.search(pattern, text)
                if match:
                    try:
                        return json.loads(match.group())
                    except json.JSONDecodeError:
                        continue
        return None

    def _extract_domain(self, topic: str) -> str:
        """Extract domain label from topic."""
        prompt = (
            f"主题：{topic}\n\n"
            "请用1-3个词概括这个主题所属的领域（如：向量搜索、机器学习、网络安全等）。\n"
            "只输出领域名称，不要其他内容。"
        )
        return self._call_llm("你是一个领域分类器。", prompt).strip()

    def _extract_ideas(self, text: str, topic: str, session_id: str,
                       domain: str) -> list[Idea]:
        """Extract core ideas from collision text."""
        system = "你是一个知识提取专家。从讨论文本中提取核心创意/想法。"
        prompt = (
            "从以下碰撞讨论中提取所有被明确提出的核心创意/想法。\n\n"
            f"讨论内容：\n{text[:8000]}\n\n"
            "请以JSON数组格式输出，每个元素包含：\n"
            '- text: 创意的简洁摘要（1-2句话）\n'
            '- agent: 提出者名称（从讨论中提取）\n'
            '- round: 提出的轮次（数字，最终融合阶段记为99）\n\n'
            '只输出JSON数组，不要其他内容。示例：\n'
            '[{"text": "把过滤条件编码进LSH哈希函数", "agent": "挑衅者 Provocateur", "round": 1}]'
        )

        result = self._call_llm(system, prompt)
        parsed = self._parse_json(result)
        if not parsed or not isinstance(parsed, list):
            return []

        ideas = []
        for item in parsed:
            if isinstance(item, dict) and "text" in item:
                ideas.append(Idea(
                    text=item["text"],
                    agent_name=item.get("agent", "unknown"),
                    round=item.get("round", 0),
                    topic=topic,
                    session_id=session_id,
                    domain=domain,
                ))
        return ideas

    def _extract_critiques(self, text: str, topic: str, session_id: str,
                           domain: str) -> list[Critique]:
        """Extract critiques from collision text."""
        system = "你是一个知识提取专家。从讨论文本中提取质疑和反驳。"
        prompt = (
            "从以下碰撞讨论中提取所有有价值的质疑、反驳和风险指出。\n\n"
            f"讨论内容：\n{text[:8000]}\n\n"
            "请以JSON数组格式输出，每个元素包含：\n"
            '- text: 质疑的简洁摘要（1-2句话）\n'
            '- agent: 质疑者名称\n'
            '- severity: 严重程度（"致命" | "可修复" | "轻微"）\n'
            '- target: 被质疑的想法/方向的简短描述\n\n'
            '只输出JSON数组，不要其他内容。'
        )

        result = self._call_llm(system, prompt)
        parsed = self._parse_json(result)
        if not parsed or not isinstance(parsed, list):
            return []

        critiques = []
        for item in parsed:
            if isinstance(item, dict) and "text" in item:
                critiques.append(Critique(
                    text=item["text"],
                    agent_name=item.get("agent", "unknown"),
                    severity=item.get("severity", "轻微"),
                    topic=topic,
                    session_id=session_id,
                    target_idea_summary=item.get("target", ""),
                    domain=domain,
                ))
        return critiques

    def _extract_insights(self, text: str, topic: str, session_id: str,
                          domain: str) -> list[Insight]:
        """Extract synthesized insights from collision text."""
        system = "你是一个知识提取专家。从讨论文本中提取综合性洞见。"
        prompt = (
            "从以下碰撞讨论中提取综合性洞见，包括：最终方案、关键风险、修复方向、验证方法、工程判断。\n\n"
            f"讨论内容：\n{text[:8000]}\n\n"
            "请以JSON数组格式输出，每个元素包含：\n"
            '- text: 洞见的简洁描述（1-2句话）\n'
            '- type: 洞见类型（"方案" | "风险" | "修复" | "方向" | "实验设计"）\n\n'
            '只输出JSON数组，不要其他内容。'
        )

        result = self._call_llm(system, prompt)
        parsed = self._parse_json(result)
        if not parsed or not isinstance(parsed, list):
            return []

        insights = []
        for item in parsed:
            if isinstance(item, dict) and "text" in item:
                insights.append(Insight(
                    text=item["text"],
                    insight_type=item.get("type", "方向"),
                    topic=topic,
                    session_id=session_id,
                    domain=domain,
                ))
        return insights

    def _extract_concepts_and_relations(self, text: str, topic: str,
                                         session_id: str, domain: str,
                                         ideas: list, critiques: list,
                                         insights: list) -> tuple[list, list]:
        """Extract concepts and their relations (including cross-entity relations)."""
        import difflib

        system = "你是一个知识图谱构建专家。从讨论中提取领域概念和概念间关系。"
        prompt = (
            "从以下碰撞讨论中提取关键领域概念，以及概念之间的关系。\n\n"
            f"讨论内容：\n{text[:8000]}\n\n"
            "请以JSON格式输出：\n"
            "{\n"
            '  "concepts": [\n'
            '    {"name": "概念名", "description": "一句话描述"}\n'
            "  ],\n"
            '  "relations": [\n'
            '    {"from": "概念A", "to": "概念B", "relation": "关系类型", "context": "简短说明"}\n'
            "  ]\n"
            "}\n\n"
            '关系类型包括：extends（扩展）、contradicts（矛盾）、combines（组合）、derives_from（衍生）、validates（验证）\n'
            '只输出JSON，不要其他内容。'
        )

        result = self._call_llm(system, prompt)
        parsed = self._parse_json(result)
        if not parsed or not isinstance(parsed, dict):
            return [], []

        concepts = []
        for item in parsed.get("concepts", []):
            if isinstance(item, dict) and "name" in item:
                concepts.append(Concept(
                    name=item["name"],
                    description=item.get("description", ""),
                    domain=domain,
                ))

        # Build concept ID map for current session concepts
        concept_map = {c.name: c.id for c in concepts}

        # Also load existing concepts from knowledge base for cross-session matching
        existing_concepts = {}
        try:
            if hasattr(self, '_store_ref') and self._store_ref:
                for c in self._store_ref.get_all_concepts():
                    cname = c["metadata"].get("name", "")
                    if cname:
                        existing_concepts[cname] = c["id"]
        except Exception:
            pass

        # Merge for fuzzy matching
        all_concept_names = {**concept_map, **existing_concepts}

        def find_concept_id(name: str) -> str | None:
            """Find concept ID with fuzzy matching."""
            # Exact match first
            if name in all_concept_names:
                return all_concept_names[name]
            # Fuzzy match
            matches = difflib.get_close_matches(name, all_concept_names.keys(), n=1, cutoff=0.6)
            if matches:
                return all_concept_names[matches[0]]
            # Substring match
            for existing_name, cid in all_concept_names.items():
                if name in existing_name or existing_name in name:
                    return cid
            return None

        relations = []
        for item in parsed.get("relations", []):
            if isinstance(item, dict) and "from" in item and "to" in item:
                from_id = find_concept_id(item["from"])
                to_id = find_concept_id(item["to"])
                if from_id and to_id:
                    relations.append(Relation(
                        source_type="concept",
                        source_id=from_id,
                        target_type="concept",
                        target_id=to_id,
                        relation=item.get("relation", "extends"),
                        context=item.get("context", ""),
                        session_id=session_id,
                    ))

        # Extract cross-entity relations: idea→concept, critique→idea, insight→idea
        cross_relations = self._extract_cross_entity_relations(
            text, session_id, ideas, critiques, insights, concepts
        )
        relations.extend(cross_relations)

        return concepts, relations

    def _extract_cross_entity_relations(self, text: str, session_id: str,
                                         ideas: list, critiques: list,
                                         insights: list, concepts: list) -> list:
        """Extract relations between ideas, critiques, insights, and concepts."""
        if not (ideas or critiques or insights or concepts):
            return []

        # Build entity lists for LLM reference
        idea_texts = [f"[Idea-{i.id}] {i.text}" for i in ideas[:10]]
        critique_texts = [f"[Critique-{c.id}] {c.text}" for c in critiques[:10]]
        insight_texts = [f"[Insight-{g.id}] {g.text}" for g in insights[:10]]
        concept_texts = [f"[Concept-{c.id}] {c.name}: {c.description}" for c in concepts[:10]]

        entity_list = "\n".join(filter(None, [
            "\n".join(idea_texts) if idea_texts else "",
            "\n".join(critique_texts) if critique_texts else "",
            "\n".join(insight_texts) if insight_texts else "",
            "\n".join(concept_texts) if concept_texts else "",
        ]))

        if not entity_list.strip():
            return []

        system = "你是一个知识图谱构建专家。从讨论中提取实体间的关联关系。"
        prompt = (
            "以下是碰撞讨论中提取的实体列表：\n\n"
            f"{entity_list}\n\n"
            "请分析这些实体之间的关系，输出JSON数组。每条关系包含：\n"
            '- source: 源实体ID（如 Idea-abc123）\n'
            '- target: 目标实体ID\n'
            '- relation: 关系类型\n'
            '- context: 一句话说明\n\n'
            '关系类型：\n'
            '- critiques: 质疑/反驳\n'
            '- extends: 扩展/延伸\n'
            '- combines: 组合/融合\n'
            '- derives_from: 衍生/基于\n'
            '- validates: 验证/支持\n'
            '- contradicts: 矛盾/冲突\n'
            '- involves_concept: 涉及概念\n\n'
            '只输出JSON数组，不要其他内容。示例：\n'
            '[{"source": "Idea-abc123", "target": "Concept-def456", "relation": "involves_concept", "context": "该想法涉及HNSW索引结构"}]'
        )

        result = self._call_llm(system, prompt)
        parsed = self._parse_json(result)
        if not parsed or not isinstance(parsed, list):
            return []

        # Build ID lookup
        id_to_type = {}
        for i in ideas:
            id_to_type[i.id] = "idea"
        for c in critiques:
            id_to_type[c.id] = "critique"
        for g in insights:
            id_to_type[g.id] = "insight"
        for c in concepts:
            id_to_type[c.id] = "concept"

        relations = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            src = item.get("source", "")
            tgt = item.get("target", "")
            # Extract ID from format like "Idea-abc123"
            src_id = src.split("-", 1)[-1] if "-" in src else src
            tgt_id = tgt.split("-", 1)[-1] if "-" in tgt else tgt

            if src_id in id_to_type and tgt_id in id_to_type:
                relations.append(Relation(
                    source_type=id_to_type[src_id],
                    source_id=src_id,
                    target_type=id_to_type[tgt_id],
                    target_id=tgt_id,
                    relation=item.get("relation", "extends"),
                    context=item.get("context", ""),
                    session_id=session_id,
                ))

        return relations

    def _extract_summary(self, topic: str, synthesis: str) -> str:
        """Generate a one-line summary of the collision."""
        prompt = (
            f"主题：{topic}\n\n"
            f"综合方案：\n{synthesis[:2000]}\n\n"
            "请用一句话（不超过50字）概括这次碰撞的核心产出。"
        )
        return self._call_llm("你是一个摘要生成器。", prompt).strip()
