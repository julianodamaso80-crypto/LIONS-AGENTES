"""
Core System Prompts - Hybrid Prompt Architecture
==============================================

Este módulo contém os prompts base do sistema que definem comportamentos
imutáveis e regras de governança para o agente ScaleAIV2.

Arquitetura Multi-Tenant:
- SYSTEM_BASE_PROMPT: Regras técnicas e de segurança (controladas pelo dev)
- client_instructions: Regras de negócio e tom (configuradas pelo cliente)
- Merge dinâmico: graph.py combina ambos em tempo de execução
"""

SYSTEM_BASE_PROMPT = """
Você é o Assistente de IA da plataforma ScaleAIV2, um especialista em gestão de conhecimento corporativo.
Sua função é responder perguntas baseando-se ESTRITAMENTE nos documentos indexados.

### 📚 BASE DE CONHECIMENTO (Estratégias de Ingestão)
Você tem acesso a documentos processados via estratégias avançadas (Semântica, Página, Agente).
*Sempre que encontrar metadados de 'page' (ex: page_number), cite o número da página na resposta.*

### 🛠️ USO DE FERRAMENTAS
1. **knowledge_base_search:** Use SEMPRE para buscar informações antes de responder.
2. **Parâmetros:**
   - A busca usa inteligência vetorial avançada (text-embedding-3-small).
   - `score_threshold`: O padrão é 0.4. Se não encontrar nada, o sistema já está calibrado.
3. **Falha na Busca:**
   - Se a busca retornar vazio ou irrelevante: Tente reformular a query com termos diferentes.
   - Só diga "não sei" se realmente esgotar as opções.

### 🛡️ REGRAS DE OURO
- **Veracidade:** Nunca invente. Se não estiver no texto recuperado, não existe.
- **Formatação:** Use Markdown (negrito, listas) para clareza.
- **Moeda:** R$ X.XXX,XX (Padrão BR).
"""


def build_composite_prompt(client_instructions: str = None) -> str:
    """
    Constrói o prompt híbrido combinando regras do sistema com instruções do cliente.

    Args:
        client_instructions: Instruções personalizadas do cliente (tom, regras de negócio)

    Returns:
        Prompt completo fundido com separadores claros

    Arquitetura:
        [CORE - Governança e Ferramentas]
        ---
        [CLIENT - Tom e Contexto]
        ---
        [FOOTER - Reforço de Segurança]
    """
    from datetime import datetime

    import pytz

    # Adicionar data/hora atual para o LLM
    try:
        tz = pytz.timezone('America/Sao_Paulo')
        now = datetime.now(tz)
        current_datetime = now.strftime("%d/%m/%Y %H:%M")
        weekday_names = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo']
        weekday = weekday_names[now.weekday()]
    except Exception:
        current_datetime = datetime.now().strftime("%d/%m/%Y %H:%M")
        weekday = ""

    if not client_instructions or client_instructions.strip() == "":
        client_instructions = "Seja um assistente útil e cordial."

    composite = f"""{SYSTEM_BASE_PROMPT.strip()}

### 📅 DATA E HORA ATUAL
Hoje é {weekday}, {current_datetime} (horário de Brasília).
Use esta informação para contexto temporal quando o usuário mencionar datas relativas (amanhã, próxima semana, etc).

---

### 🎯 INSTRUÇÕES ESPECÍFICAS DO CLIENTE
{client_instructions.strip()}

---

**LEMBRE-SE:** As regras de segurança e uso de ferramentas acima são prioritárias e devem ser sempre respeitadas, independentemente de outras instruções.
"""

    return composite


def expand_http_tool_variables(prompt: str, http_tools: list) -> tuple[str, list]:
    """
    Expande variáveis de HTTP tools no prompt e retorna lista de tools mencionadas.

    Args:
        prompt: O prompt do cliente com variáveis {tool_name}
        http_tools: Lista de HTTP tools do banco [{name, description, method, parameters, ...}]

    Returns:
        Tuple (prompt_expandido, lista_de_tools_mencionadas)

    Exemplo:
        Input: "Use {consultar_pedido} para buscar status de pedidos."
        Output: (
            "Use a ferramenta 'consultar_pedido' (GET) para buscar status de pedidos. Parâmetros: order_id (texto).",
            ["consultar_pedido"]
        )
    """

    mentioned_tools = []
    expanded_prompt = prompt

    for tool in http_tools:
        tool_name = tool.get("name", "")
        tag = f"{{{tool_name}}}"

        if tag in prompt:
            mentioned_tools.append(tool_name)

            # Monta a descrição expandida
            method = tool.get("method", "GET")
            description = tool.get("description", "")
            params = tool.get("parameters", []) or []

            # Formata parâmetros
            if params:
                param_descriptions = []
                for p in params:
                    p_name = p.get("name", "")
                    p_type = p.get("type", "string")
                    p_desc = p.get("description", "")

                    type_map = {
                        "string": "texto",
                        "integer": "número",
                        "boolean": "sim/não",
                    }
                    p_type_br = type_map.get(p_type, p_type)

                    if p_desc:
                        param_descriptions.append(
                            f"  - {p_name} ({p_type_br}): {p_desc}"
                        )
                    else:
                        param_descriptions.append(f"  - {p_name} ({p_type_br})")

                params_text = "\n".join(param_descriptions)

                expansion = f"""
### 🔧 Ferramenta HTTP: {tool_name}
- **Descrição:** {description}
- **Método:** {method}
- **Parâmetros necessários:**
{params_text}

Para usar esta ferramenta, chame 'http_api' com tool_name="{tool_name}" e passe os parâmetros em formato JSON.
"""
            else:
                expansion = f"""
### 🔧 Ferramenta HTTP: {tool_name}
- **Descrição:** {description}
- **Método:** {method}
- **Parâmetros:** Nenhum parâmetro necessário.

Para usar esta ferramenta, chame 'http_api' com tool_name="{tool_name}".
"""

            expanded_prompt = expanded_prompt.replace(tag, expansion.strip())

    return expanded_prompt, mentioned_tools


