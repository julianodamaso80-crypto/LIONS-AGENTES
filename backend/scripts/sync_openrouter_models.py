#!/usr/bin/env python3
"""
Sync curated OpenRouter models into llm_pricing table.

Usage:
    cd backend
    python scripts/sync_openrouter_models.py

Only top-tier exclusive models are synced — not available via native providers
(Anthropic, OpenAI, Google). Prices are fetched live from OpenRouter API.
Re-sync preserves admin-customized sell_multiplier and is_active.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from dotenv import load_dotenv
    from supabase import create_client
    import requests
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    sys.exit(1)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

DEFAULT_SELL_MULTIPLIER = 2.68

# ── Curated whitelist: top OpenRouter-exclusive models ──
# Based on OpenRouter rankings & usage data (2025-2026).
# Models from native providers (Anthropic, OpenAI, Google) are NOT included.
CURATED_MODELS = [
    # xAI Grok
    "x-ai/grok-4",
    "x-ai/grok-4.1-fast",
    "x-ai/grok-3",
    "x-ai/grok-3-mini",
    "x-ai/grok-code-fast-1",
    # DeepSeek
    "deepseek/deepseek-v3.2",
    "deepseek/deepseek-chat-v3-0324",
    "deepseek/deepseek-r1",
    "deepseek/deepseek-r1-0528",
    # Meta Llama
    "meta-llama/llama-4-maverick",
    "meta-llama/llama-4-scout",
    "meta-llama/llama-3.3-70b-instruct",
    "meta-llama/llama-3.1-405b-instruct",
    "meta-llama/llama-3.1-70b-instruct",
    # Qwen
    "qwen/qwen3.5-plus",
    "qwen/qwen3-235b-a22b",
    "qwen/qwen3-coder-480b-a35b-instruct",
    "qwen/qwen-2.5-72b-instruct",
    "qwen/qwen-2.5-coder-32b-instruct",
    # Mistral
    "mistralai/mistral-large-2411",
    "mistralai/mistral-small-3.2-24b-instruct",
    "mistralai/codestral-2501",
    "mistralai/devstral-medium",
    "mistralai/devstral-small",
    # Cohere
    "cohere/command-a",
    "cohere/command-r-plus",
    "cohere/command-r",
    # MiniMax
    "minimax/minimax-m2.5",
    "minimax/minimax-m2.1",
    "minimax/minimax-m2",
    # GLM / Z.ai
    "z-ai/glm-5",
    "z-ai/glm-4.7",
    "z-ai/glm-4.5-air",
    # NVIDIA
    "nvidia/nemotron-nano-12b-2-vl",
    "nvidia/nemotron-3-nano-30b-a3b",
    # Moonshot / Kimi
    "moonshotai/kimi-k2.5",
    "moonshotai/kimi-k2-0905",
    "moonshotai/kimi-k2-0711",
    # Microsoft
    "microsoft/phi-4",
    # Perplexity
    "perplexity/sonar-pro",
    "perplexity/sonar",
]


def fetch_openrouter_models():
    """Fetch model list from OpenRouter API."""
    url = f"{OPENROUTER_BASE_URL}/models"
    headers = {}
    if OPENROUTER_API_KEY:
        headers["Authorization"] = f"Bearer {OPENROUTER_API_KEY}"

    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json().get("data", [])


def sync_models():
    """Sync curated OpenRouter models with llm_pricing table."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ SUPABASE_URL and SUPABASE_KEY must be set in .env")
        sys.exit(1)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("\n" + "=" * 60)
    print("🔄 Syncing curated OpenRouter models...")
    print(f"📋 {len(CURATED_MODELS)} models in whitelist")
    print("=" * 60 + "\n")

    try:
        all_models = fetch_openrouter_models()
        print(f"📡 {len(all_models)} total models on OpenRouter\n")
    except Exception as e:
        print(f"❌ Error fetching models: {e}")
        sys.exit(1)

    # Index by model ID for fast lookup
    models_by_id = {m["id"]: m for m in all_models}

    success_count = 0
    not_found_count = 0
    error_count = 0

    for model_id in CURATED_MODELS:
        model = models_by_id.get(model_id)
        if not model:
            print(f"  ⚠️  {model_id} — not found on OpenRouter")
            not_found_count += 1
            continue

        pricing = model.get("pricing", {})
        prompt_price = float(pricing.get("prompt", "0") or "0")
        completion_price = float(pricing.get("completion", "0") or "0")

        # Convert from per-token to per-million-tokens
        input_per_million = round(prompt_price * 1_000_000, 4)
        output_per_million = round(completion_price * 1_000_000, 4)

        display_name = model.get("name", model_id)

        try:
            # Check if model already exists
            existing = (
                supabase.table("llm_pricing")
                .select("id")
                .eq("model_name", model_id)
                .execute()
            )

            if existing.data:
                # UPDATE existing: only update prices, preserve sell_multiplier and is_active
                supabase.table("llm_pricing").update({
                    "input_price_per_million": input_per_million,
                    "output_price_per_million": output_per_million,
                    "display_name": display_name,
                }).eq("model_name", model_id).execute()
            else:
                # INSERT new: use default sell_multiplier
                supabase.table("llm_pricing").insert({
                    "model_name": model_id,
                    "input_price_per_million": input_per_million,
                    "output_price_per_million": output_per_million,
                    "unit": "token",
                    "provider": "openrouter",
                    "is_active": True,
                    "display_name": display_name,
                    "sell_multiplier": DEFAULT_SELL_MULTIPLIER,
                }).execute()

            print(f"  ✅ {model_id} (${input_per_million:.2f}/${output_per_million:.2f} per MTok)")
            success_count += 1

        except Exception as e:
            print(f"  ❌ {model_id}: {e}")
            error_count += 1

    print("\n" + "=" * 60)
    print(f"📊 Result: {success_count} synced, {not_found_count} not found, {error_count} errors")
    print("=" * 60 + "\n")

    if success_count > 0:
        print("✅ Sync complete! Next steps:")
        print("   1. Restart backend to reload pricing cache")
        print("   2. Go to /admin/finops/pricing to review OpenRouter models")
        print("   3. Adjust sell_multiplier per model if needed")


if __name__ == "__main__":
    sync_models()
