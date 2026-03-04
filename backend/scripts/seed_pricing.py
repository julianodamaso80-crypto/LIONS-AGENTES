#!/usr/bin/env python3
"""
Seed script para popular a tabela llm_pricing com os preços atuais.

Uso:
    cd backend
    python scripts/seed_pricing.py

Pré-requisito:
    A tabela llm_pricing deve existir no banco.
    Se você rodou o smith_master_setup.sql, a tabela já foi criada!
"""

import os
import sys
from pathlib import Path

# Adiciona o diretório pai ao path para imports
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from dotenv import load_dotenv

    from supabase import create_client
except ImportError as e:
    print(f"❌ Dependência não encontrada: {e}")
    print("   Execute: pip install supabase python-dotenv")
    sys.exit(1)

# Carrega variáveis de ambiente
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Erro: SUPABASE_URL e SUPABASE_KEY devem estar definidos no .env")
    sys.exit(1)

# Tabela de preços atual (copiada do usage_service.py)
PRICING_TABLE = {
    # Anthropic
    "claude-opus-4-6": {"input": 5.00, "output": 25.00, "provider": "anthropic"},
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00, "provider": "anthropic"},
    "claude-haiku-4-5-20251001": {"input": 1.00, "output": 5.00, "provider": "anthropic"},
    "claude-opus-4-5-20251101": {"input": 5.00, "output": 25.00, "provider": "anthropic"},
    "claude-sonnet-4-5-20250929": {"input": 3.00, "output": 15.00, "provider": "anthropic"},
    "claude-opus-4-1-20250805": {"input": 15.00, "output": 75.00, "provider": "anthropic"},
    "claude-opus-4-20250514": {"input": 15.00, "output": 75.00, "provider": "anthropic"},
    "claude-sonnet-4-20250514": {"input": 3.00, "output": 15.00, "provider": "anthropic"},
    "claude-3-7-sonnet-20250219": {"input": 3.00, "output": 15.00, "provider": "anthropic"},
    "claude-3-5-sonnet-20241022": {"input": 3.00, "output": 15.00, "provider": "anthropic"},
    "claude-3-5-sonnet-20240620": {"input": 3.00, "output": 15.00, "provider": "anthropic"},
    "claude-3-5-haiku-20241022": {"input": 0.80, "output": 4.00, "provider": "anthropic"},
    "claude-opus-4-5": {"input": 5.00, "output": 25.00, "provider": "anthropic"},
    "claude-sonnet-4-5": {"input": 3.00, "output": 15.00, "provider": "anthropic"},
    "claude-haiku-4-5": {"input": 1.00, "output": 5.00, "provider": "anthropic"},

    # OpenAI
    "gpt-5.2": {"input": 1.75, "output": 14.00, "provider": "openai"},
    "gpt-5.2-pro": {"input": 21.00, "output": 168.00, "provider": "openai"},
    "gpt-5.2-chat-latest": {"input": 1.75, "output": 14.00, "provider": "openai"},
    "gpt-5.1": {"input": 1.25, "output": 10.00, "provider": "openai"},
    "o3-pro": {"input": 15.00, "output": 60.00, "provider": "openai"},
    "o3": {"input": 5.00, "output": 20.00, "provider": "openai"},
    "o3-mini": {"input": 1.00, "output": 4.00, "provider": "openai"},
    "o1": {"input": 15.00, "output": 60.00, "provider": "openai"},
    "o1-pro": {"input": 30.00, "output": 120.00, "provider": "openai"},
    "o1-mini": {"input": 3.00, "output": 12.00, "provider": "openai"},
    "o1-preview": {"input": 15.00, "output": 60.00, "provider": "openai"},
    "gpt-4o": {"input": 2.50, "output": 10.00, "provider": "openai"},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60, "provider": "openai"},
    "gpt-4o-mini-2024-07-18": {"input": 0.15, "output": 0.60, "provider": "openai"},
    "chatgpt-4o-latest": {"input": 5.00, "output": 15.00, "provider": "openai"},

    # Google
    "gemini-3.1-pro-preview": {"input": 2.00, "output": 12.00, "provider": "google"},
    "gemini-3-flash-preview": {"input": 0.10, "output": 0.40, "provider": "google"},
    "gemini-3-pro-preview": {"input": 2.00, "output": 8.00, "provider": "google"},  # Deprecated Mar 2026
    "gemini-3-deep-think": {"input": 5.00, "output": 20.00, "provider": "google"},
    "gemini-2.5-pro": {"input": 1.25, "output": 5.00, "provider": "google"},
    "gemini-2.5-flash": {"input": 0.10, "output": 0.40, "provider": "google"},
    "gemini-2.5-flash-lite": {"input": 0.05, "output": 0.20, "provider": "google"},
    "gemini-1.5-pro": {"input": 1.25, "output": 5.00, "provider": "google"},
    "gemini-1.5-flash": {"input": 0.075, "output": 0.30, "provider": "google"},

    # Outros
    "grok-4": {"input": 2.00, "output": 10.00, "provider": "other"},
    "grok-3": {"input": 2.00, "output": 10.00, "provider": "other"},
    "deepseek-chat": {"input": 0.50, "output": 2.00, "provider": "other"},
    "mistral-large-latest": {"input": 2.00, "output": 6.00, "provider": "other"},
    "text-embedding-3-small": {"input": 0.02, "output": 0.0, "provider": "openai"},
    "whisper-1": {"input": 0.006, "output": 0.0, "unit": "minute", "provider": "openai"},
}


def seed_pricing():
    """Popula a tabela llm_pricing com os preços do PRICING_TABLE."""
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("\n" + "=" * 50)
    print("🔄 Populando tabela llm_pricing...")
    print("=" * 50 + "\n")

    success_count = 0
    error_count = 0

    for model_name, pricing in PRICING_TABLE.items():
        try:
            data = {
                "model_name": model_name,
                "input_price_per_million": pricing["input"],
                "output_price_per_million": pricing["output"],
                "unit": pricing.get("unit", "token"),
                "provider": pricing.get("provider", "other"),
                "is_active": True,
                "display_name": model_name.replace("-", " ").title()
            }

            # Upsert: insere ou atualiza se já existir
            result = supabase.table("llm_pricing").upsert(
                data,
                on_conflict="model_name"
            ).execute()

            if result.data:
                print(f"  ✅ {model_name}")
                success_count += 1
            else:
                print(f"  ⚠️ {model_name} - sem retorno")

        except Exception as e:
            print(f"  ❌ {model_name}: {e}")
            error_count += 1

    print("\n" + "=" * 50)
    print(f"📊 Resultado: {success_count} inseridos, {error_count} erros")
    print("=" * 50 + "\n")

    if success_count > 0:
        print("✅ Seed concluído! Agora você pode:")
        print("   1. Reiniciar o backend para carregar o cache")
        print("   2. Acessar /admin/finops/pricing para gerenciar")


if __name__ == "__main__":
    seed_pricing()
