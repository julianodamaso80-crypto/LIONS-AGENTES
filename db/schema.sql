-- =============================================
-- Agent Smith V6 - PostgreSQL Schema
-- Migrated from Supabase to Railway Postgres
-- =============================================

SET statement_timeout = 0;
SET client_encoding = 'UTF8';

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- TABLES
-- =============================================

-- Admin Users (Master Admins)
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    reset_token VARCHAR(255),
    reset_token_expires_at TIMESTAMPTZ,
    reset_attempts INTEGER DEFAULT 0,
    password_migrated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Companies
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    cnpj VARCHAR(20),
    webhook_url TEXT DEFAULT '',
    n8n_instance_url TEXT,
    plan_type VARCHAR(50) DEFAULT 'trial',
    monthly_fee DECIMAL(10,2) DEFAULT 0,
    setup_fee DECIMAL(10,2) DEFAULT 0,
    max_users INTEGER DEFAULT 5,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'trial', 'suspended', 'cancelled')),
    primary_contact_name VARCHAR(255),
    primary_contact_email VARCHAR(255),
    primary_contact_phone VARCHAR(50),
    notes TEXT,
    cep VARCHAR(10),
    street VARCHAR(255),
    number VARCHAR(20),
    complement VARCHAR(255),
    neighborhood VARCHAR(255),
    city VARCHAR(255),
    state VARCHAR(5),
    use_langchain BOOLEAN DEFAULT TRUE,
    allow_web_search BOOLEAN DEFAULT FALSE,
    allow_vision BOOLEAN DEFAULT FALSE,
    vision_api_key TEXT,
    agent_enabled BOOLEAN DEFAULT TRUE,
    agent_system_prompt TEXT,
    llm_provider VARCHAR(50),
    llm_model VARCHAR(100),
    llm_temperature DECIMAL(3,2) DEFAULT 0.7,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Plans (Subscription Plans)
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    monthly_price DECIMAL(10,2) DEFAULT 0,
    yearly_price DECIMAL(10,2) DEFAULT 0,
    credits_limit INTEGER DEFAULT 0,
    storage_limit_mb INTEGER DEFAULT 500,
    max_users INTEGER,
    features JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    price_brl DECIMAL(10,2) DEFAULT 0,
    display_credits INTEGER DEFAULT 0,
    max_agents INTEGER DEFAULT 1,
    max_knowledge_bases INTEGER DEFAULT 1,
    stripe_product_id VARCHAR(255),
    stripe_price_id VARCHAR(255),
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Legal Documents (Terms & Privacy)
CREATE TABLE IF NOT EXISTS legal_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL CHECK (type IN ('terms_of_use', 'privacy_policy')),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    version VARCHAR(20) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES admin_users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users V2
CREATE TABLE IF NOT EXISTS users_v2 (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    cpf VARCHAR(11) UNIQUE,
    phone VARCHAR(20),
    birth_date DATE,
    plan_id UUID REFERENCES plans(id),
    plan_status VARCHAR(20) DEFAULT 'active' CHECK (plan_status IN ('active', 'past_due', 'canceled', 'suspended')),
    subscription_amount DECIMAL(10,2),
    billing_cycle VARCHAR(10) CHECK (billing_cycle IN ('monthly', 'yearly')),
    subscription_started_at TIMESTAMPTZ,
    subscription_renews_at TIMESTAMPTZ,
    subscription_canceled_at TIMESTAMPTZ,
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    credits_used_this_month INTEGER DEFAULT 0,
    credits_limit INTEGER,
    storage_used_mb INTEGER DEFAULT 0,
    storage_limit_mb INTEGER,
    usage_reset_date TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    last_login_ip VARCHAR(50),
    failed_login_attempts INTEGER DEFAULT 0,
    account_locked_until TIMESTAMPTZ,
    terms_accepted_at TIMESTAMPTZ,
    privacy_policy_accepted_at TIMESTAMPTZ,
    accepted_terms_version UUID REFERENCES legal_documents(id),
    marketing_consent BOOLEAN DEFAULT FALSE,
    data_deletion_requested_at TIMESTAMPTZ,
    google_id VARCHAR(255) UNIQUE,
    github_id VARCHAR(255) UNIQUE,
    oauth_provider VARCHAR(20) DEFAULT 'email' CHECK (oauth_provider IN ('email', 'google', 'github')),
    company_id UUID REFERENCES companies(id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'lead')),
    role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('admin_company', 'member')),
    is_owner BOOLEAN DEFAULT FALSE,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    avatar_url TEXT,
    reset_token VARCHAR(255),
    reset_token_expires_at TIMESTAMPTZ,
    reset_attempts INTEGER DEFAULT 0,
    password_migrated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Agents (AI Agents)
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    llm_provider VARCHAR(50) DEFAULT 'openai',
    llm_model VARCHAR(100) DEFAULT 'gpt-4o',
    llm_temperature DECIMAL(3,2) DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 4096,
    top_p DECIMAL(3,2),
    top_k INTEGER,
    frequency_penalty DECIMAL(3,2),
    presence_penalty DECIMAL(3,2),
    system_prompt TEXT,
    vision_enabled BOOLEAN DEFAULT FALSE,
    vision_detail VARCHAR(10) DEFAULT 'auto',
    widget_config JSONB DEFAULT '{}',
    security_settings JSONB DEFAULT '{}',
    avatar_url TEXT,
    reasoning_effort VARCHAR(10) DEFAULT 'medium' CHECK (reasoning_effort IN ('none', 'low', 'medium', 'high')),
    verbosity VARCHAR(10) DEFAULT 'medium' CHECK (verbosity IN ('low', 'medium', 'high')),
    is_hyde_enabled BOOLEAN DEFAULT FALSE,
    is_subagent BOOLEAN DEFAULT FALSE,
    allow_direct_chat BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(company_id, slug)
);

