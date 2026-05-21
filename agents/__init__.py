"""Idea Collision Agents."""

from agents.registry import discover_agents, list_agent_modules
from agents.provocateur import Provocateur
from agents.critic import Critic
from agents.synthesizer import Synthesizer
from agents.connector import Connector
from agents.pragmatist import Pragmatist
from agents.researcher import Researcher
from agents.experimenter import Experimenter

__all__ = [
    "discover_agents",
    "list_agent_modules",
    "Provocateur",
    "Critic",
    "Synthesizer",
    "Connector",
    "Pragmatist",
    "Researcher",
    "Experimenter",
]
