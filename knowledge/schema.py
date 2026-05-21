"""Data models for the knowledge base."""

from dataclasses import dataclass, field
from typing import Optional
import time
import uuid


def gen_id() -> str:
    """Generate a unique ID."""
    return uuid.uuid4().hex[:12]


@dataclass
class Idea:
    """A creative idea proposed by an agent."""
    text: str
    agent_name: str
    round: int
    topic: str
    session_id: str
    domain: str = ""
    timestamp: float = field(default_factory=time.time)
    id: str = field(default_factory=gen_id)


@dataclass
class Insight:
    """A synthesized insight from collision."""
    text: str
    insight_type: str  # "方案" | "风险" | "修复" | "方向" | "实验设计"
    topic: str
    session_id: str
    domain: str = ""
    timestamp: float = field(default_factory=time.time)
    id: str = field(default_factory=gen_id)


@dataclass
class Critique:
    """A critique or challenge raised by an agent."""
    text: str
    agent_name: str
    severity: str  # "致命" | "可修复" | "轻微"
    topic: str
    session_id: str
    target_idea_summary: str = ""
    domain: str = ""
    timestamp: float = field(default_factory=time.time)
    id: str = field(default_factory=gen_id)


@dataclass
class Concept:
    """A domain concept entity."""
    name: str
    description: str
    domain: str = ""
    mention_count: int = 1
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    id: str = field(default_factory=gen_id)


@dataclass
class Relation:
    """A relationship between two knowledge entities."""
    source_type: str  # "idea" | "insight" | "critique" | "concept"
    source_id: str
    target_type: str
    target_id: str
    relation: str  # "critiques" | "extends" | "contradicts" | "combines" | "derives_from" | "validates"
    context: str = ""
    session_id: str = ""
    timestamp: float = field(default_factory=time.time)
    id: str = field(default_factory=gen_id)


@dataclass
class CollisionSession:
    """A record of a collision session."""
    topic: str
    summary: str = ""
    agent_names: list = field(default_factory=list)
    domain: str = ""
    timestamp: float = field(default_factory=time.time)
    id: str = field(default_factory=gen_id)