-- Agent HTTP Tools
CREATE TABLE IF NOT EXISTS agent_http_tools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    method VARCHAR(10) DEFAULT 'GET',
    url TEXT NOT NULL,
    headers JSONB DEFAULT '{}',
    parameters JSONB DEFAULT '{}',
    body_template JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, name)
);

-- Agent Delegations (SubAgent System)
CREATE TABLE IF NOT EXISTS agent_delegations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    orchestrator_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    subagent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    task_description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    max_context_chars INTEGER DEFAULT 4000,
    timeout_seconds INTEGER DEFAULT 60,
    max_iterations INTEGER DEFAULT 5,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(orchestrator_id, subagent_id),
    CHECK (orchestrator_id != subagent_id)
);

-- MCP Servers
CREATE TABLE IF NOT EXISTS mcp_servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    description TEXT,
    package_name VARCHAR(255),
    command JSONB,
    oauth_provider VARCHAR(100),
    oauth_scopes JSONB DEFAULT '[]',
    env_vars JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent MCP Connections
CREATE TABLE IF NOT EXISTS agent_mcp_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    mcp_server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes_granted JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT TRUE,
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, mcp_server_id)
);

-- Agent MCP Tools
CREATE TABLE IF NOT EXISTS agent_mcp_tools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    mcp_server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    mcp_server_name VARCHAR(100),
    tool_name VARCHAR(255) NOT NULL,
    variable_name VARCHAR(255),
    description TEXT,
    input_schema JSONB,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, mcp_server_id, tool_name)
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users_v2(id),
    company_id UUID REFERENCES companies(id),
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    session_id VARCHAR(500) UNIQUE,
    title VARCHAR(500),
    status VARCHAR(50) DEFAULT 'open',
    channel VARCHAR(50) DEFAULT 'web',
    last_message_preview TEXT,
    unread_count INTEGER DEFAULT 0,
    agent_name VARCHAR(255),
    status_color VARCHAR(20),
    user_name VARCHAR(255),
    user_avatar TEXT,
    user_phone VARCHAR(50),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    human_handoff_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT,
    type VARCHAR(20) DEFAULT 'text' CHECK (type IN ('text', 'voice')),
    audio_url TEXT,
    image_url TEXT,
    sender_user_id UUID REFERENCES users_v2(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation Logs
CREATE TABLE IF NOT EXISTS conversation_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users_v2(id),
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    session_id VARCHAR(500),
    user_question TEXT,
    assistant_response TEXT,
    llm_provider VARCHAR(50),
    llm_model VARCHAR(100),
    llm_temperature DECIMAL(3,2),
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    rag_chunks JSONB,
    rag_chunks_count INTEGER DEFAULT 0,
    response_time_ms INTEGER,
    rag_search_time_ms INTEGER,
    status VARCHAR(20) DEFAULT 'success',
    error_message TEXT,
    search_strategy VARCHAR(50),
    retrieval_score DECIMAL(5,4),
    internal_steps JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Integrations (WhatsApp/Z-API)
CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    provider VARCHAR(50) DEFAULT 'z-api',
    identifier VARCHAR(100) NOT NULL,
    token TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    base_url TEXT DEFAULT 'https://api.z-api.io/instances',
    is_active BOOLEAN DEFAULT TRUE,
    client_token TEXT,
    buffer_enabled BOOLEAN DEFAULT TRUE,
    buffer_debounce_seconds INTEGER DEFAULT 3,
    buffer_max_wait_seconds INTEGER DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider, identifier)
);

