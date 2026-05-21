"""Configuration for Idea Collision system."""

import os
from dataclasses import dataclass, field

try:
    from dotenv import load_dotenv
    # Load .env from project directory
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
    # Also try loading from home directory
    load_dotenv(os.path.expanduser("~/.env"))
except ImportError:
    pass


@dataclass
class Config:
    # ── LLM Config ──
    api_key: str = field(
        default_factory=lambda: (
            os.environ.get("DEEPSEEK_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or ""
        )
    )
    base_url: str = field(
        default_factory=lambda: (
            os.environ.get("DEEPSEEK_BASE_URL")
            or os.environ.get("OPENAI_BASE_URL")
            or "https://api.deepseek.com"
        )
    )
    model: str = "deepseek-v4-pro"
    max_tokens: int = 16384  # Large value to prevent truncation
    temperature: float = 0.9

    # ── Collision Config ──
    num_rounds: int = 4
    ideas_per_agent_round1: int = 3
    output_dir: str = "output"

    # ── Knowledge Base Config ──
    knowledge_db_path: str = "knowledge/chromadb"
    relations_db_path: str = "knowledge/relations.db"
    embedding_model: str = "shibing624/text2vec-base-chinese"  # Chinese semantic embedding
    knowledge_top_k: int = 5
    no_knowledge: bool = False

    # ── Agent Config ──
    agents_order: list = field(default_factory=lambda: [
        "provocateur", "researcher", "critic", "connector",
        "experimenter", "synthesizer", "pragmatist"
    ])
    agents_disabled: list = field(default_factory=list)

    def validate(self):
        if not self.api_key:
            raise ValueError(
                "DeepSeek API Key not found.\n"
                "Set one of: DEEPSEEK_API_KEY or OPENAI_API_KEY\n"
                "Or create ~/idea-collision/.env with: DEEPSEEK_API_KEY=sk-xxx"
            )
