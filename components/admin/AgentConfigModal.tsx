'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Brain,
  Settings,
  Loader2,
  CheckCircle,
  TestTube,
  MessageCircle,
  Eye,
  EyeOff,
  Headset,
  Plus,
  Trash,
  Edit2,
  Terminal,
  Plug,
  Code,
  Shield,
  Lock,
  AlertTriangle,
  FileCode,
  Globe,
  Users,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { MemoryConfigTab } from '@/components/admin/MemoryConfigTab';
import { HttpToolForm, HttpTool } from '@/components/admin/HttpToolForm';
import { AvatarUpload } from '@/components/AvatarUpload';
import { WidgetConfigTab } from '@/components/admin/WidgetConfigTab';
import { MCPConfigTab } from '@/components/admin/MCPConfigTab';
import { UCPConfigTab } from '@/components/admin/UCPConfigTab';
import { SubAgentConfigTab } from '@/components/admin/SubAgentConfigTab';
import { Agent, WidgetConfig, SecuritySettings } from '@/types/agent';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface Props {
  companyId: string;
  agentId?: string; // Optional: undefined = create mode
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProviderInfo {
  name: string;
  display_name: string;
  models_count: number;
}

const DEFAULT_SYSTEM_PROMPT = `Você é o Agent Smith, um assistente inteligente e prestativo.
Seja profissional, claro e objetivo nas suas respostas.
Se não souber a resposta, diga que não sabe.`;

// =============================================================================
// DEFAULT BLACKLIST (Sync with backend)
// =============================================================================
const DEFAULT_BLACKLIST = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'shorturl.at',
  'rb.gy',
  'is.gd',
  'owl.li',
  'malware.com',
  'phishing.org',
].join('\n');

// =============================================================================
// LLM_MODEL_OPTIONS - Lista Atualizada (Dezembro 2025)
// =============================================================================

export const LLM_MODEL_OPTIONS = [
  // =============================================================================
  // ANTHROPIC - Claude Models (Fev 2026)
  // =============================================================================

  // --- Claude 4.6 Series (Latest - Fev/2026) ---
  {
    label: 'Claude Opus 4.6 (Premium - Fev 2026)',
    value: 'claude-opus-4-6',
    group: 'Anthropic',
    description: 'Modelo premium com máxima inteligência e performance prática',
    pricing: '$5/$25 per MTok',
  },
  {
    label: 'Claude Sonnet 4.6 (Recomendado - Fev 2026)',
    value: 'claude-sonnet-4-6',
    group: 'Anthropic',
    description: 'Melhor modelo para agentes complexos e coding. Melhor custo-benefício.',
    pricing: '$3/$15 per MTok',
  },
  {
    label: 'Claude Haiku 4.5 (Rápido - Out 2025)',
    value: 'claude-haiku-4-5-20251001',
    group: 'Anthropic',
    description: 'Mais rápido, inteligência near-frontier. Ideal para alto volume.',
    pricing: '$1/$5 per MTok',
  },

  // --- Claude 4 Series (Mai-Ago 2025) ---
  {
    label: 'Claude Opus 4.1 (Ago 2025)',
    value: 'claude-opus-4-1-20250805',
    group: 'Anthropic',
    description: 'Upgrade do Opus 4 para tarefas agênticas e coding',
    pricing: '$15/$75 per MTok',
  },
  {
    label: 'Claude Opus 4 (Mai 2025)',
    value: 'claude-opus-4-20250514',
    group: 'Anthropic',
    description: 'Modelo poderoso para tarefas complexas de longa duração',
    pricing: '$15/$75 per MTok',
  },
  {
    label: 'Claude Sonnet 4 (Mai 2025)',
    value: 'claude-sonnet-4-20250514',
    group: 'Anthropic',
    description: 'Equilíbrio entre performance e eficiência',
    pricing: '$3/$15 per MTok',
  },

  // --- Claude 3.7 Series (Legacy) ---
  {
    label: 'Claude 3.7 Sonnet (Legacy)',
    value: 'claude-3-7-sonnet-20250219',
    group: 'Anthropic',
    description: 'Modelo legado com suporte a 128K output tokens',
    pricing: '$3/$15 per MTok',
  },

  // =============================================================================
  // OPENAI - GPT Models (Dez 2025)
  // =============================================================================

  // --- GPT-5.2 Series (Latest - Dec 2025) ---
  {
    label: 'GPT-5.2 (Flagship)',
    value: 'gpt-5.2',
    group: 'OpenAI',
    description: 'Versão mais recente e inteligente',
    pricing: '$1.75/$14 per MTok',
  },
  {
    label: 'GPT-5.2 Chat Latest',
    value: 'gpt-5.2-chat-latest',
    group: 'OpenAI',
    description: 'Versão otimizada para chat',
    pricing: '$1.75/$14 per MTok',
  },

  // --- GPT-5.1 Series ---
  {
    label: 'GPT-5.1 (Estável)',
    value: 'gpt-5.1',
    group: 'OpenAI',
    description: 'Versão estável com contexto de 1M tokens',
    pricing: '$1.25/$10 per MTok',
  },

  // --- O-Series Reasoning Models ---
  {
    label: 'o3-pro (Reasoning Premium)',
    value: 'o3-pro',
    group: 'OpenAI',
    description: 'Versão premium do o3',
  },
  {
    label: 'o3 (Reasoning Avançado)',
    value: 'o3',
    group: 'OpenAI',
    description: 'Modelo de raciocínio SOTA',
  },
  {
    label: 'o3-mini (Reasoning Compacto)',
    value: 'o3-mini',
    group: 'OpenAI',
    description: 'Alternativa compacta ao o3',
  },
  {
    label: 'o1 (Reasoning Original)',
    value: 'o1',
    group: 'OpenAI',
    description: 'Modelo original de raciocínio avançado',
  },
  {
    label: 'o1-mini (Reasoning Legado)',
    value: 'o1-mini',
    group: 'OpenAI',
    description: 'Versão compacta do o1 original',
  },

  // --- GPT-4o Series (Legacy) ---
  {
    label: 'GPT-4o (Multimodal Estável)',
    value: 'gpt-4o',
    group: 'OpenAI',
    description: 'Modelo multimodal otimizado',
  },
  {
    label: 'GPT-4o Mini (Econômico)',
    value: 'gpt-4o-mini',
    group: 'OpenAI',
    description: 'Versão econômica do GPT-4o',
  },

  // =============================================================================
  // GOOGLE - Gemini Models (Dez 2025)
  // =============================================================================

  // --- Gemini 3.1 Series (Fev 2026 - Latest) ---
  {
    label: 'Gemini 3.1 Pro (Mais Inteligente - Fev 2026)',
    value: 'gemini-3.1-pro-preview',
    group: 'Google',
    description: 'Modelo mais avançado para tarefas complexas. Substitui o Gemini 3 Pro.',
    pricing: '$2/$12 per MTok',
  },

  // --- Gemini 3 Series (Dez 2025) ---
  {
    label: 'Gemini 3 Flash (Rápido - Dez 2025)',
    value: 'gemini-3-flash-preview',
    group: 'Google',
    description: 'Alta performance com custo-eficiência.',
    pricing: '$0.10/$0.40 per MTok',
  },
  {
    label: 'Gemini 3 Deep Think (Reasoning)',
    value: 'gemini-3-deep-think',
    group: 'Google',
    description: 'Modo de raciocínio profundo',
  },

  // --- Gemini 2.5 Series (Jun-Jul 2025 - Stable) ---
  {
    label: 'Gemini 2.5 Pro (Estável)',
    value: 'gemini-2.5-pro',
    group: 'Google',
    description: 'Modelo estável mais poderoso da série 2.5',
  },
  {
    label: 'Gemini 2.5 Flash (Recomendado)',
    value: 'gemini-2.5-flash',
    group: 'Google',
    description: 'Melhor custo-benefício, rápido e versátil',
  },
  {
    label: 'Gemini 2.5 Flash-Lite (Ultra-Rápido)',
    value: 'gemini-2.5-flash-lite',
    group: 'Google',
    description: 'Mais rápido e econômico',
  },


  // =============================================================================
  // OUTROS PROVIDERS
  // =============================================================================
  {
    label: 'Grok 4 (xAI)',
    value: 'grok-4',
    group: 'Outros',
    description: 'Modelo avançado da xAI',
  },
  {
    label: 'DeepSeek V3',
    value: 'deepseek-chat',
    group: 'Outros',
    description: 'Modelo open-source chinês competitivo',
  },
  {
    label: 'Mistral Large',
    value: 'mistral-large-latest',
    group: 'Outros',
    description: 'Modelo flagship da Mistral',
  },
];

