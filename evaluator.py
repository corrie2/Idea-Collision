"""Collision quality evaluator - multi-dimensional automatic scoring."""

import re
import time
from dataclasses import dataclass, field
from openai import OpenAI


@dataclass
class CollisionScore:
    """Quality scores for a collision session."""
    novelty: float = 0.0       # 1-10: how different from existing knowledge
    depth: float = 0.0         # 1-10: how deep the discussion went
    diversity: float = 0.0     # 1-10: how different agents' perspectives were
    feasibility: float = 0.0   # 1-10: pragmatist's average score
    intensity: float = 0.0     # 1-10: how much agents cross-referenced each other
    overall: float = 0.0       # Weighted average
    details: dict = field(default_factory=dict)  # Per-dimension details
    timestamp: float = field(default_factory=time.time)


class CollisionEvaluator:
    """Evaluates collision quality across multiple dimensions."""

    def __init__(self, config):
        self.config = config
        self.client = OpenAI(
            api_key=config.api_key,
            base_url=config.base_url,
        )
        self.model = config.model

    def evaluate(self, topic: str, history: list[dict],
                 synthesis: str, review: str,
                 knowledge_store=None) -> CollisionScore:
        """Run full evaluation pipeline."""
        score = CollisionScore()

        # 1. Novelty: compare with existing knowledge
        if knowledge_store:
            score.novelty, score.details["novelty"] = self._eval_novelty(
                synthesis, knowledge_store
            )
        else:
            score.novelty = 5.0
            score.details["novelty"] = "无知识库，使用默认分数"

        # 2. Depth: LLM evaluation
        score.depth, score.details["depth"] = self._eval_depth(
            topic, synthesis, review
        )

        # 3. Diversity: inter-agent perspective difference
        score.diversity, score.details["diversity"] = self._eval_diversity(
            history
        )

        # 4. Feasibility: extract pragmatist scores
        score.feasibility, score.details["feasibility"] = self._eval_feasibility(
            history
        )

        # 5. Collision intensity: cross-reference frequency
        score.intensity, score.details["intensity"] = self._eval_intensity(
            history
        )

        # Overall: weighted average
        weights = {
            "novelty": 0.25,
            "depth": 0.25,
            "diversity": 0.2,
            "feasibility": 0.15,
            "intensity": 0.15,
        }
        score.overall = (
            score.novelty * weights["novelty"] +
            score.depth * weights["depth"] +
            score.diversity * weights["diversity"] +
            score.feasibility * weights["feasibility"] +
            score.intensity * weights["intensity"]
        )

        return score

    def _eval_novelty(self, synthesis: str, store) -> tuple[float, str]:
        """Evaluate novelty by comparing with existing knowledge."""
        try:
            # Search for similar ideas in knowledge base
            similar = store.search_ideas(synthesis[:500], top_k=5)
            if not similar:
                return 8.0, "知识库中无相似内容，新颖性高"

            # Calculate average distance (lower distance = more similar = lower novelty)
            distances = [item.get("distance", 1.0) for item in similar if item.get("distance")]
            if not distances:
                return 7.0, "无法计算语义距离"

            avg_dist = sum(distances) / len(distances)
            # ChromaDB distance is typically 0-2 for cosine, lower = more similar
            # Map to novelty score: high distance = high novelty
            novelty = min(10, max(1, avg_dist * 5))
            return round(novelty, 1), f"与知识库最相似的5条内容平均距离: {avg_dist:.3f}"
        except Exception as e:
            return 5.0, f"新颖性评估失败: {e}"

    def _eval_depth(self, topic: str, synthesis: str, review: str) -> tuple[float, str]:
        """Evaluate discussion depth using LLM."""
        try:
            prompt = (
                f"主题：{topic}\n\n"
                f"综合方案：\n{synthesis[:2000]}\n\n"
                f"审查意见：\n{review[:1000]}\n\n"
                "请评估这次讨论的深度，从1-10打分：\n"
                "- 1-3分：停留在表面，缺乏技术细节\n"
                "- 4-6分：有一定深度，但缺乏关键分析\n"
                "- 7-8分：深入到机制/原理层面，有具体的技术方案\n"
                "- 9-10分：达到了学术论文级别的深度分析\n\n"
                "请只输出一个JSON对象：{\"score\": 数字, \"reason\": \"一句话理由\"}"
            )

            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "你是一个讨论质量评估专家。只输出JSON。"},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=200,
                temperature=0.3,
            )
            content = resp.choices[0].message.content
            # Parse JSON
            import json
            match = re.search(r'\{[^}]+\}', content)
            if match:
                data = json.loads(match.group())
                return float(data.get("score", 5)), data.get("reason", "")
            return 5.0, "LLM返回格式异常"
        except Exception as e:
            return 5.0, f"深度评估失败: {e}"

    def _eval_diversity(self, history: list[dict]) -> tuple[float, str]:
        """Evaluate how diverse agents' perspectives were."""
        # Collect each agent's Round 1 content
        round1_content = {}
        for entry in history:
            if entry["round"] == 1:
                content = entry["content"]
                if isinstance(content, list):
                    content = " ".join(content)
                round1_content[entry["agent"]] = content

        if len(round1_content) < 2:
            return 5.0, "参与agent不足，无法评估多样性"

        # Calculate pairwise content similarity using LLM
        try:
            agents = list(round1_content.keys())
            contents = [round1_content[a][:300] for a in agents]

            prompt = (
                "以下是不同智能体对同一主题的初始想法：\n\n"
            )
            for i, (agent, content) in enumerate(zip(agents, contents)):
                prompt += f"【{agent}】：{content}\n\n"

            prompt += (
                "请评估这些智能体观点的多样性，从1-10打分：\n"
                "- 1-3分：观点高度雷同，缺乏差异化\n"
                "- 4-6分：有一些差异，但核心思路相似\n"
                "- 7-8分：观点明显不同，各有独特视角\n"
                "- 9-10分：观点截然不同，覆盖了完全不同的维度\n\n"
                "请只输出一个JSON对象：{\"score\": 数字, \"reason\": \"一句话理由\"}"
            )

            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "你是一个讨论质量评估专家。只输出JSON。"},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=200,
                temperature=0.3,
            )
            content = resp.choices[0].message.content
            import json
            match = re.search(r'\{[^}]+\}', content)
            if match:
                data = json.loads(match.group())
                return float(data.get("score", 5)), data.get("reason", "")
            return 5.0, "LLM返回格式异常"
        except Exception as e:
            return 5.0, f"多样性评估失败: {e}"

    def _eval_feasibility(self, history: list[dict]) -> tuple[float, str]:
        """Extract pragmatist's feasibility scores from collision."""
        pragmatist_scores = []

        for entry in history:
            agent = entry.get("agent", "")
            if "务实" not in agent and "Pragmatist" not in agent:
                continue
            content = entry["content"]
            if isinstance(content, list):
                content = " ".join(content)

            # Extract scores like "可行性评分: 7/10" or "评分：8分" or "7/10"
            patterns = [
                r'(\d+(?:\.\d+)?)\s*[/／]\s*10',
                r'评分[：:]\s*(\d+(?:\.\d+)?)',
                r'可行性[：:]\s*(\d+(?:\.\d+)?)',
                r'(\d+(?:\.\d+)?)\s*分',
            ]
            for pattern in patterns:
                matches = re.findall(pattern, content)
                pragmatist_scores.extend(float(m) for m in matches)

        if not pragmatist_scores:
            return 5.0, "未找到务实者的可行性评分"

        avg = sum(pragmatist_scores) / len(pragmatist_scores)
        return round(avg, 1), f"务实者共给出{len(pragmatist_scores)}个评分，平均: {avg:.1f}"

    def _eval_intensity(self, history: list[dict]) -> tuple[float, str]:
        """Evaluate how much agents cross-referenced each other."""
        total_responses = 0
        cross_references = 0

        for entry in history:
            if entry["round"] == 1:  # Skip round 1 (independent)
                continue
            if isinstance(entry["round"], str):  # Skip final/review
                continue

            total_responses += 1
            content = entry["content"]
            if isinstance(content, list):
                content = " ".join(content)

            # Check for @mentions or agent name references
            agent_names = ["挑衅者", "研究者", "批评家", "连接者", "实验者", "融合者", "务实者",
                          "Provocateur", "Researcher", "Critic", "Connector", "Experimenter",
                          "Synthesizer", "Pragmatist"]
            for name in agent_names:
                if name in content and name not in entry.get("agent", ""):
                    cross_references += 1
                    break

        if total_responses == 0:
            return 5.0, "无碰撞轮次"

        ratio = cross_references / total_responses
        # Map ratio to score: 0% -> 2, 50% -> 6, 100% -> 10
        score = min(10, max(2, 2 + ratio * 8))
        return round(score, 1), f"碰撞轮次中{cross_references}/{total_responses}次引用了其他agent ({ratio:.0%})"

    def format_score(self, score: CollisionScore) -> str:
        """Format score as readable text."""
        lines = [
            f"═══ 碰撞质量评估 ═══",
            f"  新颖性:   {score.novelty:.1f}/10  {score.details.get('novelty', '')}",
            f"  深度:     {score.depth:.1f}/10  {score.details.get('depth', '')}",
            f"  多样性:   {score.diversity:.1f}/10  {score.details.get('diversity', '')}",
            f"  可行性:   {score.feasibility:.1f}/10  {score.details.get('feasibility', '')}",
            f"  碰撞强度: {score.intensity:.1f}/10  {score.details.get('intensity', '')}",
            f"  ─────────────────",
            f"  综合评分: {score.overall:.1f}/10",
        ]
        return "\n".join(lines)