-- Invites
CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(20) DEFAULT 'member',
    is_owner_invite BOOLEAN DEFAULT FALSE,
    email VARCHAR(255),
    email_restriction VARCHAR(255),
    name VARCHAR(255),
    max_uses INTEGER DEFAULT 1,
    current_uses INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_by UUID REFERENCES users_v2(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leads
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    email VARCHAR(255),
    name VARCHAR(255),
    phone VARCHAR(50),
    custom_fields JSONB DEFAULT '{}',
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(company_id, email)
);

-- Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
    plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing')),
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    stripe_subscription_id VARCHAR(255),
    stripe_customer_id VARCHAR(255),
    cancel_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Company Credits
CREATE TABLE IF NOT EXISTS company_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
    balance_brl DECIMAL(12,4) DEFAULT 0,
    alert_80_sent BOOLEAN DEFAULT FALSE,
    alert_100_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Credit Transactions
CREATE TABLE IF NOT EXISTS credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('subscription', 'topup', 'consumption', 'refund', 'bonus')),
    amount_brl DECIMAL(12,4) NOT NULL,
    balance_after DECIMAL(12,4),
    model_name VARCHAR(100),
    input_tokens INTEGER,
    output_tokens INTEGER,
    description TEXT,
    stripe_payment_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Token Usage Logs
CREATE TABLE IF NOT EXISTS token_usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    service_type VARCHAR(50),
    model_name VARCHAR(100),
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_cost_usd DECIMAL(12,8) DEFAULT 0,
    details JSONB,
    billed BOOLEAN DEFAULT FALSE,
    billed_at TIMESTAMPTZ,
    cache_creation_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cached_tokens INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- LLM Pricing
CREATE TABLE IF NOT EXISTS llm_pricing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name VARCHAR(200) NOT NULL UNIQUE,
    input_price_per_million DECIMAL(12,6) DEFAULT 0,
    output_price_per_million DECIMAL(12,6) DEFAULT 0,
    unit VARCHAR(50) DEFAULT 'token',
    is_active BOOLEAN DEFAULT TRUE,
    provider VARCHAR(100),
    display_name VARCHAR(255),
    sell_multiplier DECIMAL(5,2) DEFAULT 1.5,
    cache_write_multiplier DECIMAL(5,4) DEFAULT 1.25,
    cache_read_multiplier DECIMAL(5,4) DEFAULT 0.1,
    cached_input_multiplier DECIMAL(5,4) DEFAULT 0.5,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents (Knowledge Base)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    file_name VARCHAR(500) NOT NULL,
    file_type VARCHAR(20) CHECK (file_type IN ('pdf', 'docx', 'txt', 'md', 'csv')),
    file_size INTEGER,
    minio_path TEXT,
    qdrant_collection VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    chunks_count INTEGER DEFAULT 0,
    processed_at TIMESTAMPTZ,
    ingestion_strategy VARCHAR(20) DEFAULT 'recursive' CHECK (ingestion_strategy IN ('recursive', 'semantic', 'page', 'agentic', 'csv')),
    quality_score DECIMAL(5,4),
    quality_audited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- System Logs
CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    user_id UUID REFERENCES users_v2(id),
    admin_id UUID REFERENCES admin_users(id),
    company_id UUID REFERENCES companies(id),
    action_type VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    session_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'success' CHECK (status IN ('success', 'error', 'warning')),
    error_message TEXT
);

