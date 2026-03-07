#!/usr/bin/env python3
"""
Seed script para popular a tabela mcp_servers com os servidores internos.

Uso:
    cd backend
    python scripts/seed_mcp_servers.py

Pré-requisito:
    A tabela mcp_servers deve existir no banco.
    Se você rodou o scale_master_setup.sql, a tabela já foi criada!

Este script popula a tabela com as configurações dos servidores MCP internos.
Apenas metadados de configuração - SEM credenciais ou secrets.
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

# Configuração dos MCP Servers internos
# NOTA: Apenas metadados públicos - sem credenciais
MCP_SERVERS = [
    {
        "name": "google-calendar",
        "display_name": "Google Calendar",
        "description": "Gerenciamento de eventos e agenda do Google Calendar",
        "package_name": "internal",
        "command": '["python", "-m", "app.mcp_servers.google_calendar_server"]',
        "oauth_provider": "google",
        "oauth_scopes": '["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"]',
        "is_active": True
    },
    {
        "name": "google-drive",
        "display_name": "Google Drive",
        "description": "Acesso a arquivos e pastas do Google Drive",
        "package_name": "internal",
        "command": '["python", "-m", "app.mcp_servers.google_drive_server"]',
        "oauth_provider": "google",
        "oauth_scopes": '["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"]',
        "is_active": True
    },
    {
        "name": "slack",
        "display_name": "Slack",
        "description": "Envio de mensagens e gerenciamento de canais do Slack",
        "package_name": "internal",
        "command": '["python", "-m", "app.mcp_servers.slack_server"]',
        "oauth_provider": "slack",
        "oauth_scopes": '["channels:read", "chat:write", "users:read"]',
        "is_active": True
    },
    {
        "name": "github",
        "display_name": "GitHub",
        "description": "Gerenciamento de repositórios, issues e pull requests",
        "package_name": "internal",
        "command": '["python", "-m", "app.mcp_servers.github_server"]',
        "oauth_provider": "github",
        "oauth_scopes": '["repo", "read:user"]',
        "is_active": True
    }
]


def seed_mcp_servers():
    """Popula a tabela mcp_servers com os servidores internos."""
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("\n" + "=" * 50)
    print("🔄 Populando tabela mcp_servers...")
    print("=" * 50 + "\n")

    success_count = 0
    error_count = 0

    for server in MCP_SERVERS:
        try:
            # Upsert: insere ou atualiza se já existir
            result = supabase.table("mcp_servers").upsert(
                server,
                on_conflict="name"
            ).execute()

            if result.data:
                print(f"  ✅ {server['display_name']}")
                success_count += 1
            else:
                print(f"  ⚠️ {server['display_name']} - sem retorno")

        except Exception as e:
            print(f"  ❌ {server['display_name']}: {e}")
            error_count += 1

    print("\n" + "=" * 50)
    print(f"📊 Resultado: {success_count} inseridos, {error_count} erros")
    print("=" * 50 + "\n")

    if success_count > 0:
        print("✅ Seed concluído! MCP Servers configurados:")
        print("   - Google Calendar")
        print("   - Google Drive")
        print("   - Slack")
        print("   - GitHub")


if __name__ == "__main__":
    seed_mcp_servers()