export const PROVIDER_INFO = {
  anthropic: {
    name: 'Anthropic',
    displayName: 'Anthropic (Claude)',
    modelsCount: LLM_MODEL_OPTIONS.filter((m) => m.group === 'Anthropic').length,
    recommended: 'claude-sonnet-4-6',
    description: 'Modelos Claude - Líderes em segurança e coding',
  },
  openai: {
    name: 'OpenAI',
    displayName: 'OpenAI (GPT)',
    modelsCount: LLM_MODEL_OPTIONS.filter((m) => m.group === 'OpenAI').length,
    recommended: 'gpt-4.1',
    description: 'Modelos GPT e o-series - Versatilidade e reasoning',
  },
  google: {
    name: 'Google',
    displayName: 'Google (Gemini)',
    modelsCount: LLM_MODEL_OPTIONS.filter((m) => m.group === 'Google').length,
    recommended: 'gemini-2.5-flash',
    description: 'Modelos Gemini - Multimodal e contexto longo',
  },
  outros: {
    name: 'Outros',
    displayName: 'Outros Providers',
    modelsCount: LLM_MODEL_OPTIONS.filter((m) => m.group === 'Outros').length,
    recommended: 'deepseek-chat',
    description: 'xAI, DeepSeek, Mistral e outros',
  },
  openrouter: {
    name: 'OpenRouter',
    displayName: 'OpenRouter (Multi-provider)',
    modelsCount: 0, // Dynamic — loaded from backend
    recommended: 'meta-llama/llama-3.1-405b-instruct',
    description: '400+ modelos via gateway único — Meta, DeepSeek, Mistral e mais',
  },
};

export const getModelsByProvider = (provider: string) => {
  return LLM_MODEL_OPTIONS.filter((opt) => opt.group.toLowerCase() === provider.toLowerCase());
};

export const getRecommendedModel = (provider: string): string | undefined => {
  const providerKey = provider.toLowerCase() as keyof typeof PROVIDER_INFO;
  return PROVIDER_INFO[providerKey]?.recommended;
};