-- Password Reset Tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users_v2(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment History
CREATE TABLE IF NOT EXISTS payment_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users_v2(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(5) DEFAULT 'BRL',
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    payment_method VARCHAR(20) CHECK (payment_method IN ('credit_card', 'pix', 'boleto')),
    stripe_payment_intent_id VARCHAR(255),
    stripe_invoice_id VARCHAR(255),
    description TEXT,
    metadata JSONB DEFAULT '{}',
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sanitization Jobs
CREATE TABLE IF NOT EXISTS sanitization_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id),
    original_filename VARCHAR(500),
    original_file_path TEXT,
    original_file_size INTEGER,
    original_mime_type VARCHAR(100),
    sanitized_file_path TEXT,
    sanitized_file_size INTEGER,
    status VARCHAR(20) DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    error_message TEXT,
    pages_count INTEGER,
    images_count INTEGER,
    tables_count INTEGER,
    processing_time_seconds DECIMAL(10,2),
    extract_images BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Memory Settings
CREATE TABLE IF NOT EXISTS memory_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE UNIQUE,
    web_summarization_mode VARCHAR(50) DEFAULT 'after_inactivity',
    web_message_threshold INTEGER DEFAULT 10,
    web_inactivity_timeout_min INTEGER DEFAULT 5,
    whatsapp_summarization_mode VARCHAR(50) DEFAULT 'sliding_window',
    whatsapp_sliding_window_size INTEGER DEFAULT 20,
    whatsapp_time_interval_hours INTEGER DEFAULT 24,
    whatsapp_message_threshold INTEGER DEFAULT 15,
    extract_user_profile BOOLEAN DEFAULT TRUE,
    extract_session_summary BOOLEAN DEFAULT TRUE,
    memory_llm_model VARCHAR(100) DEFAULT 'gpt-4o-mini',
    debounce_seconds INTEGER DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Memories
CREATE TABLE IF NOT EXISTS user_memories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users_v2(id),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    profile JSONB DEFAULT '{}',
    facts TEXT[] DEFAULT '{}',
    facts_metadata JSONB DEFAULT '{}',
    facts_count INTEGER DEFAULT 0,
    last_extraction_at TIMESTAMPTZ,
    last_consolidation_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, company_id, COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'))
);

-- Session Summaries
CREATE TABLE IF NOT EXISTS session_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users_v2(id),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    session_id VARCHAR(500),
    summary TEXT,
    channel VARCHAR(50),
    messages_count INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    topics TEXT[] DEFAULT '{}',
    decisions TEXT[] DEFAULT '{}',
    pending_items TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Memory Processing Locks
CREATE TABLE IF NOT EXISTS memory_processing_locks (
    session_id VARCHAR(500) NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    is_processing BOOLEAN DEFAULT FALSE,
    last_trigger_at TIMESTAMPTZ,
    last_completed_at TIMESTAMPTZ,
    last_message_count INTEGER DEFAULT 0,
    scheduled_for TIMESTAMPTZ,
    PRIMARY KEY (session_id, company_id),
    UNIQUE(session_id, company_id)
);

-- UCP Connections (E-commerce)
CREATE TABLE IF NOT EXISTS ucp_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_url TEXT NOT NULL,
    manifest_cached JSONB,
    manifest_version VARCHAR(50),
    preferred_transport VARCHAR(50),
    capabilities_enabled TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, store_url)
);

-- Widget Rate Limits
CREATE TABLE IF NOT EXISTS widget_rate_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(255) NOT NULL,
    identifier_type VARCHAR(50) DEFAULT 'session',
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    request_count INTEGER DEFAULT 0,
    window_start TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(identifier, agent_id, identifier_type)
);

-- LangGraph Checkpoints
CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type TEXT,
    checkpoint JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS checkpoint_blobs (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT,
    blob BYTEA,
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT,
    type TEXT,
    blob BYTEA,
    task_path TEXT,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

CREATE TABLE IF NOT EXISTS checkpoint_migrations (
    v INTEGER PRIMARY KEY
);

-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX IF NOT EXISTS idx_users_v2_email ON users_v2(email);
CREATE INDEX IF NOT EXISTS idx_users_v2_company ON users_v2(company_id);
CREATE INDEX IF NOT EXISTS idx_users_v2_status ON users_v2(status);
CREATE INDEX IF NOT EXISTS idx_users_v2_role ON users_v2(role);
CREATE INDEX IF NOT EXISTS idx_users_v2_cpf ON users_v2(cpf);

CREATE INDEX IF NOT EXISTS idx_agents_company ON agents(company_id);
CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_company ON conversations(company_id);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE INDEX IF NOT EXISTS idx_conversation_logs_company ON conversation_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_session ON conversation_logs(session_id);

CREATE INDEX IF NOT EXISTS idx_integrations_identifier ON integrations(identifier);
CREATE INDEX IF NOT EXISTS idx_integrations_agent ON integrations(agent_id);
CREATE INDEX IF NOT EXISTS idx_integrations_company ON integrations(company_id);

CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_company ON invites(company_id);

CREATE INDEX IF NOT EXISTS idx_token_usage_company ON token_usage_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_token_usage_billed ON token_usage_logs(billed) WHERE billed = FALSE;

CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_agent ON documents(agent_id);

CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_company ON system_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_action ON system_logs(action_type);

CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company_id);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(company_id, email);

