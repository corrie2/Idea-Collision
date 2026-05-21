"""Knowledge retriever with role-specific context injection."""

from typing import Optional


# Role-specific retrieval strategies
ROLE_STRATEGIES = {
    "挑衅者 Provocateur": {
        "description": "被否决但有潜力的疯狂想法",
        "idea_filter": {"agent_name": "挑衅者 Provocateur"},
        "critique_severity": "可修复",  # Not fatal, might be worth revisiting
        "focus": "ideas",
        "extra": "重点关注：过去被批评家评为'可修复'但未被充分探索的创意。",
    },
    "研究者 Researcher": {
        "description": "已有研究和领域知识",
        "focus": "concepts",
        "extra": "重点关注：过去讨论中涉及的论文、算法、系统等已有工作。",
    },
    "批评家 Critic": {
        "description": "已知风险和致命缺陷",
        "focus": "critiques",
        "critique_severity": None,  # All severities
        "extra": "重点关注：过去发现的致命缺陷模式和已证明不可行的方向。",
    },
    "连接者 Connector": {
        "description": "跨域类比和概念映射",
        "focus": "ideas",  # Cross-domain ideas
        "extra": "重点关注：过去成功的跨域类比和不同领域概念之间的映射关系。",
    },
    "实验者 Experimenter": {
        "description": "验证实验设计",
        "focus": "insights",
        "insight_type": "实验设计",
        "extra": "重点关注：过去设计的验证实验方案和已知有效的评估指标。",
    },
    "融合者 Synthesizer": {
        "description": "成功的融合模式",
        "focus": "insights",
        "insight_type": "方案",
        "extra": "重点关注：过去成功的融合方案和被证明有协同效应的组合。",
    },
    "务实者 Pragmatist": {
        "description": "工程落地方案和评估",
        "focus": "insights",
        "extra": "重点关注：过去评估过的落地方案、可行性评分和已知的工程陷阱。",
    },
}


class KnowledgeRetriever:
    """Retrieves relevant knowledge for each agent before collision."""

    def __init__(self, store, config):
        self.store = store
        self.config = config
        self.top_k = config.knowledge_top_k

    def build_context(self, topic: str, agents: list) -> dict[str, str]:
        """Build role-specific context for all agents.

        Returns: {agent_name: context_string}
        """
        if self.config.no_knowledge:
            return {agent.name: "" for agent in agents}

        stats = self.store.stats()
        total = sum(stats.values())
        if total == 0:
            return {agent.name: "" for agent in agents}

        contexts = {}
        for agent in agents:
            strategy = ROLE_STRATEGIES.get(agent.name)
            if strategy:
                context = self._build_agent_context(topic, strategy)
            else:
                context = self._build_default_context(topic)
            contexts[agent.name] = context

        return contexts

    def _build_agent_context(self, topic: str, strategy: dict) -> str:
        """Build context for a specific agent role."""
        parts = []
        focus = strategy.get("focus", "all")

        # Always search ideas
        if focus in ("ideas", "all"):
            ideas = self.store.search_ideas(topic, top_k=self.top_k)
            if ideas:
                parts.append("[相关历史创意]")
                for i, item in enumerate(ideas, 1):
                    agent = item["metadata"].get("agent_name", "")
                    critique_note = ""
                    # Check if this idea was critiqued
                    related_critiques = self.store.search_critiques(
                        item["document"][:100], top_k=1
                    )
                    if related_critiques:
                        sev = related_critiques[0]["metadata"].get("severity", "")
                        if sev:
                            critique_note = f" ({sev})"
                    parts.append(f'{i}. "{item["document"]}" — {agent}{critique_note}')

        # Search insights
        if focus in ("insights", "all"):
            insight_type = strategy.get("insight_type")
            insights = self.store.search_insights(
                topic, top_k=self.top_k, insight_type=insight_type
            )
            if insights:
                parts.append("\n[相关历史洞见]")
                for i, item in enumerate(insights, 1):
                    itype = item["metadata"].get("insight_type", "")
                    parts.append(f'{i}. [{itype}] {item["document"]}')

        # Search critiques
        if focus in ("critiques", "all"):
            severity = strategy.get("critique_severity")
            critiques = self.store.search_critiques(
                topic, top_k=self.top_k, severity=severity
            )
            if critiques:
                parts.append("\n[已知风险与缺陷]")
                for i, item in enumerate(critiques, 1):
                    sev = item["metadata"].get("severity", "")
                    parts.append(f'{i}. [{sev}] {item["document"]}')

        # Search concepts
        if focus in ("concepts", "all"):
            concepts = self.store.search_concepts(topic, top_k=self.top_k)
            if concepts:
                parts.append("\n[相关领域概念]")
                for i, item in enumerate(concepts, 1):
                    name = item["metadata"].get("name", "")
                    count = item["metadata"].get("mention_count", 1)
                    parts.append(f'{i}. {name} (历史讨论 {count} 次)')

        # Add role-specific extra note
        extra = strategy.get("extra", "")
        if extra and parts:
            parts.append(f"\n提示：{extra}")

        if not parts:
            return ""

        return "\n".join(parts)

    def _build_default_context(self, topic: str) -> str:
        """Build default context for agents without specific strategy."""
        parts = []

        ideas = self.store.search_ideas(topic, top_k=3)
        if ideas:
            parts.append("[相关历史创意]")
            for i, item in enumerate(ideas, 1):
                parts.append(f'{i}. {item["document"]}')

        insights = self.store.search_insights(topic, top_k=2)
        if insights:
            parts.append("\n[相关历史洞见]")
            for i, item in enumerate(insights, 1):
                parts.append(f'{i}. {item["document"]}')

        return "\n".join(parts) if parts else ""
