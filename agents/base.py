"""Base Agent class for all Idea Collision agents."""

import re
from openai import OpenAI


# Round-specific behavior instructions
ROUND_BEHAVIORS = {
    1: """【第1轮：独立发散】
这是初始想法生成阶段。每个智能体独立思考，不受其他人影响。
你应该：大胆提出原创想法，不要顾虑太多，先发散再收敛。""",
    2: """【第2轮：质疑与延伸】
你已经看到了其他人的初始想法。现在进入交锋阶段。
你应该：质疑你不同意的观点（给出理由），延伸你觉得有价值的点，提出新的交叉想法。""",
    3: """【第3轮：交叉融合】
碰撞进入深度阶段。前两轮的观点已经充分展开。
你应该：寻找不同想法之间的结合点，提出混合方案，用"A的优点+B的优点"的方式创造新想法。""",
    4: """【第4轮：收敛聚焦】
这是最后一轮碰撞。讨论应该从发散转向收敛。
你应该：筛选最有潜力的想法，给出明确的优先级判断，指出哪些值得深入、哪些应该放弃。""",
}

# Domain-specific context injection
DOMAIN_CONTEXTS = {
    "向量搜索": """领域背景：向量搜索/近似最近邻(ANN)
核心概念：HNSW、IVF、PQ、SCANN、DiskANN、图索引、量化、维度灾难
关键指标：召回率(Recall)、查询延迟(Latency)、内存占用(Memory)、构建时间(Build Time)
前沿方向：可学习索引、混合索引、GPU加速、流式更新""",
    "空间数据库": """领域背景：空间数据库与空间索引
核心概念：R-tree、KD-tree、Quad-tree、空间连接、范围查询、kNN查询、空间选择率
关键挑战：高维诅咒、数据倾斜、动态更新、并发控制
应用领域：GIS、LBS、自动驾驶、物联网""",
    "机器学习": """领域背景：机器学习与深度学习
核心概念：Transformer、Attention、CNN、RNN、强化学习、自监督学习
关键趋势：大模型、多模态、推理优化、模型压缩
评估维度：准确率、泛化性、效率、可解释性""",
}


class BaseAgent:
    def __init__(self, name: str, role: str, system_prompt: str, config):
        self.name = name
        self.role = role
        self.system_prompt = system_prompt
        self.client = OpenAI(
            api_key=config.api_key,
            base_url=config.base_url,
        )
        self.model = config.model
        self.max_tokens = config.max_tokens
        self.temperature = config.temperature

    def _get_round_prompt(self, round_num: int) -> str:
        """Get round-specific behavior instructions."""
        if round_num and round_num in ROUND_BEHAVIORS:
            return "\n\n" + ROUND_BEHAVIORS[round_num]
        return ""

    def _get_domain_context(self, topic: str) -> str:
        """Detect domain and inject relevant context."""
        for domain_key, context in DOMAIN_CONTEXTS.items():
            if domain_key in topic:
                return f"\n\n{context}"
        return ""

    def chat(self, messages: list[dict], max_continuations: int = 3) -> str:
        """Chat with truncation detection and continuation support."""
        full_messages = [{"role": "system", "content": self.system_prompt}] + messages
        
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=full_messages,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
        )
        content = resp.choices[0].message.content
        
        # Check if content was truncated (finish_reason == "length")
        finish_reason = resp.choices[0].finish_reason
        if finish_reason == "length" and max_continuations > 0:
            print(f"    ⚠ {self.name}: Content truncated, continuing...")
            # Continue generation
            continuation_messages = full_messages + [
                {"role": "assistant", "content": content},
                {"role": "user", "content": "请继续完成上述内容，不要重复已经写过的部分。"}
            ]
            continuation = self.chat(continuation_messages, max_continuations - 1)
            return content + "\n" + continuation
        
        return content

    def generate_ideas(self, topic: str, n: int = 3, extra_context: str = "",
                       round_num: int = 1) -> list[str]:
        domain_ctx = self._get_domain_context(topic)
        round_prompt = self._get_round_prompt(round_num)

        prompt = (
            f"主题：{topic}\n\n"
        )
        if extra_context:
            prompt += (
                f"以下是相关的历史讨论成果，供你参考（不必局限于这些，也可以提出全新方向）：\n"
                f"{extra_context}\n\n"
            )
        prompt += (
            f"请围绕这个主题，从你的思维角度出发，提出 {n} 个创意/想法。\n"
            f"每个想法用 [想法1]、[想法2]... 标记，简洁有力，每个不超过3句话。"
            f"{domain_ctx}{round_prompt}"
        )
        response = self.chat([{"role": "user", "content": prompt}])
        return self._parse_ideas(response)

    def respond_to_others(self, topic: str, history: str, extra_context: str = "",
                          round_num: int = 2) -> str:
        domain_ctx = self._get_domain_context(topic)
        round_prompt = self._get_round_prompt(round_num)

        prompt = (
            f"主题：{topic}\n\n"
        )
        if extra_context:
            prompt += (
                f"以下是相关的历史知识，供你参考：\n{extra_context}\n\n"
            )
        prompt += (
            f"以下是其他智能体的想法：\n{history}\n\n"
            f"请从你的角色视角回应：\n"
            f"- 质疑你不同意的观点（给出具体理由）\n"
            f"- 延伸你觉得有价值的点\n"
            f"- 提出新的交叉想法\n"
            f"- 用@智能体名 引用具体观点\n"
            f"保持简洁，直接说重点。"
            f"{domain_ctx}{round_prompt}"
        )
        return self.chat([{"role": "user", "content": prompt}])

    def synthesize(self, topic: str, full_history: str, extra_context: str = "") -> str:
        domain_ctx = self._get_domain_context(topic)
        prompt = (
            f"主题：{topic}\n\n"
        )
        if extra_context:
            prompt += (
                f"以下是相关的知识库内容，供你参考：\n{extra_context}\n\n"
            )
        prompt += (
            f"以下是完整的碰撞过程：\n{full_history}\n\n"
            f"请综合所有碰撞成果，提炼出最有价值的核心创意（3-5个），\n"
            f"每个给出：创意名称、核心描述、为什么这个想法值得深入、"
            f"与哪些其他创意可以进一步融合。"
            f"{domain_ctx}"
        )
        return self.chat([{"role": "user", "content": prompt}])

    def _parse_ideas(self, response: str) -> list[str]:
        ideas = re.split(r'\[想法\d+]\[:：]?\s*', response)
        ideas = [i.strip() for i in ideas if i.strip()]
        if not ideas:
            ideas = [s.strip() for s in response.split('\n') if s.strip() and len(s.strip()) > 10]
        return ideas

    def __repr__(self):
        return f"<{self.__class__.__name__} '{self.name}'>"
