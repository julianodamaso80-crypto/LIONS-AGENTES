"""
UCP Providers Package.

Este pacote continha providers específicos (Shopify, Nuvemshop, etc.)
mas foi refatorado para usar discovery-based approach.

ARQUITETURA ATUAL:
- Não existem mais providers hardcoded
- Lojas são descobertas via /.well-known/ucp
- Tools são geradas dinamicamente do manifest
- Transport é abstraído (REST, MCP, A2A)

Arquivos relevantes:
- app/services/ucp_discovery.py - Discovery de manifestos
- app/services/ucp_transport.py - Abstração de transport
- app/services/ucp_service.py - Serviço principal
- app/agents/tools/ucp_factory.py - Geração dinâmica de tools

Referência: https://ucp.dev/specification/overview/
"""
