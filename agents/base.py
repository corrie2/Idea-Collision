"""Base Agent class for all Idea Collision agents."""

import re
from openai import OpenAI


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

    def generate_ideas(self, topic: str, n: int = 3, extra_context: str = "") -> list[str]:
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
        )
        response = self.chat([{"role": "user", "content": prompt}])
        return self._parse_ideas(response)

    def respond_to_others(self, topic: str, history: str, extra_context: str = "") -> str:
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
            f"- 质疑你不同意的观点\n"
            f"- 延伸你觉得有价值的点\n"
            f"- 提出新的交叉想法\n"
            f"保持简洁，直接说重点。"
        )
        return self.chat([{"role": "user", "content": prompt}])

    def synthesize(self, topic: str, full_history: str, extra_context: str = "") -> str:
        prompt = (
            f"主题：{topic}\n\n"
        )
        if extra_context:
            prompt += (
                f"以下是相关的知识库内容，供你参考：\n{extra_context}\n\n"
            )
        prompt += (
            f"以下是完整的碰撞过程：\n{full_history}\n\n"
            f"请综合所有碰撞成果，提炼出最有价值的核心创意（3-5个），"
            f"每个给出：创意名称、核心描述、为什么这个想法值得深入。"
        )
        return self.chat([{"role": "user", "content": prompt}])

    def _parse_ideas(self, response: str) -> list[str]:
        ideas = re.split(r'\[想法\d+\][:：]?\s*', response)
        ideas = [i.strip() for i in ideas if i.strip()]
        if not ideas:
            ideas = [s.strip() for s in response.split('\n') if s.strip() and len(s.strip()) > 10]
        return ideas

    def __repr__(self):
        return f"<{self.__class__.__name__} '{self.name}'>"
