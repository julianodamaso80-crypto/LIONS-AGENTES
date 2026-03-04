# 🤖 Agent Smith V6.0

**Enterprise-grade AI Agent Platform** — Plataforma completa para criação, gerenciamento e deploy de agentes de IA conversacionais com RAG, memória persistente e integrações multi-canal.

---

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Arquitetura](#-arquitetura)
- [Tech Stack](#-tech-stack)
- [Requisitos](#-requisitos)
- [Instalação Local](#-instalação-local)
- [Variáveis de Ambiente](#-variáveis-de-ambiente)
- [Padronização de Código](#-padronização-de-código)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Funcionalidades](#-funcionalidades)

---

## 🎯 Visão Geral

Agent Smith é uma plataforma SaaS multi-tenant que permite empresas criarem e gerenciarem agentes de IA personalizados. Cada agente pode:

- 💬 Responder perguntas usando base de conhecimento (RAG)
- 🧠 Manter memória de longo prazo por usuário
- 🌐 Buscar informações na web em tempo real
- 📱 Integrar com WhatsApp via Z-API
- 🔄 Transferir para atendimento humano (Human Handoff)
- 📊 Registrar métricas de uso e custos por token

---

## 🏗 Arquitetura

```mermaid
flowchart TB
    subgraph Frontend["🖥️ FRONTEND - Next.js 15.1 + React 18 + Tailwind + Radix UI"]
        LP[Landing Page]
        AP[Admin Panel]
        CW[Chat Widget]
    end

    subgraph Guardrails["🛡️ GUARDRAILS - Security Layer"]
        PII["Presidio PII\nMasking"]
        PI["Prompt Injection\nDetection"]
        CM["LlamaGuard\nContent Moderation"]
    end

    subgraph Backend["⚡ BACKEND - FastAPI + Python 3.11+"]
        subgraph Agent["🤖 LangGraph Agent"]
            RAG[RAG Tool]
            WS[Web Search]
            HH[Human Handoff]
            HTTP[HTTP Tools]
            MCP["🔌 MCP Tools\n(Drive, Calendar, etc)"]
            UCP["🛒 UCP Commerce\n(Checkout, Catalog)"]
        end
        MS[Memory Service]
        DI[Document Ingestion]
        UT[Usage Tracking]
    end

    subgraph Infra["🗄️ INFRAESTRUTURA"]
        SB[(Supabase\nPostgres)]
        QD[(Qdrant\nVectors)]
        MN[(MinIO\nStorage)]
        RD[(Redis\nBuffer)]
    end

    subgraph Worker["⚙️ CELERY WORKER - Background"]
        BT[Billing Tasks\nprocess_unbilled]
        EA[Email Alerts\n80%/100% usage]
    end

    Frontend --> Guardrails
    Guardrails --> Backend
    Backend --> Infra
    SB --> Worker
    RD --> Worker
```

---

## 🛠 Tech Stack

### Frontend

| Tecnologia | Versão | Descrição |
|------------|--------|-----------|
| **Next.js** | 15.5.9 | Framework React com App Router |
| **React** | 18.3.1 | Biblioteca UI |
| **TypeScript** | 5.2.2 | Tipagem estática |
| **Tailwind CSS** | 3.3.3 | Utility-first CSS |
| **Radix UI** | Latest | Componentes acessíveis |
| **Supabase JS** | 2.58.0 | Cliente Supabase |
| **Framer Motion** | 12.x | Animações |
| **React Hook Form** | 7.53.0 | Formulários |
| **Zod** | 3.23.8 | Validação de schemas |
| **Recharts** | 2.12.7 | Gráficos |
| **Prettier** | Latest | Formatação de código |

### Backend

| Tecnologia | Versão | Descrição |
|------------|--------|-----------|
| **FastAPI** | ≥0.109.0 | Framework async Python |
| **LangChain** | 1.0.8 | Framework LLM |
| **LangGraph** | 1.0.3 | State machines para agents |
| **Pydantic** | 2.12.4 | Validação de dados |
| **OpenAI** | ≥1.10.0 | GPT-4, Embeddings |
| **Anthropic** | ≥0.18.0 | Claude |
| **Google GenAI** | 3.1.0 | Gemini |
| **Ruff** | Latest | Linter e Formatter Python |

### Infraestrutura

| Serviço | Descrição |
|---------|-----------|
| **Supabase** | Auth, PostgreSQL, Realtime |
| **Qdrant** | Vector database para RAG |
| **MinIO** | Object storage (documentos) |
| **Redis** | Message buffer (WhatsApp) |
| **Sentry** | Error tracking |

---

## 📦 Requisitos

### Sistema

- **Node.js** ≥ 18.x
- **Python** ≥ 3.11
- **Docker** + Docker Compose (para serviços locais)

### Serviços Externos (Obrigatórios)

- **Supabase** — Banco de dados e autenticação
- **Anthropic API Key** — Claude models
- **Cohere API Key** — Reranking (melhora qualidade RAG)
- **Tavily API Key** — Web search
- **Stripe Secret Key** — Pagamentos e billing
- **Groq API Key** — LlamaGuard (Guardrails)

### Serviços Externos (Opcionais)

- **Google API Key** — Gemini models
- **OpenRouter API Key** — 400+ models via gateway único (Meta Llama, DeepSeek, Mistral, etc.)
- **Google OAuth Client ID / Secret** — OAuth Google (Drive, Calendar)
- **Shopify Agent Client ID / Secret** — UCP Commerce (Shopify)
- **SendGrid API Key** — Envio de emails
- **LangSmith API Key** — Observabilidade de agents (tracing)

---

## 🗄️ Configuração Local

### 1. Clone o Repositório

```bash
git clone https://github.com/LionLabsCommunity/Agent-SmithV6.git
cd Agent-SmithV6
```

### 2. Configure o Banco de Dados (Supabase)

> [!WARNING]
> O banco precisa estar configurado **ANTES** de rodar os seeds!

#### Passo 2.1 — Crie um Projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie uma conta (ou faça login)
2. Clique em **New Project**
3. Preencha nome, senha do banco e região
4. Aguarde o projeto ser criado (~2 minutos)

#### Passo 2.2 — Execute o Setup Mestre

1. No seu projeto Supabase, vá em **SQL Editor → New Query**
2. Abra o arquivo `backend/supabase/migrations/migration.sql`
3. Copie **TODO** o conteúdo e cole no SQL Editor
4. Clique em **Run** para executar

✅ Isso cria ~35 tabelas, funções, triggers, índices e políticas RLS.

#### Passo 2.2.1 — Execute as Migrations Adicionais

Após o setup mestre, execute as seguintes migrations **na ordem indicada** no SQL Editor:

| Ordem | Arquivo | Descrição |
|-------|---------|-----------|
| 1 | `01_sanitization_jobs.sql` | Tabela de jobs do Document Sanitizer |
| 2 | `02_add_extract_images_to_sanitization.sql` | Flag de extração de imagens (depende do item 1) |
| 3 | `add_csv_ingestion_strategy.sql` | Suporte a CSV na estratégia de ingestão |
| 4 | `subagent_delegation.sql` | Sistema de SubAgentes (delegações + flags) |

> [!IMPORTANT]
> A migration `02_add_extract_images_to_sanitization.sql` **deve** ser executada após `01_sanitization_jobs.sql`. As demais (itens 3 e 4) são independentes e podem ser executadas em qualquer ordem.

Todos os arquivos estão em `backend/supabase/migrations/`.

#### Passo 2.3 — Crie os Buckets de Storage

No Supabase Dashboard, vá em **Storage → New Bucket** e crie os seguintes buckets:

| Bucket | Público? | Limite | MIME Types |
|--------|----------|--------|------------|
| `avatars` | ✅ Sim | 50 MB | image/jpeg, image/png, image/webp, image/gif |
| `chat-media` | ✅ Sim | 5 MB | image/jpeg, image/png, image/webp, image/gif |
| `voice-messages` | ✅ Sim | 50 MB | Qualquer tipo |

> [!IMPORTANT]
> Marque todos como **Public bucket** ao criar!

#### Passo 2.4 — Execute as Policies dos Buckets

Após criar os buckets, vá em **SQL Editor → New Query** e execute o conteúdo do arquivo:

```
backend/supabase/migrations/storage_bucket_policies.sql
```

Isso cria as políticas de acesso (SELECT, INSERT, UPDATE, DELETE) para cada bucket.

#### Passo 2.5 — Copie as Credenciais do Supabase

No Supabase Dashboard, vá em **Settings → API** e copie:

| Credencial | Onde Encontrar | Uso |
|------------|----------------|-----|
| Project URL | Settings → API → URL | Backend e Frontend |
| anon public key | Settings → API → anon | Frontend (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| service_role key | Settings → API → service_role | Backend (`SUPABASE_KEY`) — **NUNCA exponha no frontend!** |
| Database URL | Settings → Database → Connection String (Pooler) | Backend (`SUPABASE_DB_URL`) |

### 3. Configure as Variáveis de Ambiente

#### 3.1 — Backend (.env)

Crie um arquivo `.env` dentro da pasta `backend/` do projeto com as seguintes variáveis:

```env
# =============================================
# OBRIGATÓRIO - Supabase
# =============================================
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_KEY=eyJhbGxxxxxxxx  # service_role key
SUPABASE_DB_URL=postgresql://postgres.xxxxxxxx:senha@aws-0-us-west-1.pooler.supabase.com:6543/postgres
DATABASE_URL=postgresql://postgres.xxxxxxxx:senha@aws-0-us-west-1.pooler.supabase.com:6543/postgres

# =============================================
# OBRIGATÓRIO - OpenAI (embeddings e fallback)
# =============================================
OPENAI_API_KEY=sk-proj-xxxxxxxx

# =============================================
# OBRIGATÓRIO - Encryption Key
# Gere com: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# =============================================
ENCRYPTION_KEY=xxxxxxxx

# =============================================
# MinIO (Object Storage - Docker local)
# =============================================
MINIO_ENDPOINT=localhost:9000
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123
MINIO_SECURE=false
MINIO_BUCKET=documents

# =============================================
# Qdrant (Vector Database - Docker local)
# =============================================
QDRANT_HOST=localhost
QDRANT_PORT=6333
EMBEDDING_DIMENSION=1536

# =============================================
# Redis (Message Buffer - Docker local)
# =============================================
REDIS_URL=redis://localhost:6379/0
BUFFER_DEBOUNCE_SECONDS=3
BUFFER_MAX_WAIT_SECONDS=30
BUFFER_TTL_SECONDS=300

# =============================================
# Server Configuration
# =============================================
HOST=0.0.0.0
PORT=8000
DEBUG=True
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000  # CORS - Origens permitidas (Next.js frontend)

# =============================================
# Session & Security
# Gere ambos com: python -c "import secrets; print(secrets.token_hex(32))"
# =============================================
SESSION_SECRET=xxxxxxxx  # string hex de 64 chars
APP_SECRET=xxxxxxxx  # string hex de 64 chars

# =============================================
# Billing
# =============================================
DOLLAR_RATE=6.00

# =============================================
# Stripe (Pagamentos)
# =============================================
STRIPE_SECRET_KEY=sk_test_xxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx

# =============================================
# SendGrid (Emails)
# =============================================
SENDGRID_API_KEY=SG.xxxxxxxx
SENDGRID_FROM_EMAIL=nao-responda@seudominio.com

# =============================================
# OBRIGATÓRIO - Anthropic
# =============================================
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

# =============================================
# OBRIGATÓRIO - External Services
# =============================================
TAVILY_API_KEY=tvly-xxxxxxxx
COHERE_API_KEY=xxxxxxxx

# =============================================
# OBRIGATÓRIO - Groq (LlamaGuard / Guardrails)
# =============================================
GROQ_API_KEY=gsk_xxxxxxxx

# =============================================
# OBRIGATÓRIO - Admin API Key
# Gere com: python -c "import secrets; print(secrets.token_urlsafe(32))"
# =============================================
ADMIN_API_KEY=xxxxxxxx

# =============================================
# OPCIONAL - Google MCP OAuth
# =============================================
GOOGLE_OAUTH_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=xxxxxxxx
MCP_OAUTH_REDIRECT_BASE=http://localhost:8000

# =============================================
# OPCIONAL - Outros LLM Providers
# =============================================
GOOGLE_API_KEY=xxxxxxxx
OPENROUTER_API_KEY=sk-or-xxxxxxxx  # OpenRouter — 400+ modelos (Meta Llama, DeepSeek, Mistral, etc.)

# =============================================
# OBRIGATÓRIO - Docling (Document Sanitizer)
# =============================================
DOCLING_SERVICE_URL=http://localhost:8001
DOCLING_SERVICE_KEY=sua-chave-secreta  # Mesma chave usada no .env do docling-service

# =============================================
# OPCIONAL - Shopify (UCP Commerce)
# =============================================
SHOPIFY_AGENT_CLIENT_ID=xxxxxxxx
SHOPIFY_AGENT_CLIENT_SECRET=xxxxxxxx

# =============================================
# Test Mode (simula WhatsApp sem Z-API)
# =============================================
DRY_RUN=False
```

#### 3.2 — Frontend (.env.local)

Crie um arquivo `.env.local` na raiz do projeto com as seguintes variáveis:

```env
# =============================================
# Supabase Configuration
# =============================================
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhxxxxxxxx
SUPABASE_SERVICE_ROLE_KEY=eyJhxxxxxxxx

# =============================================
# Backend API Configuration
# =============================================
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# =============================================
# Stripe (Pagamentos)
# =============================================
STRIPE_SECRET_KEY=sk_test_xxxxxxxx

# =============================================
# SendGrid (Emails)
# =============================================
SENDGRID_API_KEY=SG.xxxxxxxx
SENDGRID_FROM_EMAIL=nao-responda@seudominio.com

# =============================================
# Billing
# =============================================
DOLLAR_RATE=6.00

# =============================================
# Session Secret
# =============================================
SESSION_SECRET=xxxxxxxx

# =============================================
# Admin API Key (mesma do backend .env)
# =============================================
ADMIN_API_KEY=xxxxxxxx
```

### 4. Inicie os Serviços Docker

```bash
cd backend
docker-compose up -d
```

Isso inicia:
- **Qdrant** (porta 6333) — Banco vetorial
- **MinIO** (porta 9000, console 9001) — Storage de documentos
- **Redis** (porta 6379) — Buffer de mensagens

### 5. Configure o Backend e Rode os Seeds

```bash
cd backend

# Crie e ative o ambiente virtual
python -m venv venv

# Windows
.\venv\Scripts\activate

# Linux/Mac
source venv/bin/activate

# Instale dependências
pip install -r requirements.txt

# Baixe os modelos do spaCy (necessário para Guardrails/PII)
python -m spacy download pt_core_news_md
python -m spacy download en_core_web_lg
```

#### 5.1 — Popular Tabela de Preços (OBRIGATÓRIO)

```bash
python scripts/seed_pricing.py
```

Insere preços de ~40 modelos (OpenAI, Anthropic, Google) — necessário para billing funcionar!

#### 5.1.1 — Sincronizar Modelos OpenRouter (Opcional)

Se você configurou `OPENROUTER_API_KEY` no `.env`:

1. Inicie o backend (`uvicorn app.main:app --reload`)
2. Acesse o painel Admin → **FinOps → Pricing**
3. Clique no botão **🔶 Sync OpenRouter**
4. Aguarde a sincronização — importa ~50 modelos curados (Meta Llama, DeepSeek, Mistral, Qwen, etc.)

> Os modelos sincronizados ficam disponíveis na configuração de agentes sob o provider **OpenRouter (Multi-provider)**.

#### 5.2 — Popular MCP Servers (Opcional)

```bash
python scripts/seed_mcp_servers.py
```

Configura integrações MCP (Google Drive, Calendar, Slack, GitHub).

### 6. Crie o Primeiro Admin Master

```bash
python scripts/create_admin.py
```

O script irá solicitar:
- Email do admin
- Nome do admin
- Senha (será hasheada com bcrypt)

💡 **Alternativa SQL:** Se preferir inserir direto no banco:

```bash
python -c "import bcrypt; print(bcrypt.hashpw(b'SuaSenha123', bcrypt.gensalt(12)).decode())"
```

E execute no SQL Editor:

```sql
INSERT INTO admin_users (email, password_hash, name)
VALUES ('admin@empresa.com', 'HASH_GERADO', 'Admin Master');
```

### 7. Configure o Frontend

```bash
cd ..  # Volte para a raiz

# Instale dependências
npm install
```

### 7.1 — Configure o Docling Service (Sanitização de Documentos)

O **Docling Service** é um microserviço separado que converte documentos (PDF, DOCX, PPTX, etc.) em Markdown limpo usando IBM Docling. Ele é **obrigatório** para o funcionamento da **Sanitização de Documentos** na base de conhecimento.

#### Passo 7.1.1 — Crie o `.env` do Docling

Crie um arquivo `.env` dentro da pasta `docling-service/`:

```env
# Auth (deve ser igual ao DOCLING_SERVICE_KEY do Smith)
SERVICE_KEY=sua-chave-secreta-aqui

# Redis
REDIS_URL=redis://localhost:6379/0

# MinIO (mesma instância do Agent Smith)
MINIO_ENDPOINT=host.docker.internal:9000   # Dev local (Docker Desktop)
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET=documents
MINIO_SECURE=false

# Vision LLM (descrição de imagens)
VISION_MODEL=gpt-4o-mini
VISION_API_URL=https://api.openai.com/v1/chat/completions
OPENAI_API_KEY=sk-...

# OCR
OCR_ENGINE=easyocr

# Limites
MAX_FILE_SIZE_MB=100
RESULT_TTL_SECONDS=3600

# Server
PORT=8001
```

> [!IMPORTANT]
> O `SERVICE_KEY` **deve ser o mesmo** valor configurado no `.env` do backend como `DOCLING_SERVICE_KEY`.
> O `OPENAI_API_KEY` pode ser a mesma chave do backend.

#### Passo 7.1.2 — Suba o Docling com Docker Compose

```bash
cd docling-service
docker-compose up --build -d
```

Isso inicia 3 containers:
- **Redis** (porta 6380) — Broker de mensagens
- **API** (porta 8001) — Recebe documentos
- **Worker** — Processa documentos em background com Docling/Celery

> [!WARNING]
> Na primeira execução, o Docling baixa modelos de AI (~1-2GB). O build pode levar **10-15 minutos**. Builds subsequentes usam cache do Docker.

#### Passo 7.1.3 — Verifique se está rodando

```bash
curl http://localhost:8001/health
# Resposta esperada: { "status": "healthy", ... }
```

#### Passo 7.1.4 — Configure o Backend para apontar ao Docling

Adicione as seguintes variáveis no `.env` do backend (`backend/.env`):

```env
# Docling Microservice
DOCLING_SERVICE_URL=http://localhost:8001       # Dev local
DOCLING_SERVICE_KEY=sua-chave-secreta-aqui      # Deve bater com SERVICE_KEY do Docling
DOCLING_POLL_INTERVAL=5                         # Segundos entre polling
DOCLING_MAX_WAIT=600                            # Timeout máximo (10 min)
```

```bash
cd ..  # Volte para a raiz
```

### 8. Inicie os Servidores

**Terminal 1 — Backend:**

```bash
cd backend
.\venv\Scripts\activate  # ou source venv/bin/activate
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 — Frontend:**

```bash
npm run dev
```

### 9. Acesse a Aplicação

| Serviço | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Admin Panel | http://localhost:3000/admin/login |
| Backend API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |
| MinIO Console | http://localhost:9001 |
| Qdrant Dashboard | http://localhost:6333/dashboard |

### 💳 Adicionar Créditos e Plano Manualmente

Para utilizar a plataforma localmente sem integração com Stripe, siga os passos abaixo:

#### Passo 1 — Crie um Plano de Teste

1. Acesse o painel admin em `http://localhost:3000/admin/login`
2. Faça login com o admin master criado no passo 6
3. Navegue até **FinOps → Planos** (`/admin/finops/plans`)
4. Clique em **Novo Plano** e preencha com dados de teste (ex: nome "Teste", preço R$ 0,00)
5. Salve o plano

#### Passo 2 — Registre uma Empresa

1. Acesse `http://localhost:3000/register`
2. Preencha o formulário de cadastro (nome, email, senha, nome da empresa)
3. Conclua o registro — isso cria automaticamente uma **empresa** e um **usuário** vinculado

#### Passo 3 — Obtenha os IDs

No **SQL Editor do Supabase**, execute:

```sql
SELECT id, name FROM plans;
SELECT id, name FROM companies;
```

Copie o `id` do plano criado e o `id` da empresa registrada.

#### Passo 4 — Insira Créditos e Ative o Plano

Substitua os IDs copiados nos campos abaixo e execute no SQL Editor:

```sql
-- 1. Adiciona R$ 100,00 de créditos
INSERT INTO company_credits (company_id, balance_brl, updated_at)
VALUES ('SEU_COMPANY_ID_AQUI', 100.00, NOW())
ON CONFLICT (company_id)
DO UPDATE SET 
    balance_brl = company_credits.balance_brl + 100.00,
    updated_at = NOW();

-- 2. Cria uma subscription ativa (necessário para desbloquear o menu)
INSERT INTO subscriptions (company_id, plan_id, status, current_period_start, current_period_end)
VALUES (
    'SEU_COMPANY_ID_AQUI',
    'SEU_PLAN_ID_AQUI',
    'active',
    NOW(),
    NOW() + INTERVAL '1 year'
)
ON CONFLICT (company_id)
DO UPDATE SET 
    status = 'active',
    plan_id = EXCLUDED.plan_id,
    current_period_end = NOW() + INTERVAL '1 year',
    cancel_at = NULL;
```

> [!NOTE]
> Após executar, faça **logout e login** novamente para a sessão carregar os dados atualizados.

---

## 📐 Padronização de Código

Este projeto utiliza ferramentas modernas para garantir a qualidade e consistência do código.

### Backend (Python)
Utilizamos **Ruff** para linting e formatação (substitui Black, Isort e Flake8).

```bash
cd backend

# Verificar erros
ruff check .

# Corrigir erros automaticamente
ruff check --fix .

# Formatar código
ruff format .
```

### Frontend (TypeScript)
Utilizamos **ESLint** e **Prettier**.

```bash
# Verificar e corrigir erros
npm run lint -- --fix
```

### UI/UX Standards
- **Loading States:** Todos os layouts (`app/dashboard`, `app/admin`) possuem `loading.tsx` padronizados.
- **Error Handling:** `global-error.tsx` e `error.tsx` implementados para captura graciosa de falhas.

---

## 📊 CSV Analytics — Análise Estruturada de Dados Tabulares

Quando um arquivo CSV é enviado para a base de conhecimento de um agente, o `DocumentService` faz o upload e a extração do texto. Em seguida, o `IngestionService` detecta automaticamente que o arquivo é CSV e aplica a estratégia **Row-to-Document**: cada linha do CSV vira um chunk individual, com o texto formatado como `"Coluna1: Valor1. Coluna2: Valor2."` e **todas as colunas da linha gravadas como metadata** no payload do Qdrant. Isso permite que o Qdrant filtre diretamente por colunas (ex: `Categoria = "Vestidos"`) sem precisar de busca vetorial.

A ferramenta `CSVAnalyticsTool` é habilitada por agente via a flag `tools_config.csv_analytics.enabled` na configuração do agente. Quando ativada, o `graph.py` instancia a tool e a disponibiliza ao LLM. Ao ser invocada (ex: "top 5 produtos mais vendidos"), a tool usa o método `qdrant.scroll_by_payload()` — uma busca **exclusivamente por metadata**, sem vetores — filtrando por `agent_id` e `file_type=csv` para isolamento multi-tenant. Os resultados são ordenados em memória pela coluna solicitada e limitados a no máximo 20 itens para proteção de contexto. Para buscas semânticas em texto livre, o agente usa a `knowledge_base_search` (RAG vetorial) ao invés da `csv_analytics`.

```mermaid
flowchart LR
    CSV[📄 Upload CSV] --> DS[DocumentService<br/>Extração de texto]
    DS --> IS["IngestionService<br/>_chunk_csv()<br/>Row-to-Document"]
    IS --> QD["Qdrant<br/>file_type=csv<br/>metadata: todas as colunas"]
    QD --> TOOL["CSVAnalyticsTool<br/>scroll_by_payload()<br/>Filtro + Ordenação"]
    TOOL --> LLM["LLM<br/>Resposta formatada"]
```

---

## 💬 Widget Embeddable — Chat para Sites Externos

O Agent Smith oferece um widget de chat que pode ser embutido em qualquer site externo com uma única linha de código. O fluxo completo funciona assim:

### Arquitetura

```mermaid
sequenceDiagram
    participant Site as Site do Cliente
    participant WJS as widget.js
    participant IFrame as iframe /embed/{agentId}
    participant API as Backend FastAPI

    Site->>WJS: Carrega script via <script>
    WJS->>IFrame: Cria iframe invisível (bolinha 70x70px)
    IFrame->>API: GET /api/agents/{agentId}/public
    API-->>IFrame: Config do agente (cores, título, lead capture)
    IFrame->>WJS: postMessage('smith:ready')
    Note over Site: Usuário clica na bolinha
    IFrame->>WJS: postMessage('smith:resize', { isOpen: true })
    WJS->>IFrame: Expande iframe para 380x600px
    IFrame->>API: POST /api/chat (chatInput, channel: 'widget')
    API-->>IFrame: Resposta do agente (streaming JSON)
```

### Instalação

O admin configura a aparência do widget na aba **Widget** do painel de configuração do agente. O código de embed é gerado automaticamente:

```html
<script id="mw" src="https://seudominio.com/widget.js"
  onload="window.mw && window.mw('init', { agentId: 'SEU_AGENT_ID' })">
</script>
```

Cole antes da tag `</body>` do site. O widget aparece como uma **bolinha flutuante** no canto inferior que, ao clicar, expande para a janela de chat completa.

### Configurações Disponíveis

| Opção | Descrição | Default |
|-------|-----------|---------|
| **Título** | Nome exibido no header do chat | `Suporte Online` |
| **Subtítulo** | Texto abaixo do título | `Geralmente responde em alguns minutos` |
| **Cor Principal** | Cor do header, botão e mensagens do usuário | `#2563EB` |
| **Posição** | `bottom-right` ou `bottom-left` | `bottom-right` |
| **Mensagem Inicial** | Primeira mensagem automática do agente | `Olá! Como posso ajudar?` |
| **Lead Capture** | Se ativo, exige nome e email antes de conversar | `true` |
| **Domínios Permitidos** | Whitelist de origens (ex: `*.meusite.com.br`) | Vazio (aceita todos) |

### Lead Capture (Captura de Leads)

Quando `requireLeadCapture` está ativo, o widget exibe um formulário de identificação antes de iniciar o chat. O lead é registrado via `POST /api/leads/identify` e o `leadId` retornado é usado como `sessionId` para toda a conversa, vinculando todas as mensagens ao contato. Se desativado, o widget gera um `sessionId` anônimo via `crypto.randomUUID()`.

### Sessão (TTL de 24h)

A sessão do widget persiste via `localStorage` com TTL de 24 horas. Após expirar:
1. Limpa o histórico de mensagens do `localStorage`
2. Envia `DELETE /api/chat/session` para limpar checkpoints do LangGraph no backend
3. Cria uma sessão nova na próxima interação

### Segurança

- **Domain Whitelist:** Se `allowedDomains` estiver configurado, o middleware `widget_security.py` valida o header `Origin`/`Referer` e bloqueia requests de domínios não autorizados (suporta wildcards: `*.meusite.com`)
- **Rate Limiting:** Limita a 50 requests/hora por identificador (IP ou leadId) via RPC atômico no banco (`check_and_increment_rate_limit`)
- **Fail-Close:** Tanto whitelist quanto rate limit bloqueiam a request em caso de erro de validação

### Funcionalidades Integradas

- **Human Handoff:** Polling a cada 3s busca mensagens de admins humanos, exibindo badge com nome do atendente
- **UCP (E-commerce):** Renderiza carrosséis de produtos, cards detalhados e botões de checkout inline no chat
- **Responsivo:** Em telas < 480px, o widget expande para fullscreen
- **Markdown:** Respostas do agente são renderizadas com `ReactMarkdown`

---

## 📜 Termos de Uso e Política de Privacidade

O Admin Master gerencia os documentos legais (Termos de Uso e Política de Privacidade) pelo painel admin em `/admin/legal-documents`. Ao criar um novo documento e marcá-lo como ativo, ele se torna a versão vigente da plataforma. Durante o cadastro, o usuário visualiza o conteúdo dos termos em um modal e, ao se registrar, o sistema grava automaticamente qual versão foi aceita e quando.

Quando o Admin Master publica uma **nova versão** dos termos, todos os usuários existentes (admins de empresa e usuários comuns) são obrigados a re-aceitar antes de continuar usando a plataforma. Um modal bloqueante aparece na próxima vez que o usuário acessa o dashboard ou o painel admin, impedindo qualquer interação até que os novos termos sejam aceitos. O Admin Master é isento deste fluxo, já que é ele quem publica os termos.

```mermaid
sequenceDiagram
    participant U as Usuário/Admin
    participant FE as Frontend (Layout)
    participant API as /api/auth/me
    participant DB as users_v2 + legal_documents
    
    U->>FE: Acessa dashboard/admin
    FE->>API: GET /api/auth/me
    API->>DB: Busca user + active terms
    DB-->>API: accepted_terms_version vs active doc id
    API-->>FE: { user, termsOutdated: true, activeTerms: {...} }
    FE->>FE: Modal bloqueante aparece
    U->>FE: Clica "Aceitar"
    FE->>API: POST /api/user/accept-terms
    API->>DB: UPDATE users_v2 SET accepted_terms_version, terms_accepted_at
    FE->>FE: Modal fecha, acesso liberado
```

---

## 📁 Estrutura do Projeto

```
SmithV5.0/
├── app/                          # Next.js App Router
│   ├── login/                    # Autenticação
│   ├── register/                 # Registro de usuários
│   ├── forgot-password/          # Recuperação de senha
│   ├── reset-password/           # Reset de senha
│   ├── admin/                    # Painel administrativo
│   ├── dashboard/                # Dashboard do usuário
│   ├── api/                      # API routes Next.js
│   ├── embed/[agentId]/          # Widget embeddable
│   └── landing/                  # Landing page
│
├── components/                   # Componentes React
│   ├── admin/                    # Componentes do admin
│   ├── ucp/                      # UCP Commerce (product cards, checkout)
│   ├── embed/                    # Widget embed components
│   └── ui/                       # shadcn/ui components
│
├── lib/                          # Utilitários frontend
│   ├── supabase/                 # Cliente Supabase
│   ├── auth.ts                   # Autenticação helpers
│   ├── adminSession.ts           # Sessão admin
│   └── utils.ts                  # Helpers
│
├── backend/                      # FastAPI Backend
│   ├── app/
│   │   ├── agents/               # LangGraph Agent
│   │   │   ├── graph.py          # Definição do grafo
│   │   │   ├── nodes.py          # Nós do grafo
│   │   │   ├── state.py          # Estado do agente
│   │   │   ├── guardrails.py     # Guardrails (PII, Prompt Injection, LlamaGuard)
│   │   │   ├── utils.py          # Utilitários do agente
│   │   │   └── tools/            # Tools (RAG, Web, Handoff, MCP, UCP, CSV, HTTP)
│   │   │
│   │   ├── api/                  # Endpoints FastAPI
│   │   │   ├── chat.py           # /chat endpoint
│   │   │   ├── documents.py      # Upload de documentos
│   │   │   ├── mcp.py            # MCP OAuth e connections
│   │   │   ├── ucp.py            # UCP Commerce endpoints
│   │   │   ├── webhook.py        # WhatsApp webhooks
│   │   │   ├── billing.py        # Billing endpoints
│   │   │   ├── stripe_checkout.py # Stripe Checkout
│   │   │   ├── stripe_webhooks.py # Stripe Webhooks
│   │   │   ├── agents.py         # CRUD de agentes
│   │   │   ├── agent_config.py   # Configuração de agentes
│   │   │   ├── plans.py          # Planos de assinatura
│   │   │   ├── pricing.py        # Tabela de preços LLM
│   │   │   └── middleware/       # Widget security middleware
│   │   │
│   │   ├── core/                 # Configurações
│   │   │   ├── config.py         # Settings (Pydantic)
│   │   │   ├── database.py       # Clientes Supabase
│   │   │   ├── auth.py           # Autenticação backend
│   │   │   ├── callbacks/        # LLM Callbacks (cost tracking)
│   │   │   ├── prompts.py        # System prompts base
│   │   │   ├── langsmith_setup.py # LangSmith observability
│   │   │   └── redis.py          # Redis client
│   │   │
│   │   ├── schemas/              # Pydantic schemas
│   │   │   └── ucp_manifest.py   # UCP manifest models
│   │   │
│   │   ├── mcp_servers/          # MCP Server implementations
│   │   │   ├── google_drive_server.py
│   │   │   ├── google_calendar_server.py
│   │   │   ├── github_server.py
│   │   │   └── slack_server.py
│   │   │
│   │   ├── workers/              # Celery Background Tasks
│   │   │   ├── celery_app.py     # Celery configuration
│   │   │   ├── billing_core.py   # Billing logic
│   │   │   └── billing_tasks.py  # Scheduled tasks
│   │   │
│   │   ├── services/             # Serviços de negócio
│   │   │   ├── memory_service.py # Sistema de memória V2
│   │   │   ├── qdrant_service.py # Operações vetoriais
│   │   │   ├── usage_service.py  # Tracking de custos
│   │   │   ├── ucp_service.py    # UCP Commerce service
│   │   │   ├── ucp_discovery.py  # UCP manifest discovery
│   │   │   ├── ucp_transport.py  # UCP transport layer
│   │   │   ├── presidio_service.py # PII masking
│   │   │   ├── llama_guard_service.py # Content moderation
│   │   │   ├── billing_service.py # Billing logic
│   │   │   ├── encryption_service.py # API key encryption
│   │   │   ├── storefront_mcp.py # Shopify Storefront MCP
│   │   │   └── ...
│   │   │
│   │   └── main.py               # Entry point FastAPI
│   │
│   ├── scripts/                  # Utilitários
│   │   ├── create_admin.py       # Criar admin master
│   │   ├── seed_pricing.py       # Popular tabela de preços
│   │   └── seed_mcp_servers.py   # Popular MCP servers
│   │
│   ├── docker-compose.yml        # Qdrant, MinIO, Redis
│   └── requirements.txt          # Dependências Python
│
└── public/                       # Arquivos estáticos
    └── widget.js                 # Script do chat widget
```

---

## ✨ Funcionalidades

### 🤖 Agentes Inteligentes
- Suporte a múltiplos LLM providers (OpenAI, Anthropic, Google)
- Configuração de temperatura, max tokens, reasoning effort
- System prompts personalizados por agente

### 📚 RAG (Retrieval-Augmented Generation)
- Upload de documentos (PDF, DOCX, TXT)
- Chunking inteligente com overlap
- Hybrid search (dense + sparse)
- Reranking com Cohere

### 🧠 Sistema de Memória V2
- Fatos extraídos automaticamente
- Sumarização de conversas
- Contexto de longo prazo por usuário

### 📱 Integrações
- WhatsApp via Z-API
- Chat Widget embeddável
- Human Handoff para atendimento humano

### 📊 Analytics
- Tracking de tokens por conversa
- Custos por modelo (OpenAI, Anthropic, Google)
- Métricas de uso por agente/empresa

### 🔒 Multi-tenancy
- Isolamento completo por `company_id`
- API keys criptografadas por empresa
- RLS (Row Level Security) no Supabase

### 🛡️ Guardrails
- PII Masking (Presidio) — Detecção e anonimização de dados pessoais
- Prompt Injection Detection — Detecção de tentativas de manipulação
- Content Moderation (LlamaGuard via Groq) — Moderação de conteúdo

### 🛒 UCP Commerce (Universal Commerce Protocol)
- Descoberta automática de catálogos via manifest
- Checkout conversacional integrado ao chat
- Suporte a Shopify Storefront MCP

---

## ⚙️ Worker de Billing (Celery)

O sistema utiliza um **Celery Worker** para processar cobranças em background. Para desenvolvimento local ou testes:

Suba o Redis (usado como message broker):

```bash
docker-compose up -d redis
```

Configure as variáveis de ambiente no `.env` (ou `.env.test` para isolamento):

```env
# Redis Local
REDIS_URL=redis://localhost:6379/0

# Configurações de Billing
BILLING_INTERVAL_MINUTES=5
BILLING_BATCH_SIZE=1000
DOLLAR_RATE=6.25  # Taxa de conversão para BRL
```

Execute o Worker (em um terminal separado):

```bash
# Windows (PowerShell)
celery -A app.workers.celery_app worker --loglevel=info --pool=solo

# Linux/Mac
celery -A app.workers.celery_app worker --loglevel=info
```

(Opcional) Execute o Scheduler (Beat) para tarefas periódicas:

```bash
celery -A app.workers.celery_app beat --loglevel=info
```

---

## 🛠 HTTP Tools (Integrações Customizadas)

O Agent Smith permite criar **ferramentas HTTP customizadas** para integrar seu agente com sistemas externos (ERP, CRM, APIs internas, etc.) — tudo via interface gráfica, sem escrever código.

### Como Criar uma HTTP Tool

1. No Admin Panel, acesse a configuração do agente
2. Vá na aba **"Ferramentas HTTP"**
3. Clique em **"Nova Ferramenta"**

### Campos de Configuração

| Campo | Descrição | Exemplo |
|-------|-----------|---------|
| Nome da Variável | Identificador único (snake_case). O agente usará como `{nome}` | `consultar_pedido` |
| Descrição/Gatilho | Instrução para a IA saber quando usar a ferramenta | "Execute quando o usuário perguntar sobre status de pedido" |
| Método HTTP | GET, POST, PUT, DELETE, PATCH | `GET` |
| URL do Endpoint | URL da API. Use `{param}` para valores dinâmicos | `https://api.loja.com/pedidos/{id}` |

### Autenticação (Headers)

Configure headers fixos para autenticação:

| Header | Valor |
|--------|-------|
| `Authorization` | `Bearer seu_token_aqui` |
| `X-API-Key` | `sua_chave_api` |
| `Content-Type` | `application/json` |

### Parâmetros Dinâmicos

Defina parâmetros que a IA extrai automaticamente da conversa:

| Nome | Tipo | Descrição para IA |
|------|------|-------------------|
| `id` | Número | Número do pedido informado pelo cliente |
| `cpf` | Texto | CPF do cliente (apenas números) |
| `data_inicio` | Texto | Data inicial no formato YYYY-MM-DD |

### Body Template (POST/PUT/PATCH)

Para métodos que enviam corpo, configure um template JSON com `{{parametro}}`:

```json
{
  "cliente": {
    "documento": "{{cpf}}",
    "nome": "{{nome}}"
  },
  "pedido": {
    "id": {{id}},
    "status": "processando"
  }
}
```

💡 Se deixar vazio, os parâmetros são enviados automaticamente como JSON simples.

### Exemplo Completo: Consultar Pedido

| Campo | Valor |
|-------|-------|
| Nome | `consultar_pedido` |
| Descrição | "Use quando o cliente perguntar sobre status, rastreio ou informações de um pedido" |
| Método | `GET` |
| URL | `https://api.minhaloja.com/v1/pedidos/{numero_pedido}` |
| Headers | `Authorization: Bearer sk-abc123...` |
| Parâmetros | `numero_pedido` (Número) - "Número do pedido informado pelo cliente" |

Conversa exemplo:

> 👤 Cliente: "Qual o status do meu pedido 12345?"
> 🤖 Agente: *chama consultar_pedido com numero_pedido=12345*
> 🤖 Agente: "Seu pedido #12345 está em trânsito! Previsão de entrega: 15/01."

---

## 🔌 MCP Tools (Model Context Protocol)

O Agent Smith suporta integração com serviços externos via **MCP (Model Context Protocol)**. Isso permite que agentes acessem Google Drive, Google Calendar, GitHub, Slack, etc.

### Servidores MCP Disponíveis

| Servidor | Arquivo | Ferramentas |
|----------|---------|-------------|
| Google Drive | `google_drive_server.py` | `list_files`, `search_files`, `get_file`, `read_file_content`, `create_folder` |
| Google Calendar | `google_calendar_server.py` | `list_calendars`, `list_events`, `create_event`, `update_event`, `delete_event` |
| GitHub | `github_server.py` | `list_repos`, `create_issue`, `list_issues` |
| Slack | `slack_server.py` | `send_message`, `list_channels` |

### Configuração MCP

Configure OAuth para cada serviço no Supabase:

- Tabela `mcp_servers`: Define os servidores disponíveis
- Tabela `agent_mcp_connections`: Tokens OAuth por agente
- Tabela `agent_mcp_tools`: Tools habilitadas por agente

Variáveis de Ambiente (Google OAuth):

```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
MCP_OAUTH_REDIRECT_URI=https://your-domain.com/api/mcp/oauth/callback
```

**Uso no Prompt do Agente:**

> Se precisar ler arquivos do Drive, use `{mcp_google_drive_read_file_content}`.
> Para verificar agenda, use `{mcp_google_calendar_list_events}`.
> O sistema expande automaticamente as variáveis `{mcp_*}` com instruções detalhadas para o LLM.

---

## 💰 Sistema de Billing

### Celery Worker

O billing é processado em background por um Celery Worker que:

1. Lê `token_usage_logs` não cobrados (`billed = false`)
2. Agrupa por `(company_id, agent_id, model_name)`
3. Calcula custo com multiplicador do `llm_pricing`
4. Debita de `company_credits` via RPC atômico
5. Marca logs como `billed = true`

### Executando o Worker Localmente

```bash
cd backend

# Terminal 1: Redis (se não estiver usando Docker)
redis-server

# Terminal 2: Celery Worker
celery -A app.workers.celery_app worker --loglevel=info

# Terminal 3: Celery Beat (agendador)
celery -A app.workers.celery_app beat --loglevel=info
```

### Variáveis do Worker

```env
REDIS_URL=redis://localhost:6379/0
DOLLAR_RATE=6.00
BILLING_BATCH_SIZE=1000
```

### Fórmula de Cobrança

```
custo_cliente_brl = total_cost_usd × DOLLAR_RATE × sell_multiplier

Onde:
- total_cost_usd = custo Anthropic/OpenAI (já com cache aplicado)
- DOLLAR_RATE = cotação do dólar (env var, default 6.00)
- sell_multiplier = margem da tabela llm_pricing (default 2.68)
```

---

## 🔥 Anthropic Prompt Caching

O sistema implementa **Prompt Caching da Anthropic** para reduzir custos em até 90%.

### Como Funciona

System Prompt é dividido em:
- `static_prompt`: Instruções fixas (cacheável)
- `dynamic_context`: Memória do usuário (não cacheável)

- Na **primeira chamada**: Cache é escrito (1.25x do preço normal)
- Nas **próximas**: Cache é lido (0.10x do preço normal = 90% desconto)

### Requisitos para Cache

| Modelo | Mínimo de Tokens |
|--------|-----------------|
| Claude Haiku | 1,024 tokens |
| Claude Sonnet | 2,048 tokens |
| Claude Opus | 2,048 tokens |

### Logs de Cache

```
[UsageService] ✅ Logged chat | claude-haiku | in=5342 | cache_w=4607 | $0.008
[UsageService] ✅ Logged chat | claude-haiku | in=5342 | cache_r=4607 | $0.002
```

### Tabelas de Pricing

Os multiplicadores de cache estão na tabela `llm_pricing`:

```sql
-- Colunas adicionadas
cache_write_multiplier   -- Anthropic: 1.25 (25% mais caro)
cache_read_multiplier    -- Anthropic: 0.10 (90% mais barato)
cached_input_multiplier  -- OpenAI: 0.50 (50% mais barato)
```

---

## 📤 Fluxo de Ingestão de Documentos

O upload de documentos é assíncrono para evitar timeouts com arquivos grandes.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   POST /upload  │ ──▶ │   MinIO Save    │ ──▶ │  DB: pending    │
│   (Síncrono)    │     │   (Storage)     │     │  (Registro)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   DB: completed │ ◀── │   Qdrant Save   │ ◀── │ BackgroundTask  │
│   (Atualizado)  │     │   (Embeddings)  │     │ (Processamento) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**Fluxo:**

1. **Upload (síncrono):** Arquivo salvo no MinIO, registro criado com `status=pending`
2. **Background Task (assíncrono):** FastAPI `BackgroundTasks` processa:
   - Extração de texto (PDF/DOCX/TXT)
   - Chunking (estratégias: recursive, semantic, page, agentic)
   - Geração de embeddings (OpenAI `text-embedding-3-small`)
   - Indexação no Qdrant
3. **Conclusão:** Status atualizado para `completed` ou `failed`

**Polling de Status:**

```
GET /api/v1/documents/{document_id}
# Retorna: { "status": "processing" | "completed" | "failed", ... }
```

---

## 📊 Monitoramento (Sentry)

O Agent Smith integra com **Sentry** para tracking de erros em produção.

### Configuração

Adicione no `.env` do backend:

```env
# Sentry - Error Tracking (opcional, mas recomendado em produção)
SENTRY_DSN=https://xxx@sentry.io/xxx
```

| Variável | Descrição |
|----------|-----------|
| `SENTRY_DSN` | DSN do projeto Sentry |

> [!NOTE]
> Se `SENTRY_DSN` não estiver configurado, o Sentry é desabilitado automaticamente.

O Sentry captura automaticamente:
- Exceções não tratadas no FastAPI
- Erros de LLM (timeouts, rate limits)
- Falhas de ingestão de documentos

---

## 🔒 Segurança e RLS

### Row Level Security (RLS)

O Supabase usa RLS para garantir isolamento multi-tenant:

| Contexto | Chave Usada | RLS |
|----------|-------------|-----|
| Frontend | `SUPABASE_ANON_KEY` | ✅ Ativo — Usuário só vê dados da sua empresa |
| Backend | `SUPABASE_KEY` (Service Role) | ❌ Ignorado — Acesso total para operações internas |

> [!CAUTION]
> **Nunca exponha a Service Role Key no frontend** — Use apenas a anon key.

Configure políticas RLS no Supabase Dashboard para cada tabela:

```sql
-- Exemplo: Política para tabela 'documents'
CREATE POLICY "Users can only see their company documents"
ON public.documents
FOR SELECT
USING (company_id = (SELECT company_id FROM users_v2 WHERE id = auth.uid()));
```

Todas as tabelas sensíveis devem ter RLS habilitado:
- `companies`, `agents`, `documents`, `conversations`, `messages`
- `users_v2`, `integrations`, `token_usage_logs`

### Criptografia de API Keys

As API keys de LLM são criptografadas com **Fernet** antes de salvar no banco:

```bash
# Gerar chave de criptografia
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Adicione no `.env`:

```env
ENCRYPTION_KEY=sua-chave-fernet-aqui
```

---

## 📄 Docling Service — Sanitização Inteligente de Documentos

O **Docling Service** é um microserviço separado que converte documentos (PDF, DOCX) em Markdown estruturado usando [IBM Docling](https://github.com/DS4SD/docling). Ele roda como serviço independente para evitar que suas dependências pesadas (PyTorch, modelos de OCR) impactem o build do backend principal.

### O que faz

- **OCR avançado** — Extrai texto de PDFs escaneados e imagens usando RapidOCR + Tesseract
- **Detecção de tabelas** — Identifica e estrutura tabelas com TableFormer
- **Descrição de imagens** — Usa GPT-4o-mini para descrever imagens em português
- **Layout inteligente** — Preserva hierarquia de títulos, listas e seções
- **Saída Markdown** — Gera Markdown limpo pronto para ingestão no RAG

### Arquitetura

```
Smith Backend                    Docling Service
─────────────                    ──────────────
                                ┌──────────┐
POST /parse ──── HTTP ─────────▶│  API     │
(envia arquivo)                 │ (FastAPI)│
                                └────┬─────┘
                                     │ salva arquivo
                                     ▼
                                ┌──────────┐
                                │  MinIO   │ ◀── Storage compartilhado
                                │(documents│     (bucket "documents")
                                │  bucket) │
                                └────┬─────┘
                                     │ enfileira task
                                     ▼
                                ┌──────────┐
                                │  Redis   │ ◀── Broker + Result Backend
                                │          │
                                └────┬─────┘
                                     │ worker pega task
                                     ▼
                                ┌──────────┐
                                │  Worker  │ ◀── Celery Worker
                                │ (Docling)│     (parse + OCR + visão)
                                └────┬─────┘
                                     │ resultado no Redis
                                     ▼
GET /status/{id} ── HTTP ──────▶ retorna markdown + metadata
(polling)
```

**Fluxo detalhado:**

1. **Smith Backend** envia o arquivo via `POST /parse` → recebe `task_id` (202 Accepted)
2. **API** salva o arquivo no MinIO em `docling-temp/{task_id}/{filename}`
3. **API** enfileira task Celery com o path do MinIO
4. **Worker** baixa o arquivo do MinIO → processa com Docling → retorna resultado via Redis
5. **Worker** limpa o arquivo temporário do MinIO e do `/tmp` local
6. **Smith Backend** faz polling `GET /status/{task_id}` até receber `status: completed`

### Estrutura do Microserviço

```
docling-service/
├── app/
│   ├── __init__.py
│   ├── config.py          # Settings (Pydantic) — MinIO, Redis, Vision, OCR
│   ├── celery_app.py      # Celery config — queue "docling", prefork
│   ├── tasks.py           # Task parse_document — download MinIO → Docling → cleanup
│   └── main.py            # FastAPI — POST /parse, GET /status/{id}, GET /health
├── Dockerfile             # Python 3.11 + PyTorch CPU-only + Docling
├── docker-compose.yml     # Dev local: Redis + API + Worker
├── requirements.txt       # FastAPI, Celery, Docling, MinIO
└── README.md              # Docs detalhados
```

### Componentes

| Componente | Função | Tecnologia |
|------------|--------|-----------|
| **API** | Recebe arquivos, salva no MinIO, enfileira tasks | FastAPI + MinIO SDK |
| **Worker** | Baixa do MinIO, processa com Docling, retorna Markdown | Celery + Docling + PyTorch CPU |
| **Redis** | Broker de mensagens + armazenamento de resultados | Redis 7 |
| **MinIO** | Storage de arquivos temporários (compartilhado com Smith) | MinIO (mesmo bucket `documents`) |

### Variáveis de Ambiente

#### Docling Service (`.env`)

```env
# Auth (deve ser igual ao DOCLING_SERVICE_KEY do Smith)
SERVICE_KEY=sua-chave-secreta-aqui

# Redis
REDIS_URL=redis://localhost:6379/0

# MinIO (mesma instância do Agent Smith)
MINIO_ENDPOINT=host.docker.internal:9000   # Dev local (Docker Desktop)
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET=documents
MINIO_SECURE=false

# Vision LLM (descrição de imagens)
VISION_MODEL=gpt-4o-mini
VISION_API_URL=https://api.openai.com/v1/chat/completions
OPENAI_API_KEY=sk-...

# OCR
OCR_ENGINE=easyocr

# Limites
MAX_FILE_SIZE_MB=100
RESULT_TTL_SECONDS=3600

# Server
PORT=8001
```

#### Smith Backend (adicionar ao `.env` existente)

```env
# Docling Microservice
DOCLING_SERVICE_URL=http://localhost:8001       # Dev local
DOCLING_SERVICE_KEY=sua-chave-secreta-aqui      # Deve bater com SERVICE_KEY do Docling
DOCLING_POLL_INTERVAL=5                         # Segundos entre polling
DOCLING_MAX_WAIT=600                            # Timeout máximo (10 min)
```

### Dev Local

```bash
# Terminal 1: Suba o MinIO e Redis do Smith (se não estiver rodando)
cd backend && docker compose up -d

# Terminal 2: Suba o Docling Service
cd docling-service
cp .env.example .env   # Configure as variáveis
docker-compose up --build

# Terminal 3: Suba o Smith Backend
cd backend && uvicorn app.main:app --reload
```

O Docling Service estará em `http://localhost:8001`. Teste com:

```bash
curl -X POST http://localhost:8001/parse \
  -H "X-Service-Key: sua-chave" \
  -F "file=@documento.pdf"
```

### Deploy (Railway)

No Railway, crie 3 serviços para o Docling:

| Serviço | Comando | Notas |
|---------|---------|-------|
| **Redis** | Add-on Railway | Redis compartilhado com Smith |
| **Docling API** | CMD default do Dockerfile | `uvicorn app.main:app ...` |
| **Docling Worker** | Override | `celery -A app.celery_app worker -Q docling -c 2 --loglevel=info` |

Env vars de produção:

```env
MINIO_ENDPOINT=minio-production-xxxx.up.railway.app:443
MINIO_SECURE=true
MINIO_ACCESS_KEY=<mesmo do Smith>
MINIO_SECRET_KEY=<mesmo do Smith>
REDIS_URL=redis://default:xxx@redis.railway.internal:6379
```

No Smith Backend (Railway), adicione:

```env
DOCLING_SERVICE_URL=http://docling-api.railway.internal:8001
DOCLING_SERVICE_KEY=sua-chave-secreta
```

---

## 📝 Licença

Proprietário — © 2026 Breno Lion Lab
