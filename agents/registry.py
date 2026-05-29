"""Agent auto-discovery registry."""

import importlib
import inspect
import os
import pkgutil

from agents.base import BaseAgent


def discover_agents(config) -> list:
    """Auto-discover all BaseAgent subclasses in the agents/ directory.

    Agents are returned in the order specified by config.agents_order,
    or in discovery order if not specified.
    """
    package_path = os.path.dirname(__file__)
    discovered = {}

    for _, module_name, _ in pkgutil.iter_modules([package_path]):
        if module_name in ('base', 'registry', '__init__'):
            continue
        try:
            module = importlib.import_module(f'agents.{module_name}')
        except Exception as e:
            print(f"   Failed to import agents.{module_name}: {e}")
            continue

        for name, cls in inspect.getmembers(module, inspect.isclass):
            if issubclass(cls, BaseAgent) and cls is not BaseAgent:
                # Use module name as key (e.g., "provocateur", "critic")
                key = module_name
                discovered[key] = cls(config)

    # Apply ordering from config
    order = getattr(config, 'agents_order', None)
    disabled = set(getattr(config, 'agents_disabled', []) or [])

    if order:
        agents = []
        for key in order:
            if key in disabled:
                continue
            if key in discovered:
                agents.append(discovered[key])
            else:
                print(f"   Agent '{key}' not found, skipping")
        # Add any discovered agents not in order list
        for key, agent in discovered.items():
            if key not in order and key not in disabled:
                agents.append(agent)
    else:
        agents = [agent for key, agent in discovered.items()
                  if key not in disabled]

    return agents


def list_agent_modules() -> list[str]:
    """List available agent module names."""
    package_path = os.path.dirname(__file__)
    modules = []
    for _, module_name, _ in pkgutil.iter_modules([package_path]):
        if module_name in ('base', 'registry', '__init__'):
            continue
        modules.append(module_name)
    return sorted(modules)
