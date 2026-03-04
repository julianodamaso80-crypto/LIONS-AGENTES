-- ============================================================
-- SubAgent System Migration
-- Agent Smith V6.1 — Multi-Agent Delegation
-- ============================================================

-- 1. agent_delegations: Relação Orquestrador ↔ SubAgent
CREATE TABLE IF NOT EXISTS agent_delegations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    orchestrator_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    subagent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    task_description TEXT NOT NULL,         -- "Especialista em e-commerce e estoque"
    is_active BOOLEAN DEFAULT true,
    max_context_chars INTEGER DEFAULT 2000,
    timeout_seconds INTEGER DEFAULT 30,
    max_iterations INTEGER DEFAULT 5,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Constraints
    CONSTRAINT no_self_delegation CHECK (orchestrator_id != subagent_id),
    CONSTRAINT unique_delegation UNIQUE (orchestrator_id, subagent_id)
);

-- Index para lookup rápido no create_agent_graph
CREATE INDEX IF NOT EXISTS idx_delegations_orchestrator
    ON agent_delegations(orchestrator_id)
    WHERE is_active = true;

-- 2. agents: Flags de SubAgent
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS is_subagent BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS allow_direct_chat BOOLEAN DEFAULT false;

-- Comentários
COMMENT ON COLUMN agents.is_subagent IS 'Se true, esconde widget/WhatsApp/canais públicos no frontend';
COMMENT ON COLUMN agents.allow_direct_chat IS 'Se true, subagent aparece no chat test para o admin treinar/debugar';

-- 3. conversation_logs: Campo para traces de SubAgent
ALTER TABLE conversation_logs
    ADD COLUMN IF NOT EXISTS internal_steps JSONB DEFAULT NULL;

COMMENT ON COLUMN conversation_logs.internal_steps IS 'Traces de execução de SubAgents (ReAct loop steps, tokens, latência)';

-- 4. RLS (Row Level Security) para agent_delegations
ALTER TABLE agent_delegations ENABLE ROW LEVEL SECURITY;

-- Política: Apenas agentes da mesma empresa podem ser vinculados
-- (validação feita na API, RLS garante isolamento por company)
CREATE POLICY "delegations_same_company" ON agent_delegations
    FOR ALL
    USING (
        (SELECT company_id FROM agents WHERE id = orchestrator_id)
        =
        (SELECT company_id FROM agents WHERE id = subagent_id)
    );

-- 5. Trigger para updated_at automático
CREATE OR REPLACE FUNCTION update_agent_delegations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_delegations_updated_at
    BEFORE UPDATE ON agent_delegations
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_delegations_updated_at();
