"""LLM provider presets and model registry."""

PROVIDERS = {
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "key_prefix": "sk-",
        "models": [
            {"id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro", "default": True},
            {"id": "deepseek-chat", "name": "DeepSeek V3"},
            {"id": "deepseek-reasoner", "name": "DeepSeek R1"},
        ]
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "key_prefix": "sk-",
        "models": [
            {"id": "gpt-4o", "name": "GPT-4o"},
            {"id": "gpt-4o-mini", "name": "GPT-4o Mini"},
            {"id": "o3-mini", "name": "o3-mini"},
        ]
    },
    "anthropic": {
        "name": "Anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "key_prefix": "sk-ant-",
        "models": [
            {"id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4"},
            {"id": "claude-opus-4-20250514", "name": "Claude Opus 4"},
        ]
    },
    "qwen": {
        "name": "通义千问",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "key_prefix": "sk-",
        "models": [
            {"id": "qwen-max", "name": "Qwen Max"},
            {"id": "qwen-plus", "name": "Qwen Plus"},
            {"id": "qwen-turbo", "name": "Qwen Turbo"},
        ]
    },
    "zhipu": {
        "name": "智谱 AI",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "key_prefix": "",
        "models": [
            {"id": "glm-4-plus", "name": "GLM-4 Plus"},
            {"id": "glm-4-flash", "name": "GLM-4 Flash"},
        ]
    },
}

# Default provider and model
DEFAULT_PROVIDER = "deepseek"
DEFAULT_MODEL = "deepseek-v4-pro"


def get_provider(name: str) -> dict | None:
    """Get provider config by name."""
    return PROVIDERS.get(name)


def get_default_base_url(provider_name: str) -> str:
    """Get default base URL for a provider."""
    provider = PROVIDERS.get(provider_name)
    return provider["base_url"] if provider else ""


def list_models() -> list[dict]:
    """List all available models grouped by provider."""
    result = []
    for pid, pconf in PROVIDERS.items():
        for model in pconf["models"]:
            result.append({
                "provider": pid,
                "provider_name": pconf["name"],
                "model_id": model["id"],
                "model_name": model["name"],
                "is_default": model.get("default", False),
            })
    return result


def resolve_agent_config(agent_id: str, agent_overrides: dict,
                         global_config: dict) -> dict:
    """Resolve final config for an agent, merging global + per-agent overrides.

    Returns: {model, api_key, base_url}
    """
    provider = agent_overrides.get("provider", global_config.get("provider", DEFAULT_PROVIDER))
    model = agent_overrides.get("model", global_config.get("model", DEFAULT_MODEL))
    api_key = agent_overrides.get("api_key") or global_config.get("api_key", "")
    base_url = agent_overrides.get("base_url") or global_config.get("base_url", "")

    if not base_url:
        base_url = get_default_base_url(provider)

    return {
        "model": model,
        "api_key": api_key,
        "base_url": base_url,
        "provider": provider,
    }