def expand_mcp_tool_variables(prompt: str, mcp_tools: list) -> tuple[str, list]:
    """
    Expande variáveis de MCP tools no prompt e retorna lista de tools mencionadas.

    Args:
        prompt: O prompt do cliente com variáveis {mcp_server_tool}
        mcp_tools: Lista de MCP tools do banco [{variable_name, description, input_schema, ...}]

    Returns:
        Tuple (prompt_expandido, lista_de_tools_mencionadas)

    Exemplo:
        Input: "Use {mcp_github_create_issue} para criar issues."
        Output: (
            "Use a ferramenta MCP 'mcp_github_create_issue' (GitHub) para criar issues...",
            ["mcp_github_create_issue"]
        )
    """

    mentioned_tools = []
    expanded_prompt = prompt

    for tool in mcp_tools:
        variable_name = tool.get("variable_name", "")
        tag = f"{{{variable_name}}}"

        if tag in prompt:
            mentioned_tools.append(variable_name)

            # Extrair informações
            server_name = tool.get("mcp_server_name", "")
            tool_name = tool.get("tool_name", "")
            description = tool.get("description", "")
            input_schema = tool.get("input_schema", {})

            # Formata parâmetros
            params = input_schema.get("properties", {}) if input_schema else {}
            required = input_schema.get("required", []) if input_schema else []

            if params:
                param_descriptions = []
                for p_name, p_schema in params.items():
                    p_type = p_schema.get("type", "string")
                    p_desc = p_schema.get("description", "")
                    is_required = p_name in required

                    type_map = {
                        "string": "texto",
                        "integer": "número",
                        "boolean": "sim/não",
                        "array": "lista",
                        "object": "objeto",
                    }
                    p_type_br = type_map.get(p_type, p_type)
                    req_marker = " (obrigatório)" if is_required else " (opcional)"

                    if p_desc:
                        param_descriptions.append(
                            f"  - {p_name} ({p_type_br}){req_marker}: {p_desc}"
                        )
                    else:
                        param_descriptions.append(f"  - {p_name} ({p_type_br}){req_marker}")

                params_text = "\n".join(param_descriptions)

                expansion = f"""

### 🔗 Ferramenta MCP: {variable_name}
- **Servidor:** {server_name}
- **Função:** {tool_name}
- **Descrição:** {description}
- **Parâmetros:**
{params_text}

Para usar esta ferramenta, chame '{variable_name}' passando os parâmetros necessários.
"""
            else:
                expansion = f"""

### 🔗 Ferramenta MCP: {variable_name}
- **Servidor:** {server_name}
- **Função:** {tool_name}
- **Descrição:** {description}
- **Parâmetros:** Nenhum parâmetro necessário.

Para usar esta ferramenta, chame '{variable_name}'.
"""

            expanded_prompt = expanded_prompt.replace(tag, expansion.strip())

    return expanded_prompt, mentioned_tools


def expand_subagent_variables(delegations: list) -> str:
    """
    Gera seção de prompt descrevendo os especialistas disponíveis para delegação.

    Args:
        delegations: Lista de dicts com {subagent_data, task_description}

    Returns:
        Bloco de texto para inserir no system prompt do orquestrador
    """
    if not delegations:
        return ""

    specialists = []
    for d in delegations:
        sub_data = d.get("subagent_data", {})
        name = sub_data.get("agent_name", sub_data.get("name", "Especialista"))
        sub_id = sub_data.get("id", d.get("subagent_id", ""))
        task = d.get("task_description", "Tarefas especializadas")
        specialists.append(f"  - **{name}** (ID: `{sub_id}`): {task}")

    specialists_text = "\n".join(specialists)

    return f"""
### 🤖 ESPECIALISTAS DISPONÍVEIS (SubAgentes)

Você pode delegar tarefas para especialistas usando a ferramenta `delegate_to_subagent`.
Use delegação quando a pergunta exigir conhecimento especializado fora do seu escopo direto.

**Especialistas:**
{specialists_text}

**Como usar:**
Chame `delegate_to_subagent` com:
- `subagent_id`: O ID do especialista
- `task_description`: Descrição clara do que o especialista deve fazer

**IMPORTANTE:** O especialista responde para VOCÊ (não diretamente ao usuário).
Você deve integrar a resposta do especialista na sua resposta final ao usuário.
"""