CREATE INDEX IF NOT EXISTS idx_subscriptions_company ON subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_company ON credit_transactions(company_id);

-- =============================================
-- FUNCTIONS
-- =============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create user account (replaces Supabase RPC)
CREATE OR REPLACE FUNCTION create_user_account(
    p_email VARCHAR,
    p_password_hash VARCHAR,
    p_first_name VARCHAR,
    p_last_name VARCHAR,
    p_cpf VARCHAR,
    p_phone VARCHAR,
    p_birth_date DATE,
    p_company_id UUID DEFAULT NULL,
    p_status VARCHAR DEFAULT 'pending',
    p_role VARCHAR DEFAULT 'member',
    p_is_owner BOOLEAN DEFAULT FALSE,
    p_accepted_terms_version UUID DEFAULT NULL
) RETURNS TABLE(
    id UUID,
    email VARCHAR,
    first_name VARCHAR,
    last_name VARCHAR,
    company_id UUID,
    role VARCHAR,
    status VARCHAR,
    is_owner BOOLEAN,
    created_at TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM users_v2 WHERE users_v2.email = p_email) THEN
        RAISE EXCEPTION 'Email already exists';
    END IF;

    IF p_role NOT IN ('admin_company', 'member') THEN
        RAISE EXCEPTION 'Invalid role';
    END IF;

    IF p_status NOT IN ('active', 'pending', 'suspended') THEN
        RAISE EXCEPTION 'Invalid status';
    END IF;

    IF p_role = 'member' AND p_is_owner = TRUE THEN
        RAISE EXCEPTION 'Members cannot be owners';
    END IF;

    RETURN QUERY
    INSERT INTO users_v2 (
        first_name, last_name, email, password_hash, cpf, phone, birth_date,
        company_id, status, role, is_owner, accepted_terms_version,
        terms_accepted_at, privacy_policy_accepted_at, created_at, updated_at
    ) VALUES (
        p_first_name, p_last_name, p_email, p_password_hash, p_cpf, p_phone, p_birth_date,
        p_company_id, p_status, p_role, p_is_owner, p_accepted_terms_version,
        NOW(), NOW(), NOW(), NOW()
    )
    RETURNING
        users_v2.id, users_v2.email, users_v2.first_name, users_v2.last_name,
        users_v2.company_id, users_v2.role, users_v2.status, users_v2.is_owner,
        users_v2.created_at;
END;
$$;

-- Get user for login (replaces Supabase RPC)
CREATE OR REPLACE FUNCTION get_user_for_login(p_email VARCHAR)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'password_hash', u.password_hash,
        'first_name', u.first_name,
        'last_name', u.last_name,
        'cpf', u.cpf,
        'phone', u.phone,
        'company_id', u.company_id,
        'status', u.status,
        'role', u.role,
        'is_owner', u.is_owner,
        'plan_id', u.plan_id,
        'failed_login_attempts', u.failed_login_attempts,
        'account_locked_until', u.account_locked_until,
        'avatar_url', u.avatar_url
    ) INTO result
    FROM users_v2 u
    WHERE LOWER(u.email) = LOWER(p_email)
    AND u.deleted_at IS NULL;

    RETURN result;
END;
$$;