export function AgentConfigModal({ companyId, agentId, open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<typeof LLM_MODEL_OPTIONS>([]);

  // Agent Identity
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  // LLM Config
  const [llmProvider, setLlmProvider] = useState<string | undefined>(undefined);
  const [llmModel, setLlmModel] = useState<string | undefined>(undefined);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2000);
  const [topP, setTopP] = useState(1.0);
  const [topK, setTopK] = useState(40);
  const [frequencyPenalty, setFrequencyPenalty] = useState(0.0);
  const [presencePenalty, setPresencePenalty] = useState(0.0);

  // LLM Advanced Config (GPT-5.x, o1, o3)
  const [reasoningEffort, setReasoningEffort] = useState<string>('medium');
  const [verbosity, setVerbosity] = useState<string>('medium');

  // Behavior
  const [systemPrompt, setSystemPrompt] = useState('');
  const [allowWebSearch, setAllowWebSearch] = useState(true);
  const [allowVision, setAllowVision] = useState(false);
  const [visionModel, setVisionModel] = useState<string | undefined>(undefined);
  const [isHydeEnabled, setIsHydeEnabled] = useState(true); // HyDE toggle
  const [modelSearch, setModelSearch] = useState(''); // OpenRouter model search filter

  // Security - Guardrails
  const [securityEnabled, setSecurityEnabled] = useState(false);
  const [checkJailbreak, setCheckJailbreak] = useState(true);
  const [checkNsfw, setCheckNsfw] = useState(true);
  const [piiAction, setPiiAction] = useState('mask'); // mask, block, off
  const [checkSecretKeys, setCheckSecretKeys] = useState(true);
  const [checkUrls, setCheckUrls] = useState(false);

  // URL Protection
  const [urlMode, setUrlMode] = useState<string>('off');
  const [urlBlacklist, setUrlBlacklist] = useState('');
  const [urlWhitelist, setUrlWhitelist] = useState('');
  const [allowedTopics, setAllowedTopics] = useState('');
  const [customRegex, setCustomRegex] = useState('');
  const [failClose, setFailClose] = useState(true);
  const [securityErrorMessage, setSecurityErrorMessage] = useState(
    'Sua mensagem viola as políticas de segurança.',
  );

  // WhatsApp Integration - POR AGENTE
  const [whatsappProvider, setWhatsappProvider] = useState<string>('none');
  const [whatsappIdentifier, setWhatsappIdentifier] = useState('');
  const [whatsappInstanceId, setWhatsappInstanceId] = useState('');
  const [whatsappToken, setWhatsappToken] = useState('');
  const [whatsappClientToken, setWhatsappClientToken] = useState('');
  const [whatsappBaseUrl, setWhatsappBaseUrl] = useState('https://api.z-api.io/instances');
  const [whatsappIsActive, setWhatsappIsActive] = useState(true);
  const [whatsappBufferEnabled, setWhatsappBufferEnabled] = useState(true);
  const [whatsappBufferDebounce, setWhatsappBufferDebounce] = useState(3);
  const [whatsappBufferMaxWait, setWhatsappBufferMaxWait] = useState(10);
  const [showWhatsappToken, setShowWhatsappToken] = useState(false);
  const [showWhatsappClientToken, setShowWhatsappClientToken] = useState(false);
  const [hasExistingIntegration, setHasExistingIntegration] = useState(false);
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);

  // Human Handoff & Tools
  const [allowHumanHandoff, setAllowHumanHandoff] = useState(false);
  const [allowCsvAnalytics, setAllowCsvAnalytics] = useState(false);

  // SubAgent Config
  const [isSubagent, setIsSubagent] = useState(false);
  const [allowDirectChat, setAllowDirectChat] = useState(false);

  // Widget Config
  const [widgetConfig, setWidgetConfig] = useState<WidgetConfig>({});

  // HTTP Tools Management
  const [toolsView, setToolsView] = useState<'list' | 'form'>('list');
  const [httpTools, setHttpTools] = useState<HttpTool[]>([]);
  const [editingTool, setEditingTool] = useState<HttpTool | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);

  // Editor Context Variables
  const [contextVars, setContextVars] = useState<
    { tag: string; label: string; description: string; icon: string }[]
  >([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const { toast } = useToast();
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  // LLM Test Integration
  const [testingLLM, setTestingLLM] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: 'success' | 'error';
    message: string;
  } | null>(null);

  const isCreateMode = !agentId;

  useEffect(() => {
    if (open) {
      loadProviders();
      if (agentId) {
        loadAgent();
        loadHttpTools();
      } else {
        resetForm();
      }
    }
  }, [open, agentId]);

  useEffect(() => {
    if (llmProvider) {
      loadModels(llmProvider);
    }
  }, [llmProvider]);

  // Auto-generate slug from name
  useEffect(() => {
    if (isCreateMode && name) {
      const autoSlug = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      setSlug(autoSlug);
    }
  }, [name, isCreateMode]);

  const resetForm = () => {
    setName('');
    setSlug('');
    setLlmProvider(undefined);
    setLlmModel(undefined);
    setTemperature(0.7);
    setMaxTokens(2000);
    setTopP(1.0);
    setTopK(40);
    setFrequencyPenalty(0.0);
    setPresencePenalty(0.0);
    setSystemPrompt('');
    setAllowWebSearch(true);
    setAllowVision(false);
    setVisionModel(undefined);
    setVisionModel(undefined);
    // removed setVisionApiKey, setHasApiKey, setHasVisionApiKey
    setAllowHumanHandoff(false);
    setContextVars([]);
    setReasoningEffort('medium');
    setVerbosity('medium');
    setIsHydeEnabled(true); // Reset HyDE to default

    // Reset Security
    setSecurityEnabled(false);
    setCheckJailbreak(true);
    setCheckNsfw(true);
    setPiiAction('mask');
    setCheckSecretKeys(true);
    setCheckUrls(false);
    setUrlWhitelist('');
    setAllowedTopics('');
    setCustomRegex('');
    setSecurityErrorMessage('Sua mensagem viola as políticas de segurança.');
  };

  const handleTestLLM = async () => {
    if (!llmProvider || !llmModel) {
      toast({
        title: 'Atenção',
        description: 'Selecione um provider e modelo primeiro',
        variant: 'destructive',
      });
      return;
    }

    setTestingLLM(true);
    setTestResult(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/agents/test-llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: llmProvider,
          model: llmModel,
          agent_id: agentId,
          company_id: companyId,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setTestResult({ status: 'success', message: result.message });
        toast({
          title: 'Sucesso',
          description: result.message,
        });
      } else {
        setTestResult({ status: 'error', message: result.detail || 'Erro ao testar' });
        toast({
          title: 'Erro',
          description: result.detail || 'Falha no teste',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      setTestResult({ status: 'error', message: error.message });
      toast({
        title: 'Erro',
        description: 'Falha ao conectar com o servidor',
        variant: 'destructive',
      });
    } finally {
      setTestingLLM(false);
    }
  };

  const loadProviders = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/agent/providers`);
      if (response.ok) {
        const data = await response.json();
        setProviders(data);
      }
    } catch (error) {
      console.error('Error loading providers:', error);
    }
  };

  const loadModels = async (provider: string) => {
    if (provider === 'openrouter') {
      // Fetch models dynamically from backend for OpenRouter
      try {
        const response = await fetch(`${BACKEND_URL}/api/agent/models/openrouter`);
        if (response.ok) {
          const modelNames: string[] = await response.json();
          const dynamicModels = modelNames.map((name) => ({
            label: name,
            value: name,
            group: 'OpenRouter' as const,
            description: '',
            pricing: '',
          }));
          setModels(dynamicModels as typeof LLM_MODEL_OPTIONS);
        } else {
          setModels([]);
        }
      } catch (error) {
        console.error('Error loading OpenRouter models:', error);
        setModels([]);
      }
      setModelSearch('');
      return;
    }

    // Local filter for native providers
    const filtered = LLM_MODEL_OPTIONS.filter(
      (opt) =>
        opt.group.toLowerCase() === provider.toLowerCase() ||
        (provider.toLowerCase() === 'outros' && opt.group === 'Outros'),
    );
    setModels(filtered);
    setModelSearch('');
  };

  const loadAgent = async () => {
    if (!agentId) return;

    setLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/agents/${agentId}`);
      if (response.ok) {
        const agent: Agent = await response.json();

        // Identity
        setName(agent.name);
        setSlug(agent.slug);
        setAvatarUrl(agent.avatar_url || '');

        // LLM Config
        setLlmProvider(agent.llm_provider);
        setLlmModel(agent.llm_model);
        setTemperature(agent.llm_temperature);
        setMaxTokens(agent.llm_max_tokens);
        setTopP(agent.llm_top_p);
        setTopK(agent.llm_top_k);
        setFrequencyPenalty(agent.llm_frequency_penalty);
        setPresencePenalty(agent.llm_presence_penalty);

        // Behavior
        setSystemPrompt(agent.agent_system_prompt || '');
        setAllowWebSearch(agent.allow_web_search);
        setAllowVision(agent.allow_vision);
        setVisionModel(agent.vision_model);
        setIsHydeEnabled(agent.is_hyde_enabled ?? true); // Load HyDE toggle

        // Tools Config
        const toolsConfig = agent.tools_config || {};
        setAllowHumanHandoff(toolsConfig.human_handoff?.enabled || false);
        setAllowCsvAnalytics(toolsConfig.csv_analytics?.enabled || false);

        // Advanced Config (GPT-5.x, o1, o3)
        setReasoningEffort(agent.reasoning_effort || 'medium');
        setVerbosity(agent.verbosity || 'medium');

        // SubAgent Config
        setIsSubagent(agent.is_subagent ?? false);
        setAllowDirectChat(agent.allow_direct_chat ?? false);

        // Widget Config
        setWidgetConfig(agent.widget_config || {});

        // Security Config
        const sec = (agent.security_settings || {}) as SecuritySettings;
        setSecurityEnabled(sec.enabled ?? false);
        setCheckJailbreak(sec.check_jailbreak ?? true);
        setFailClose(sec.fail_close ?? true);
        setCheckNsfw(sec.check_nsfw ?? true);
        setPiiAction(sec.pii_action || 'mask');
        setCheckSecretKeys(sec.check_secret_keys ?? true);

        // URL Protection
        if (sec.url_protection_mode) {
          setUrlMode(sec.url_protection_mode);
        } else {
          // Fallback/Legacy logic
          setUrlMode(sec.check_urls ? 'whitelist' : 'off');
        }

        setUrlWhitelist(Array.isArray(sec.url_whitelist) ? sec.url_whitelist.join('\n') : '');
        setUrlBlacklist(Array.isArray(sec.url_blacklist) ? sec.url_blacklist.join('\n') : '');

        setAllowedTopics(Array.isArray(sec.allowed_topics) ? sec.allowed_topics.join('\n') : '');
        setCustomRegex(Array.isArray(sec.custom_regex) ? sec.custom_regex.join('\n') : '');
        setSecurityErrorMessage(
          sec.error_message || 'Sua mensagem viola as políticas de segurança.',
        );

        // Load WhatsApp integration for this agent
        await loadWhatsappIntegration(agentId);

        // Load editor context variables
        await loadEditorContext(agentId);
      }
    } catch (error) {
      console.error('Error loading agent:', error);
      toast({
        title: 'Erro',
        description: 'Falha ao carregar configuração do agente',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadWhatsappIntegration = async (agentId: string) => {
    try {
      // Use API route with Service Role Key to bypass RLS
      const response = await fetch(`/api/admin/integrations?agentId=${agentId}`);
      const result = await response.json();

      if (!response.ok) {
        console.error('Error loading integration:', result.error);
        return;
      }

      const integration = result.integration;

      if (integration) {
        setHasExistingIntegration(true);
        setIntegrationId(integration.id);
        setWhatsappProvider(integration.provider || 'z-api');
        setWhatsappIdentifier(integration.identifier || '');
        setWhatsappInstanceId(integration.instance_id || '');
        setWhatsappToken(integration.token || '');
        setWhatsappClientToken(integration.client_token || '');
        setWhatsappBaseUrl(integration.base_url || 'https://api.z-api.io/instances');
        setWhatsappIsActive(integration.is_active ?? true);
        setWhatsappBufferEnabled(integration.buffer_enabled ?? true);
        setWhatsappBufferDebounce(integration.buffer_debounce_seconds ?? 3);
        setWhatsappBufferMaxWait(integration.buffer_max_wait_seconds ?? 10);
      } else {
        // Reset to defaults
        setHasExistingIntegration(false);
        setIntegrationId(null);
        setWhatsappProvider('none');
        setWhatsappIdentifier('');
        setWhatsappInstanceId('');
        setWhatsappToken('');
        setWhatsappClientToken('');
        setWhatsappBaseUrl('https://api.z-api.io/instances');
        setWhatsappIsActive(true);
        setWhatsappBufferEnabled(true);
        setWhatsappBufferDebounce(3);
        setWhatsappBufferMaxWait(10);
      }
    } catch (error) {
      console.error('Error loading WhatsApp integration:', error);
    }
  };

  const loadEditorContext = async (agentId: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/agents/${agentId}/editor-context`);
      if (response.ok) {
        const data = await response.json();
        setContextVars(data.variables || []);
      }
    } catch (error) {
      console.error('Error loading editor context:', error);
    }
  };

  const insertVariable = (tag: string) => {
    const textarea = promptRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = systemPrompt.slice(0, start) + tag + systemPrompt.slice(end);
    setSystemPrompt(newText);

    // Reset cursor position after tag
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  };

  const handleSaveWhatsapp = async () => {
    if (!agentId) {
      toast({
        title: 'Atenção',
        description: 'Salve o agente primeiro antes de configurar o WhatsApp',
        variant: 'destructive',
      });
      return;
    }

    if (whatsappProvider === 'none') {
      // Se mudou para "nenhum" e tinha integração, deletar
      if (hasExistingIntegration && integrationId) {
        setSavingWhatsapp(true);
        try {
          const response = await fetch(`/api/admin/integrations?id=${integrationId}`, {
            method: 'DELETE',
          });

          if (!response.ok) {
            const result = await response.json();
            throw new Error(result.error || 'Failed to delete');
          }

          setHasExistingIntegration(false);
          setIntegrationId(null);
          toast({
            title: 'Sucesso',
            description: 'Integração WhatsApp removida',
          });
        } catch (error: any) {
          toast({
            title: 'Erro',
            description: error.message || 'Falha ao remover integração',
            variant: 'destructive',
          });
        } finally {
          setSavingWhatsapp(false);
        }
      }
      return;
    }

    // Validações
    if (!whatsappIdentifier.trim()) {
      toast({ title: 'Atenção', description: 'Telefone é obrigatório', variant: 'destructive' });
      return;
    }
    if (!whatsappInstanceId.trim()) {
      toast({ title: 'Atenção', description: 'Instance ID é obrigatório', variant: 'destructive' });
      return;
    }
    if (!whatsappToken.trim()) {
      toast({ title: 'Atenção', description: 'Token é obrigatório', variant: 'destructive' });
      return;
    }

    setSavingWhatsapp(true);
    try {
      const payload = {
        agent_id: agentId,
        company_id: companyId,
        provider: whatsappProvider,
        identifier: whatsappIdentifier.trim(),
        instance_id: whatsappInstanceId.trim(),
        token: whatsappToken.trim(),
        client_token: whatsappClientToken.trim() || null,
        base_url: whatsappBaseUrl.trim(),
        is_active: whatsappIsActive,
        buffer_enabled: whatsappBufferEnabled,
        buffer_debounce_seconds: whatsappBufferDebounce,
        buffer_max_wait_seconds: whatsappBufferMaxWait,
      };

      // Use API route with Service Role Key to bypass RLS
      const response = await fetch('/api/admin/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save');
      }

      if (result.integration) {
        setIntegrationId(result.integration.id);
        setHasExistingIntegration(true);
      }

      toast({
        title: 'Sucesso',
        description: 'Integração WhatsApp salva com sucesso!',
      });
    } catch (error: any) {
      console.error('Error saving WhatsApp:', error);
      toast({
        title: 'Erro',
        description: error.message || 'Falha ao salvar integração',
        variant: 'destructive',
      });
    } finally {
      setSavingWhatsapp(false);
    }
  };

  // ============= HTTP TOOLS CRUD (via Next.js API) =============
  const loadHttpTools = async () => {
    if (!agentId) return;
    setLoadingTools(true);
    try {
      // Usar rota interna do Next.js
      const res = await fetch(`/api/agents/tools?agentId=${agentId}`);
      if (res.ok) {
        const data = await res.json();
        // Converter headers de objeto para array para edição
        const toolsWithArrayHeaders = data.map((t: any) => ({
          ...t,
          headers: Array.isArray(t.headers)
            ? t.headers
            : t.headers
              ? Object.entries(t.headers).map(([key, value]) => ({ key, value }))
              : [],
        }));
        setHttpTools(toolsWithArrayHeaders);
      }
    } catch (e) {
      console.error('Erro ao carregar tools:', e);
    } finally {
      setLoadingTools(false);
    }
  };

  const handleSaveTool = async (tool: HttpTool) => {
    try {
      // Converter array de headers para objeto JSONB
      const headersObj = tool.headers.reduce(
        (acc, curr) => ({ ...acc, [curr.key]: curr.value }),
        {},
      );

      const payload = {
        ...tool,
        headers: headersObj,
        agent_id: agentId,
        is_active: true,
      };

      // Usar rota interna do Next.js
      const method = tool.id ? 'PUT' : 'POST';
      const res = await fetch('/api/agents/tools', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Falha ao salvar');
      }

      toast({ title: 'Sucesso', description: 'Ferramenta salva com sucesso' });
      await loadHttpTools();
      // Atualiza lista de variáveis do prompt (HTTP tools aparecem lá agora)
      if (agentId) await loadEditorContext(agentId);
      setToolsView('list');
    } catch (error: any) {
      console.error('🔧 ERROR:', error);
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    }
  };

  const handleDeleteTool = async (toolId: string) => {
    if (!confirm('Tem certeza que deseja excluir esta ferramenta?')) return;
    try {
      await fetch(`/api/agents/tools?id=${toolId}`, { method: 'DELETE' });
      toast({ title: 'Deletado', description: 'Ferramenta removida' });
      await loadHttpTools();
      // Atualiza lista de variáveis do prompt (remove tool deletada)
      if (agentId) await loadEditorContext(agentId);
    } catch (e) {
      toast({ title: 'Erro', description: 'Erro ao deletar', variant: 'destructive' });
    }
  };

  const handleSave = async () => {
    // Validation
    if (!name.trim()) {
      toast({
        title: 'Atenção',
        description: 'Nome do agente é obrigatório',
        variant: 'destructive',
      });
      return;
    }

    if (!slug.trim()) {
      toast({
        title: 'Atenção',
        description: 'Slug é obrigatório',
        variant: 'destructive',
      });
      return;
    }

    if (!llmProvider || !llmModel) {
      toast({
        title: 'Atenção',
        description: 'Selecione um provider e modelo',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        company_id: companyId,
        name: name.trim(),
        slug: slug.trim(),
        avatar_url: avatarUrl,
        llm_provider: llmProvider,
        llm_model: llmModel,
        // Modelos GPT-5/o1/o3 só suportam temperatura 1.0
        llm_temperature:
          llmModel?.startsWith('gpt-5') || llmModel?.startsWith('o1') || llmModel?.startsWith('o3')
            ? 1.0
            : temperature,
        llm_max_tokens: maxTokens,
        llm_top_p: topP,
        llm_top_k: topK,
        llm_frequency_penalty: frequencyPenalty,
        llm_presence_penalty: presencePenalty,
        agent_system_prompt: systemPrompt || DEFAULT_SYSTEM_PROMPT,
        allow_web_search: allowWebSearch,
        allow_vision: allowVision,
        vision_model: visionModel,
        tools_config: {
          human_handoff: { enabled: allowHumanHandoff },
          csv_analytics: { enabled: allowCsvAnalytics },
        },
        reasoning_effort: reasoningEffort,
        verbosity: verbosity,
        is_hyde_enabled: isHydeEnabled,
        is_subagent: isSubagent,
        allow_direct_chat: allowDirectChat,
        widget_config: widgetConfig, // Include widget config in save
        security_settings: {
          enabled: securityEnabled,
          fail_close: failClose,
          check_jailbreak: checkJailbreak,
          check_nsfw: checkNsfw,
          pii_action: piiAction,
          check_secret_keys: checkSecretKeys,
          check_urls: urlMode !== 'off', // Legacy compatibility
          url_protection_mode: urlMode,
          url_whitelist: urlWhitelist
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          url_blacklist: urlBlacklist
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          allowed_topics: allowedTopics
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          custom_regex: customRegex
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          error_message: securityErrorMessage,
        },
      };

      const url = isCreateMode
        ? `${BACKEND_URL}/api/agents`
        : `${BACKEND_URL}/api/agents/${agentId}`;

      const method = isCreateMode ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        toast({
          title: 'Sucesso',
          description: isCreateMode ? 'Agente criado com sucesso' : 'Agente atualizado com sucesso',
        });
        onOpenChange(false);
      } else {
        const error = await response.json();
        toast({
          title: 'Erro',
          description: error.detail || 'Falha ao salvar agente',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao salvar agente',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full max-h-[90vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Settings className="h-5 w-5" />
            {isCreateMode ? 'Criar Novo Agente' : `Editar Agente: ${name}`}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : (
          <Tabs defaultValue="identity" className="w-full">
            <div className="space-y-1 bg-muted/50 p-2 rounded-md">
              <TabsList className="flex flex-wrap w-full bg-transparent h-auto gap-1 justify-start">
                <TabsTrigger
                  value="identity"
                  className="flex-1 min-w-[80px] text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs py-2"
                >
                  Identidade
                </TabsTrigger>
                <TabsTrigger
                  value="model"
                  className="flex-1 min-w-[80px] text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs py-2"
                >
                  Modelo
                </TabsTrigger>
                <TabsTrigger
                  value="personality"
                  className="flex-1 min-w-[80px] text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs py-2"
                >
                  Personalidade
                </TabsTrigger>
                {!isSubagent && (
                  <TabsTrigger
                    value="memory"
                    className="flex-1 min-w-[80px] text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs py-2"
                  >
                    Memória
                  </TabsTrigger>
                )}
                {!isSubagent && (
                  <TabsTrigger
                    value="security"
                    className="flex-1 min-w-[80px] text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs py-2 flex items-center justify-center gap-1"
                  >
                    <Shield className="w-3 h-3" /> Segurança
                  </TabsTrigger>
                )}

                <TabsTrigger
                  value="tools"
                  className="flex-1 min-w-[80px] text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs py-2"
                >
                  HTTP Tools
                </TabsTrigger>
                <TabsTrigger
                  value="mcp"
                  className="flex-1 min-w-[80px] text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs py-2"
                >
                  MCP
                </TabsTrigger>
                {!isSubagent && (
                  <TabsTrigger
                    value="commerce"
                    className="flex-1 min-w-[80px] text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs py-2"
                  >
                    Commerce
                  </TabsTrigger>
                )}
                {!isSubagent && (
                  <TabsTrigger
                    value="widget"
                    className="flex-1 min-w-[80px] text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs py-2"
                  >
                    Widget
                  </TabsTrigger>
                )}
                {!isSubagent && (
                  <TabsTrigger
                    value="whatsapp"
                    className="flex-1 min-w-[80px] text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs py-2"
                  >
                    WhatsApp
                  </TabsTrigger>
                )}
                {!isSubagent && !isCreateMode && (
                  <TabsTrigger
                    value="subagents"
                    className="flex-1 min-w-[80px] text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs py-2 flex items-center justify-center gap-1"
                  >
                    <Users className="w-3 h-3" /> Especialistas
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            {/* TAB 1: Identity */}
            <TabsContent value="identity" className="space-y-6 mt-6">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm text-foreground">Identificação do Agente</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="name" className="text-muted-foreground">
                      Nome do Agente *
                    </Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Agente de Vendas"
                      className="bg-background border-border text-foreground"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Nome descritivo para identificar o agente
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="slug" className="text-muted-foreground">
                      Slug (Identificador) *
                    </Label>
                    <Input
                      id="slug"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      placeholder="Ex: agente-de-vendas"
                      className="bg-background border-border text-foreground font-mono"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Identificador único (auto-gerado do nome, editável)
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* SubAgent Configuration */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm text-foreground flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-400" />
                    Configuração de SubAgent
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Marcar como Especialista (SubAgent)</Label>
                      <p className="text-xs text-muted-foreground">
                        Especialistas são acionados por orquestradores. Oculta Widget e WhatsApp.
                      </p>
                    </div>
                    <Switch checked={isSubagent} onCheckedChange={setIsSubagent} />
                  </div>
                  {isSubagent && (
                    <div className="flex items-center justify-between animate-in fade-in slide-in-from-top-1">
                      <div className="space-y-0.5">
                        <Label className="text-foreground">Permitir Chat Direto (Debug)</Label>
                        <p className="text-xs text-muted-foreground">
                          Exibe este agente no Chat Test do admin para testes e treinamento.
                        </p>
                      </div>
                      <Switch checked={allowDirectChat} onCheckedChange={setAllowDirectChat} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB: SECURITY */}
            <TabsContent value="security" className="space-y-6 mt-6">
              <div className="flex items-center justify-between bg-red-950/20 p-4 rounded-lg border border-red-900/30">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-red-500" />
                    <Label className="text-base font-semibold text-foreground">
                      Ativar Guardrails de Segurança
                    </Label>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Habilita a camada de proteção para prevenir respostas tóxicas e vazamento de
                    dados.
                  </p>
                </div>
                <Switch checked={securityEnabled} onCheckedChange={setSecurityEnabled} />
              </div>

              {securityEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-2">
                  {/* Coluna 1: AI Safety & PII */}
                  <div className="space-y-6">
                    <Card className="bg-card border-border">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm text-foreground flex items-center gap-2">
                          <Eye className="w-4 h-4 text-blue-400" /> AI Safety & Conteúdo
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-foreground">Detectar Jailbreak</Label>
                            <p className="text-xs text-muted-foreground">
                              Bloqueia prompt injection e ataques de engenharia social (Llama Guard)
                            </p>
                          </div>
                          <Switch checked={checkJailbreak} onCheckedChange={setCheckJailbreak} />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-foreground">Bloquear NSFW/Tóxico</Label>
                            <p className="text-xs text-muted-foreground">
                              Filtra conteúdo sexual, violento ou de ódio
                            </p>
                          </div>
                          <Switch checked={checkNsfw} onCheckedChange={setCheckNsfw} />
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm text-foreground flex items-center gap-2">
                          <Lock className="w-4 h-4 text-yellow-400" /> Dados Pessoais (PII)
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label className="text-foreground">Proteger Dados Pessoais</Label>
                              <p className="text-xs text-muted-foreground">
                                Detecta e protege CPF, Email, Telefone, etc.
                              </p>
                            </div>
                            <Switch
                              checked={piiAction !== 'off'}
                              onCheckedChange={(checked) => {
                                setPiiAction(checked ? 'mask' : 'off');
                              }}
                            />
                          </div>

                          {piiAction !== 'off' && (
                            <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                              <Label className="text-xs text-muted-foreground">Ação ao detectar</Label>
                              <Select value={piiAction} onValueChange={setPiiAction}>
                                <SelectTrigger className="bg-background border-border text-foreground h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-card border-border text-foreground">
                                  <SelectItem value="mask">
                                    Mascarar (Substituir por asteriscos)
                                  </SelectItem>
                                  <SelectItem value="block">Bloquear Mensagem</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between pt-2">
                          <div className="space-y-0.5">
                            <Label className="text-foreground">Bloquear Secret Keys</Label>
                            <p className="text-xs text-muted-foreground">
                              Detecta e bloqueia chaves de API (sk-..., gh_...)
                            </p>
                          </div>
                          <Switch checked={checkSecretKeys} onCheckedChange={setCheckSecretKeys} />
                        </div>

                        <div className="flex items-center justify-between pt-2">
                          <div className="space-y-0.5">
                            <Label className="text-foreground">Bloquear se IA Falhar (Fail-Close)</Label>
                            <p className="text-xs text-muted-foreground">
                              Se a API de segurança cair, bloqueia a mensagem por precaução.
                            </p>
                          </div>
                          <Switch checked={failClose} onCheckedChange={setFailClose} />
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Coluna 2: Regras e Customização */}
                  <div className="space-y-6">
                    <Card className="bg-card border-border">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm text-foreground flex items-center gap-2">
                          <Globe className="w-4 h-4 text-green-400" /> URLs e Tópicos
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-foreground">Proteção de URLs</Label>
                            <p className="text-xs text-muted-foreground">
                              Controle quais links podem ser processados
                            </p>
                          </div>
                        </div>

                        <RadioGroup
                          value={urlMode}
                          onValueChange={(val) => {
                            setUrlMode(val);
                            // Auto-fill default blacklist if empty when switching to blacklist
                            if (val === 'blacklist' && !urlBlacklist.trim()) {
                              setUrlBlacklist(DEFAULT_BLACKLIST);
                            }
                          }}
                          className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2"
                        >
                          <div>
                            <RadioGroupItem value="off" id="url-off" className="peer sr-only" />
                            <Label
                              htmlFor="url-off"
                              className="flex flex-col items-center justify-between rounded-md border-2 border-border bg-card p-4 hover:bg-muted hover:text-foreground peer-data-[state=checked]:border-blue-500 [&:has([data-state=checked])]:border-blue-500 cursor-pointer"
                            >
                              <Globe className="mb-3 h-6 w-6 text-muted-foreground peer-data-[state=checked]:text-blue-400" />
                              <span className="text-xs text-muted-foreground">Desativado</span>
                            </Label>
                          </div>

                          <div>
                            <RadioGroupItem
                              value="whitelist"
                              id="url-white"
                              className="peer sr-only"
                            />
                            <Label
                              htmlFor="url-white"
                              className="flex flex-col items-center justify-between rounded-md border-2 border-border bg-card p-4 hover:bg-muted hover:text-foreground peer-data-[state=checked]:border-blue-500 [&:has([data-state=checked])]:border-blue-500 cursor-pointer"
                            >
                              <Shield className="mb-3 h-6 w-6 text-muted-foreground peer-data-[state=checked]:text-green-400" />
                              <span className="text-xs text-muted-foreground">Whitelist</span>
                            </Label>
                          </div>

                          <div>
                            <RadioGroupItem
                              value="blacklist"
                              id="url-black"
                              className="peer sr-only"
                            />
                            <Label
                              htmlFor="url-black"
                              className="flex flex-col items-center justify-between rounded-md border-2 border-border bg-card p-4 hover:bg-muted hover:text-foreground peer-data-[state=checked]:border-blue-500 [&:has([data-state=checked])]:border-blue-500 cursor-pointer"
                            >
                              <Lock className="mb-3 h-6 w-6 text-muted-foreground peer-data-[state=checked]:text-red-400" />
                              <span className="text-xs text-muted-foreground">Blacklist</span>
                            </Label>
                          </div>
                        </RadioGroup>

                        {urlMode === 'whitelist' && (
                          <div className="space-y-2 pt-2 animate-in fade-in slide-in-from-top-2">
                            <Label className="text-xs text-muted-foreground">
                              Domínios Permitidos (Whitelist)
                            </Label>
                            <Textarea
                              value={urlWhitelist}
                              onChange={(e) => setUrlWhitelist(e.target.value)}
                              placeholder="google.com&#10;openai.com&#10;*.empresa.com.br"
                              className="bg-background border-border text-foreground text-xs font-mono h-24"
                            />
                            <p className="text-[10px] text-muted-foreground">
                              Apenas URLs destes domínios serão permitidas. Suporta wildcards.
                            </p>
                          </div>
                        )}

                        {urlMode === 'blacklist' && (
                          <div className="space-y-2 pt-2 animate-in fade-in slide-in-from-top-2">
                            <Label className="text-xs text-muted-foreground">
                              Domínios Bloqueados (Blacklist)
                            </Label>
                            <Textarea
                              value={urlBlacklist}
                              onChange={(e) => setUrlBlacklist(e.target.value)}
                              placeholder="bit.ly&#10;malware.com&#10;*.badsite.org"
                              className="bg-background border-border text-foreground text-xs font-mono h-24"
                            />
                            <p className="text-[10px] text-muted-foreground">
                              Estas URLs serão bloqueadas. Já inclui encurtadores comuns por padrão.
                            </p>
                          </div>
                        )}

                        <div className="space-y-2 pt-2">
                          <Label className="text-foreground">Tópicos Permitidos (Opcional)</Label>
                          <Textarea
                            value={allowedTopics}
                            onChange={(e) => setAllowedTopics(e.target.value)}
                            placeholder="Vendas, Suporte Técnico, Preços..."
                            className="bg-background border-border text-foreground text-xs h-20"
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Se preenchido, o agente recusará falar sobre outros assuntos (Topical
                            Alignment).
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-card border-border">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm text-foreground flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-orange-400" /> Resposta de Bloqueio
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <Label className="text-foreground">Mensagem ao Usuário</Label>
                          <Input
                            value={securityErrorMessage}
                            onChange={(e) => setSecurityErrorMessage(e.target.value)}
                            className="bg-background border-border text-foreground"
                          />
                          <p className="text-xs text-muted-foreground">
                            Esta mensagem será enviada quando o guardrail bloquear o input, sem
                            expor o motivo técnico.
                          </p>
                        </div>

                        <div className="space-y-2 pt-2">
                          <Label className="text-foreground flex items-center gap-1">
                            <FileCode className="w-3 h-3" /> Regex Customizado (Avançado)
                          </Label>
                          <Textarea
                            value={customRegex}
                            onChange={(e) => setCustomRegex(e.target.value)}
                            placeholder="^.*(concorrente|palavra_proibida).*$"
                            className="bg-background border-border text-foreground text-xs font-mono h-16"
                          />
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* TAB 2: Model */}
            <TabsContent value="model" className="space-y-6 mt-6">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm text-foreground">Modelo de IA</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="provider" className="text-muted-foreground">
                      Provider
                    </Label>
                    <Select
                      value={llmProvider}
                      onValueChange={(value) => {
                        setLlmProvider(value);
                        setLlmModel(undefined);
                      }}
                    >
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue placeholder="Selecione o provider" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {providers.map((p) => (
                          <SelectItem key={p.name} value={p.name} className="text-foreground">
                            {p.display_name} ({p.models_count} modelos)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="model" className="text-muted-foreground">
                      Modelo
                    </Label>
                    <Select
                      value={llmModel}
                      onValueChange={(model) => {
                        setLlmModel(model);
                        // Forçar temperatura 1.0 para modelos que não suportam temperatura customizada
                        if (
                          model.startsWith('gpt-5') ||
                          model.startsWith('o1') ||
                          model.startsWith('o3')
                        ) {
                          setTemperature(1.0);
                        }
                      }}
                      disabled={!llmProvider}
                    >
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue placeholder="Selecione o modelo" />
                      </SelectTrigger>
                      <SelectContent
                        className="bg-card border-border max-h-[40vh] overflow-y-auto z-[9999] min-w-[300px] w-[var(--radix-select-trigger-width)]"
                        position="popper"
                        sideOffset={5}
                      >
                        {llmProvider === 'openrouter' && (
                          <div className="sticky top-0 bg-card p-2 border-b border-border z-10">
                            <input
                              type="text"
                              placeholder="Buscar modelo... (ex: llama, deepseek, mistral)"
                              value={modelSearch}
                              onChange={(e) => setModelSearch(e.target.value)}
                              className="w-full px-2 py-1 text-sm bg-background border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            />
                          </div>
                        )}
                        {models
                          .filter((opt) =>
                            !modelSearch || opt.label.toLowerCase().includes(modelSearch.toLowerCase())
                          )
                          .map((opt) => (
                            <SelectItem
                              key={opt.value}
                              value={opt.value}
                              className="text-foreground truncate max-w-[500px] cursor-pointer focus:bg-blue-600 focus:text-white"
                            >
                              {opt.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Test LLM Integration Button */}
                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleTestLLM}
                      disabled={testingLLM || !llmProvider || !llmModel}
                      className="bg-background border-border text-foreground hover:bg-muted"
                    >
                      {testingLLM ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Testando...
                        </>
                      ) : (
                        <>
                          <TestTube className="mr-2 h-4 w-4" />
                          Testar Integração
                        </>
                      )}
                    </Button>
                    {testResult && (
                      <div
                        className={`flex items-center gap-2 text-sm ${testResult.status === 'success' ? 'text-green-500' : 'text-red-500'}`}
                      >
                        {testResult.status === 'success' ? (
                          <CheckCircle className="h-4 w-4" />
                        ) : (
                          <span>❌</span>
                        )}
                        <span className="truncate max-w-[200px]">{testResult.message}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Parameters */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm text-foreground">Parâmetros</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <Label className="text-muted-foreground">Temperature</Label>
                      <span className="text-sm text-muted-foreground">
                        {llmModel?.includes('gpt-5') ? '1.00 (fixo)' : temperature.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      value={[llmModel?.includes('gpt-5') ? 1.0 : temperature]}
                      onValueChange={(value) =>
                        !llmModel?.includes('gpt-5') && setTemperature(value[0])
                      }
                      min={0}
                      max={2}
                      step={0.1}
                      className="w-full"
                      disabled={llmModel?.includes('gpt-5')}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {llmModel?.includes('gpt-5')
                        ? '⚠️ GPT-5.x só suporta temperature 1.0 por enquanto'
                        : 'Menor = mais conservador, Maior = mais criativo'}
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="max_tokens" className="text-muted-foreground">
                      Max Tokens
                    </Label>
                    <Input
                      id="max_tokens"
                      type="number"
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                      min={100}
                      max={100000}
                      className="bg-background border-border text-foreground"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Advanced Parameters */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm text-foreground">Parâmetros Avançados</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <Label className="text-muted-foreground">Top P</Label>
                      <span className="text-sm text-muted-foreground">{topP.toFixed(2)}</span>
                    </div>
                    <Slider
                      value={[topP]}
                      onValueChange={(value) => setTopP(value[0])}
                      min={0}
                      max={1}
                      step={0.01}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <Label htmlFor="top_k" className="text-muted-foreground">
                      Top K
                    </Label>
                    <Input
                      id="top_k"
                      type="number"
                      value={topK}
                      onChange={(e) => setTopK(parseInt(e.target.value))}
                      min={1}
                      max={100}
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-2">
                      <Label className="text-muted-foreground">Frequency Penalty</Label>
                      <span className="text-sm text-muted-foreground">{frequencyPenalty.toFixed(2)}</span>
                    </div>
                    <Slider
                      value={[frequencyPenalty]}
                      onValueChange={(value) => setFrequencyPenalty(value[0])}
                      min={-2}
                      max={2}
                      step={0.1}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-2">
                      <Label className="text-muted-foreground">Presence Penalty</Label>
                      <span className="text-sm text-muted-foreground">{presencePenalty.toFixed(2)}</span>
                    </div>
                    <Slider
                      value={[presencePenalty]}
                      onValueChange={(value) => setPresencePenalty(value[0])}
                      min={-2}
                      max={2}
                      step={0.1}
                      className="w-full"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Reasoning Models Config - Only visible for o1/o3 models */}
              {(llmModel?.startsWith('o1') || llmModel?.startsWith('o3')) && (
                <Card className="bg-card border-border border-purple-500/30">
                  <CardHeader>
                    <CardTitle className="text-sm text-foreground flex items-center gap-2">
                      <Brain className="h-4 w-4 text-purple-400" />
                      Configurações de Raciocínio (o1/o3)
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Controles específicos para modelos de raciocínio
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label className="text-muted-foreground">Reasoning Effort</Label>
                      <Select value={reasoningEffort} onValueChange={setReasoningEffort}>
                        <SelectTrigger className="bg-background border-border text-foreground">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="none" className="text-foreground">
                            None (Sem raciocínio adicional)
                          </SelectItem>
                          <SelectItem value="low" className="text-foreground">
                            Low (Raciocínio leve)
                          </SelectItem>
                          <SelectItem value="medium" className="text-foreground">
                            Medium (Balanceado)
                          </SelectItem>
                          <SelectItem value="high" className="text-foreground">
                            High (Raciocínio profundo)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Controla a profundidade do raciocínio. Valores mais altos = respostas
                        melhores, porém mais tokens.
                      </p>
                    </div>

                    <div className="pt-2 border-t border-border">
                      <p className="text-xs text-yellow-500">
                        ⚠️ Modelos de raciocínio (o1, o3) ignoram o parâmetro Temperature.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* TAB 3: Personality */}
            <TabsContent value="personality" className="space-y-6 mt-6">
              {/* Avatar Upload Card */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm text-foreground">Avatar do Agente</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Imagem que representa o agente nas conversas
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-6">
                    {agentId ? (
                      <AvatarUpload
                        currentImageUrl={avatarUrl}
                        onUpload={(url) => setAvatarUrl(url)}
                        uploadPath="agents"
                        entityId={agentId}
                        size="h-24 w-24"
                        fallback={name}
                      />
                    ) : (
                      <div className="h-24 w-24 rounded-full bg-background border-2 border-border flex items-center justify-center">
                        <Brain className="h-8 w-8 text-gray-500" />
                      </div>
                    )}
                    <div>
                      <h3 className="text-sm font-medium text-foreground">
                        {agentId ? 'Foto do Agente' : 'Salve primeiro para adicionar avatar'}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {agentId
                          ? 'Clique na imagem para alterar'
                          : 'Crie o agente e depois edite para adicionar'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm text-foreground">System Prompt</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Deixe em branco para usar o prompt padrão
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {/* Insert Variable Button */}
                  {!isCreateMode && contextVars.length > 0 && (
                    <div className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-1 text-xs">
                            <Plus className="h-3 w-3" /> Inserir Variável
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-card border-border">
                          {contextVars.map((v) => (
                            <DropdownMenuItem
                              key={v.tag}
                              onClick={() => insertVariable(v.tag)}
                              className="text-foreground hover:bg-muted cursor-pointer"
                            >
                              <span className="flex-1">{v.label}</span>
                              <code className="ml-2 text-xs text-purple-400">{v.tag}</code>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                  <Textarea
                    ref={promptRef}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder={`Deixe em branco para usar o padrão:\n\n${DEFAULT_SYSTEM_PROMPT}`}
                    rows={10}
                    className="bg-background border-border text-foreground font-mono text-sm resize-y min-h-[200px]"
                  />
                </CardContent>
              </Card>

              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm text-foreground">Ferramentas Disponíveis</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Web Search */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-muted-foreground flex items-center gap-2">
                        🌐 Busca na Web (Tavily AI)
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Permite que o agente busque informações atuais na internet
                      </p>
                    </div>
                    <Switch checked={allowWebSearch} onCheckedChange={setAllowWebSearch} />
                  </div>

                  {/* Human Handoff — hidden for SubAgents (they can't escalate) */}
                  {!isSubagent && (
                    <div className="border-t border-border pt-4 mt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-muted-foreground flex items-center gap-2">
                            <Headset className="h-4 w-4 text-purple-500" />
                            Solicitar Humano
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Permite que o agente transfira a conversa para um humano quando necessário
                          </p>
                        </div>
                        <Switch checked={allowHumanHandoff} onCheckedChange={setAllowHumanHandoff} />
                      </div>
                    </div>
                  )}

                  {/* CSV Analytics */}
                  <div className="border-t border-border pt-4 mt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-muted-foreground flex items-center gap-2">
                          📊 Análise de Dados CSV
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Permite ordenar, filtrar e analisar dados de planilhas/tabelas
                        </p>
                      </div>
                      <Switch checked={allowCsvAnalytics} onCheckedChange={setAllowCsvAnalytics} />
                    </div>
                  </div>

                  {/* Vision */}
                  <div className="border-t border-border pt-4 mt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-muted-foreground flex items-center gap-2">
                          👁️ Visão Computacional
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Permite analisar imagens enviadas (GPT-4o, Claude 3.5 Sonnet)
                        </p>
                      </div>
                      <Switch checked={allowVision} onCheckedChange={setAllowVision} />
                    </div>

                    {allowVision && (
                      <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
                        <div>
                          <Label htmlFor="vision_model" className="text-muted-foreground text-sm">
                            🤖 Modelo de Visão
                          </Label>
                          <Select value={visionModel || ''} onValueChange={setVisionModel}>
                            <SelectTrigger className="bg-background border-border text-foreground mt-2">
                              <SelectValue placeholder="Selecione o modelo de visão" />
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border">
                              <SelectItem value="gpt-4o" className="text-foreground hover:bg-muted">
                                GPT-4o (OpenAI)
                              </SelectItem>
                              <SelectItem
                                value="claude-3-5-sonnet-20240620"
                                className="text-foreground hover:bg-muted"
                              >
                                Claude 3.5 Sonnet (Anthropic)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 4: Memory */}
            <TabsContent value="memory" className="space-y-6 mt-6">
              <MemoryConfigTab agentId={agentId || ''} />
            </TabsContent>

            {/* TAB 5: Tools (HTTP APIs) */}
            <TabsContent value="tools" className="space-y-6 mt-6">
              {/* RAG Configuration */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm text-foreground flex items-center gap-2">
                    <Brain className="h-4 w-4 text-blue-500" />
                    Configuração RAG (Base de Conhecimento)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Busca Profunda (HyDE)</Label>
                      <p className="text-xs text-muted-foreground">
                        Ativa geração de resposta hipotética para melhorar buscas complexas.
                        <br />
                        <span className="text-yellow-500">
                          ⚠️ Aumenta o tempo de resposta em ~5-8s.
                        </span>
                      </p>
                    </div>
                    <Switch checked={isHydeEnabled} onCheckedChange={setIsHydeEnabled} />
                  </div>
                </CardContent>
              </Card>

              {!agentId ? (
                <Card className="bg-blue-900/20 border-blue-600/50">
                  <CardContent className="pt-4">
                    <p className="text-blue-400 text-sm">
                      ℹ️ Salve o agente primeiro antes de configurar ferramentas HTTP.
                    </p>
                  </CardContent>
                </Card>
              ) : toolsView === 'list' ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <Plug className="w-5 h-5 text-blue-400" />
                        Ferramentas HTTP
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Configure integrações de API para o agente
                      </p>
                    </div>
                    <Button
                      onClick={() => {
                        setEditingTool(null);
                        setToolsView('form');
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Nova Ferramenta
                    </Button>
                  </div>

                  {loadingTools ? (
                    <div className="flex justify-center p-8">
                      <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                    </div>
                  ) : httpTools.length === 0 ? (
                    <Card className="bg-background border-border">
                      <CardContent className="flex flex-col items-center justify-center py-12">
                        <Terminal className="w-12 h-12 text-gray-600 mb-4" />
                        <p className="text-muted-foreground text-center">
                          Nenhuma ferramenta configurada.
                          <br />
                          <span className="text-sm text-muted-foreground">
                            Clique em "Nova Ferramenta" para adicionar.
                          </span>
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-3">
                      {httpTools.map((tool) => (
                        <Card
                          key={tool.id}
                          className="bg-background border-border hover:border-blue-600/50 transition-colors"
                        >
                          <CardContent className="p-4 flex justify-between items-center">
                            <div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="bg-blue-600 text-white border-transparent"
                                >
                                  {tool.method}
                                </Badge>
                                <span className="font-mono text-foreground">{tool.name}</span>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                                {tool.description}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  setEditingTool(tool);
                                  setToolsView('form');
                                }}
                              >
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-red-400"
                                onClick={() => handleDeleteTool(tool.id!)}
                              >
                                <Trash className="w-4 h-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <HttpToolForm
                  initialData={editingTool}
                  agentId={agentId}
                  onSave={handleSaveTool}
                  onCancel={() => setToolsView('list')}
                />
              )}
            </TabsContent>

            {/* TAB 6: MCP Integrations */}
            <TabsContent value="mcp" className="space-y-6 mt-6">
              {isCreateMode ? (
                <Card className="bg-blue-900/20 border-blue-600/50">
                  <CardContent className="pt-4">
                    <p className="text-blue-400 text-sm">
                      ℹ️ Salve o agente primeiro antes de configurar integrações MCP.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <MCPConfigTab agentId={agentId!} companyId={companyId} />
              )}
            </TabsContent>

            {/* TAB 7: Commerce (UCP) */}
            <TabsContent value="commerce" className="space-y-6 mt-6">
              {isCreateMode ? (
                <Card className="bg-blue-900/20 border-blue-600/50">
                  <CardContent className="pt-4">
                    <p className="text-blue-400 text-sm">
                      ℹ️ Salve o agente primeiro antes de configurar integrações de comércio.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <UCPConfigTab agentId={agentId!} companyId={companyId} />
              )}
            </TabsContent>

            {/* TAB 7: Widget */}
            <TabsContent value="widget" className="space-y-6 mt-6">
              {isCreateMode ? (
                <Card className="bg-blue-900/20 border-blue-600/50">
                  <CardContent className="pt-4">
                    <p className="text-blue-400 text-sm">
                      ℹ️ Salve o agente primeiro antes de configurar o Widget.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <WidgetConfigTab
                  agent={{
                    id: agentId || '',
                    company_id: companyId,
                    name,
                    slug,
                    avatar_url: avatarUrl,
                    is_active: true,
                    llm_temperature: temperature,
                    llm_max_tokens: maxTokens,
                    llm_top_p: topP,
                    llm_top_k: topK,
                    llm_frequency_penalty: frequencyPenalty,
                    llm_presence_penalty: presencePenalty,
                    agent_enabled: true,
                    use_langchain: true,
                    allow_web_search: allowWebSearch,
                    allow_vision: allowVision,
                    has_api_key: false,
                    has_vision_api_key: false,
                    has_whatsapp: hasExistingIntegration,
                    created_at: '',
                    updated_at: '',
                    widget_config: widgetConfig, // Pass state instead of empty object
                  }}
                  onChange={(config) => {
                    setWidgetConfig(config); // Store widget config in state
                    console.log('Widget config updated:', config);
                  }}
                />
              )}
            </TabsContent>

            {/* TAB 7: WhatsApp */}
            <TabsContent value="whatsapp" className="space-y-6 mt-6">
              {/* Aviso se for modo criação */}
              {isCreateMode && (
                <Card className="bg-blue-900/20 border-blue-600/50">
                  <CardContent className="pt-4">
                    <p className="text-blue-400 text-sm">
                      ℹ️ Salve o agente primeiro antes de configurar a integração WhatsApp.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Provider Selection */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm text-foreground flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-blue-500" />
                    Integração WhatsApp
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-muted-foreground">Provedor</Label>
                    <Select
                      value={whatsappProvider}
                      onValueChange={setWhatsappProvider}
                      disabled={isCreateMode}
                    >
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue placeholder="Selecione o provedor" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="none" className="text-foreground">
                          Nenhum (Desativado)
                        </SelectItem>
                        <SelectItem value="z-api" className="text-foreground">
                          Z-API
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Aviso de mudança de provedor */}
                  {hasExistingIntegration && whatsappProvider !== 'none' && (
                    <div className="p-3 bg-blue-600 border-transparent rounded-md">
                      <p className="text-white text-xs">
                        ⚠️ Para trocar de provedor, primeiro remova a integração atual selecionando
                        "Nenhum" e salvando.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Z-API Configuration - só mostra se z-api selecionado */}
              {whatsappProvider === 'z-api' && !isCreateMode && (
                <>
                  {/* Credenciais */}
                  <Card className="bg-card border-border">
                    <CardHeader>
                      <CardTitle className="text-sm text-foreground">Credenciais Z-API</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Telefone */}
                      <div>
                        <Label className="text-muted-foreground">Telefone Conectado *</Label>
                        <Input
                          value={whatsappIdentifier}
                          onChange={(e) => setWhatsappIdentifier(e.target.value)}
                          placeholder="Ex: 5544999999999"
                          className="bg-background border-border text-foreground"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          DDI + DDD + Número (sem espaços)
                        </p>
                      </div>

                      {/* Instance ID */}
                      <div>
                        <Label className="text-muted-foreground">Instance ID *</Label>
                        <Input
                          value={whatsappInstanceId}
                          onChange={(e) => setWhatsappInstanceId(e.target.value)}
                          placeholder="ID da instância Z-API"
                          className="bg-background border-border text-foreground"
                        />
                      </div>

                      {/* Token */}
                      <div>
                        <Label className="text-muted-foreground">Token *</Label>
                        <div className="relative">
                          <Input
                            type={showWhatsappToken ? 'text' : 'password'}
                            value={whatsappToken}
                            onChange={(e) => setWhatsappToken(e.target.value)}
                            placeholder="Token da instância"
                            className="bg-background border-border text-foreground pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowWhatsappToken(!showWhatsappToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showWhatsappToken ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Client Token */}
                      <div>
                        <Label className="text-muted-foreground">Client Token (Opcional)</Label>
                        <div className="relative">
                          <Input
                            type={showWhatsappClientToken ? 'text' : 'password'}
                            value={whatsappClientToken}
                            onChange={(e) => setWhatsappClientToken(e.target.value)}
                            placeholder="Token de segurança adicional"
                            className="bg-[#1A1A1A] border-[#3D3D3D] text-white pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowWhatsappClientToken(!showWhatsappClientToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showWhatsappClientToken ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Base URL */}
                      <div>
                        <Label className="text-muted-foreground">Base URL</Label>
                        <Input
                          value={whatsappBaseUrl}
                          onChange={(e) => setWhatsappBaseUrl(e.target.value)}
                          placeholder="https://api.z-api.io/instances"
                          className="bg-background border-border text-foreground"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Normalmente não precisa alterar
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Buffer Settings */}
                  <Card className="bg-card border-border">
                    <CardHeader>
                      <CardTitle className="text-sm text-foreground">Buffer de Mensagens</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Agrupa mensagens rápidas consecutivas antes de processar
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-muted-foreground">Habilitar Buffer</Label>
                          <p className="text-xs text-muted-foreground">Reduz chamadas de LLM em ~80%</p>
                        </div>
                        <Switch
                          checked={whatsappBufferEnabled}
                          onCheckedChange={setWhatsappBufferEnabled}
                        />
                      </div>

                      {whatsappBufferEnabled && (
                        <>
                          <div>
                            <Label className="text-muted-foreground">Debounce (segundos)</Label>
                            <Input
                              type="number"
                              min={1}
                              max={30}
                              value={whatsappBufferDebounce}
                              onChange={(e) =>
                                setWhatsappBufferDebounce(parseInt(e.target.value) || 3)
                              }
                              className="bg-background border-border text-foreground"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              Aguarda X segundos após última mensagem (recomendado: 3)
                            </p>
                          </div>

                          <div>
                            <Label className="text-muted-foreground">Max Wait (segundos)</Label>
                            <Input
                              type="number"
                              min={5}
                              max={60}
                              value={whatsappBufferMaxWait}
                              onChange={(e) =>
                                setWhatsappBufferMaxWait(parseInt(e.target.value) || 10)
                              }
                              className="bg-background border-border text-foreground"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              Tempo máximo desde primeira mensagem (recomendado: 10)
                            </p>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  {/* Status */}
                  <Card className="bg-card border-border">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-muted-foreground">Integração Ativa</Label>
                          <p className="text-xs text-muted-foreground">Habilita recebimento de mensagens</p>
                        </div>
                        <Switch checked={whatsappIsActive} onCheckedChange={setWhatsappIsActive} />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Save Button */}
                  <Button
                    onClick={handleSaveWhatsapp}
                    disabled={savingWhatsapp}
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                  >
                    {savingWhatsapp ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Salvando WhatsApp...
                      </>
                    ) : (
                      <>
                        <MessageCircle className="h-4 w-4 mr-2" />
                        Salvar Configuração WhatsApp
                      </>
                    )}
                  </Button>
                </>
              )}
            </TabsContent>

            {/* TAB: SUBAGENTS (Specialists) */}
            {!isSubagent && !isCreateMode && agentId && (
              <TabsContent value="subagents" className="space-y-6 mt-6">
                <SubAgentConfigTab agentId={agentId} companyId={companyId} />
              </TabsContent>
            )}
          </Tabs>
        )}

        {/* Action Buttons */}
        {!loading && (
          <div className="mt-6">
            <div className="flex gap-3">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {isCreateMode ? 'Criar Agente' : 'Salvar Alterações'}
                  </>
                )}
              </Button>
              <Button onClick={() => onOpenChange(false)} variant="outline" disabled={saving}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
