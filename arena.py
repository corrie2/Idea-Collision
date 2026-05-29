"""Arena - the collision orchestrator with knowledge base integration."""

import time
from config import Config
from agents import discover_agents


class Arena:
    """Orchestrates the idea collision process with knowledge base."""

    def __init__(self, config: Config):
        self.config = config
        self.agents = discover_agents(config)
        self.history: list[dict] = []  # [{round, agent, content}]
        self.session_id = f"session_{int(time.time())}_{id(self) % 10000:04d}"
        self.last_score = None  # CollisionScore from last evaluation

        # Knowledge base (lazy init to skip if --no-knowledge)
        self._knowledge_store = None
        self._retriever = None
        self._extractor = None

        if not config.no_knowledge:
            self._init_knowledge()

    def _init_knowledge(self):
        """Initialize knowledge base components."""
        try:
            from knowledge.store import KnowledgeStore
            from knowledge.retriever import KnowledgeRetriever
            from knowledge.extractor import KnowledgeExtractor

            self._knowledge_store = KnowledgeStore(self.config)
            self._retriever = KnowledgeRetriever(self._knowledge_store, self.config)
            self._extractor = KnowledgeExtractor(self.config)
            self._extractor._store_ref = self._knowledge_store
            print("   Knowledge base initialized")
        except Exception as e:
            print(f"   Knowledge base init failed: {e}")
            print("   Running without knowledge base")
            self._knowledge_store = None

    def run(self, topic: str) -> dict:
        """Run the full collision process. Returns structured result."""
        print(f"\n{'='*60}")
        print(f"   Idea Collision: {topic}")
        print(f"  Agents: {len(self.agents)} | Rounds: {self.config.num_rounds}")
        agent_names = [a.name for a in self.agents]
        print(f"  Team: {', '.join(agent_names)}")
        if self._knowledge_store:
            stats = self._knowledge_store.stats()
            total = sum(stats.values())
            print(f"  Knowledge: {total} entries ({stats})")
        else:
            print(f"  Knowledge: disabled")
        print(f"{'='*60}\n")

        # Step 1: Retrieve relevant knowledge for each agent
        context_map = {}
        if self._retriever:
            print("   Querying knowledge base...")
            context_map = self._retriever.build_context(topic, self.agents)
            injected = sum(1 for v in context_map.values() if v)
            if injected:
                print(f"   Knowledge injected for {injected}/{len(self.agents)} agents")
            else:
                print(f"   No relevant knowledge found (first collision on this topic?)")

        # Round 1: Each agent generates initial ideas
        print(f"\n Round 1: 初始想法生成")
        round1_ideas = {}
        for agent in self.agents:
            extra = context_map.get(agent.name, "")
            ideas = agent.generate_ideas(topic, self.config.ideas_per_agent_round1, extra, round_num=1)
            round1_ideas[agent.name] = ideas
            entry = {"round": 1, "agent": agent.name, "content": ideas}
            self.history.append(entry)
            print(f"   {agent.name}: {len(ideas)} 个想法")

        # Rounds 2-N: Collision rounds
        for r in range(2, self.config.num_rounds + 1):
            print(f"\n Round {r}: 碰撞交锋")
            history_text = self._format_history()

            for agent in self.agents:
                extra = context_map.get(agent.name, "")
                response = agent.respond_to_others(topic, history_text, extra, round_num=r)
                entry = {"round": r, "agent": agent.name, "content": response}
                self.history.append(entry)
                preview = response[:60].replace('\n', ' ') + "..."
                print(f"   {agent.name}: {preview}")

        # Final: Synthesizer produces synthesis
        print(f"\n 最终融合")
        synthesizer = self.agents[2] if len(self.agents) > 2 else self.agents[0]
        # Find synthesizer by name if possible
        for a in self.agents:
            if "融合" in a.name or "Synthesizer" in a.name:
                synthesizer = a
                break

        synth_context = context_map.get(synthesizer.name, "")
        full_history = self._format_history()
        synthesis = synthesizer.synthesize(topic, full_history, synth_context)
        self.history.append({"round": "final", "agent": synthesizer.name, "content": synthesis})

        # Critic reviews synthesis
        critic = self.agents[1] if len(self.agents) > 1 else self.agents[0]
        for a in self.agents:
            if "批评" in a.name or "Critic" in a.name:
                critic = a
                break

        review_prompt = (
            f"主题：{topic}\n\n"
            f"以下是融合者的综合方案：\n{synthesis}\n\n"
            f"请对这个综合方案做最终审查：指出优点、潜在风险、改进建议。"
        )
        review = critic.chat([{"role": "user", "content": review_prompt}])
        self.history.append({"round": "review", "agent": critic.name, "content": review})

        print(f"\n{'='*60}")
        print(f"   碰撞完成！共 {len(self.history)} 条记录")
        print(f"{'='*60}\n")

        # Step 5: Extract and store knowledge
        if self._extractor and self._knowledge_store:
            try:
                self._extractor.extract_and_store(
                    store=self._knowledge_store,
                    session_id=self.session_id,
                    topic=topic,
                    history=self.history,
                    synthesis=synthesis,
                    review=review,
                )
            except Exception as e:
                print(f"   Knowledge extraction failed: {e}")

        # Step 6: Evaluate collision quality
        try:
            from evaluator import CollisionEvaluator
            evaluator = CollisionEvaluator(self.config)
            self.last_score = evaluator.evaluate(
                topic=topic,
                history=self.history,
                synthesis=synthesis,
                review=review,
                knowledge_store=self._knowledge_store,
            )
            print(evaluator.format_score(self.last_score))
        except Exception as e:
            print(f"   Quality evaluation failed: {e}")

        return {
            "topic": topic,
            "session_id": self.session_id,
            "history": self.history,
            "synthesis": synthesis,
            "review": review,
            "score": self.last_score,
        }

    def _format_history(self) -> str:
        """Format collision history into readable text."""
        lines = []
        for entry in self.history:
            r = entry["round"]
            agent = entry["agent"]
            content = entry["content"]
            if isinstance(content, list):
                content = "\n".join(f"  - {c}" for c in content)
            lines.append(f"[Round {r}] {agent}:\n{content}")
        return "\n\n".join(lines)

    def get_knowledge_stats(self) -> dict | None:
        """Return knowledge base statistics."""
        if self._knowledge_store:
            return self._knowledge_store.stats()
        return None

    def search_knowledge(self, query: str, top_k: int = 5) -> dict | None:
        """Search the knowledge base."""
        if not self._knowledge_store:
            return None
        return {
            "ideas": self._knowledge_store.search_ideas(query, top_k),
            "insights": self._knowledge_store.search_insights(query, top_k),
            "critiques": self._knowledge_store.search_critiques(query, top_k),
            "concepts": self._knowledge_store.search_concepts(query, top_k),
        }

    def close(self):
        """Clean up resources."""
        if self._knowledge_store:
            self._knowledge_store.close()