-- Token usage report (replaces Supabase RPC)
CREATE OR REPLACE FUNCTION get_token_usage_report(start_date TIMESTAMPTZ, end_date TIMESTAMPTZ)
RETURNS TABLE(
    service_type VARCHAR,
    model_name VARCHAR,
    total_input_tokens BIGINT,
    total_output_tokens BIGINT,
    total_cost DECIMAL,
    request_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.service_type,
        t.model_name,
        SUM(t.input_tokens)::BIGINT,
        SUM(t.output_tokens)::BIGINT,
        SUM(t.total_cost_usd),
        COUNT(*)::BIGINT
    FROM token_usage_logs t
    WHERE t.created_at >= start_date AND t.created_at <= end_date
    GROUP BY t.service_type, t.model_name
    ORDER BY SUM(t.total_cost_usd) DESC;
END;
$$;

-- Token usage by company (replaces Supabase RPC)
CREATE OR REPLACE FUNCTION get_token_usage_by_company(start_date TIMESTAMPTZ, end_date TIMESTAMPTZ)
RETURNS TABLE(
    company_id UUID,
    total_input_tokens BIGINT,
    total_output_tokens BIGINT,
    total_cost DECIMAL,
    request_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.company_id,
        SUM(t.input_tokens)::BIGINT,
        SUM(t.output_tokens)::BIGINT,
        SUM(t.total_cost_usd),
        COUNT(*)::BIGINT
    FROM token_usage_logs t
    WHERE t.created_at >= start_date AND t.created_at <= end_date
    GROUP BY t.company_id
    ORDER BY SUM(t.total_cost_usd) DESC;
END;
$$;

-- Rate limit check (replaces Supabase RPC)
CREATE OR REPLACE FUNCTION check_and_increment_rate_limit(
    p_identifier TEXT,
    p_agent_id UUID,
    p_max_requests INTEGER DEFAULT 50,
    p_window_minutes INTEGER DEFAULT 60
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_record RECORD;
    v_new_count INTEGER;
    v_window_seconds INTEGER;
BEGIN
    v_window_seconds := p_window_minutes * 60;

    SELECT id, request_count, window_start INTO v_record
    FROM widget_rate_limits
    WHERE identifier = p_identifier AND agent_id = p_agent_id
    FOR UPDATE;

    IF FOUND THEN
        IF EXTRACT(EPOCH FROM (NOW() - v_record.window_start)) > v_window_seconds THEN
            UPDATE widget_rate_limits SET request_count = 1, window_start = NOW()
            WHERE id = v_record.id;
            RETURN 1;
        END IF;

        IF v_record.request_count >= p_max_requests THEN
            RETURN -1;
        END IF;

        UPDATE widget_rate_limits SET request_count = request_count + 1
        WHERE id = v_record.id
        RETURNING request_count INTO v_new_count;
        RETURN v_new_count;
    ELSE
        INSERT INTO widget_rate_limits (identifier, identifier_type, agent_id, request_count, window_start)
        VALUES (p_identifier, 'session', p_agent_id, 1, NOW())
        ON CONFLICT (identifier, agent_id, identifier_type) DO UPDATE
        SET request_count = widget_rate_limits.request_count + 1
        RETURNING request_count INTO v_new_count;
        RETURN COALESCE(v_new_count, 1);
    END IF;
END;
$$;

-- Debit company balance
CREATE OR REPLACE FUNCTION debit_company_balance(
    p_company_id UUID,
    p_amount DECIMAL
) RETURNS DECIMAL LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_new_balance DECIMAL;
BEGIN
    UPDATE company_credits
    SET balance_brl = balance_brl - p_amount, updated_at = NOW()
    WHERE company_id = p_company_id
    RETURNING balance_brl INTO v_new_balance;

    RETURN COALESCE(v_new_balance, 0);
END;
$$;

-- =============================================
-- TRIGGERS
-- =============================================

CREATE OR REPLACE TRIGGER update_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_users_v2_updated_at
    BEFORE UPDATE ON users_v2
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_legal_documents_updated_at
    BEFORE UPDATE ON legal_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trigger_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER ucp_connections_updated_at
    BEFORE UPDATE ON ucp_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- UCP Connection Summary View
-- =============================================

CREATE OR REPLACE VIEW ucp_connection_summary AS
SELECT
    uc.id, uc.agent_id, uc.company_id, uc.store_url,
    uc.manifest_version, uc.preferred_transport,
    COALESCE(array_length(uc.capabilities_enabled, 1), 0) as capabilities_count,
    uc.is_active, uc.last_used_at, uc.created_at,
    a.name as agent_name
FROM ucp_connections uc
JOIN agents a ON a.id = uc.agent_id
WHERE uc.is_active = TRUE;
