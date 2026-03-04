'use client';

import { useEffect, useState, Fragment } from 'react';
import { RefreshCw, Search, Edit2, Check, X, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface PricingItem {
  id: string;
  model_name: string;
  input_price_per_million: number;
  output_price_per_million: number;
  unit: string;
  is_active: boolean;
  provider: string | null;
  display_name: string | null;
  sell_multiplier: number;
}

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: '🟠',
  openai: '🟢',
  google: '🔵',
  openrouter: '🔶',
  other: '⚪',
};

const PROVIDER_ORDER = ['anthropic', 'openai', 'google', 'openrouter', 'other'];

export default function PricingPage() {
  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [syncingOpenRouter, setSyncingOpenRouter] = useState(false);
  const [search, setSearch] = useState('');
  const [filterProvider, setFilterProvider] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    input: 0,
    output: 0,
    sell_multiplier: 2.68,
    is_active: true,
  });
  const [saving, setSaving] = useState(false);

  const fetchPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/pricing', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setPricing(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching pricing:', error);
    } finally {
      setLoading(false);
    }
  };

  const reloadCache = async () => {
    setReloading(true);
    try {
      const response = await fetch('/api/admin/pricing/reload-cache', {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        alert(`Cache atualizado! ${data.count} modelos carregados.`);
      }
    } catch (error) {
      console.error('Error reloading cache:', error);
      alert('Erro ao recarregar cache');
    } finally {
      setReloading(false);
    }
  };

  const handleEdit = (item: PricingItem) => {
    setEditingId(item.id);
    setEditForm({
      input: item.input_price_per_million,
      output: item.output_price_per_million,
      sell_multiplier: item.sell_multiplier ?? 2.68,
      is_active: item.is_active,
    });
  };

  const handleSave = async () => {
    if (!editingId) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/pricing/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          input_price_per_million: editForm.input,
          output_price_per_million: editForm.output,
          sell_multiplier: editForm.sell_multiplier,
          is_active: editForm.is_active,
        }),
      });

      if (response.ok) {
        await fetchPricing();
        setEditingId(null);
      } else {
        alert('Erro ao salvar');
      }
    } catch (error) {
      console.error('Error saving:', error);
      alert('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingId(null);
  };

  useEffect(() => {
    fetchPricing();
  }, []);

  // Filter and group by provider
  const filteredPricing = pricing.filter((item) => {
    const matchesSearch = item.model_name.toLowerCase().includes(search.toLowerCase());
    const matchesProvider = filterProvider === 'all' || item.provider === filterProvider;
    return matchesSearch && matchesProvider;
  });

  const groupedPricing = PROVIDER_ORDER.reduce(
    (acc, provider) => {
      const items = filteredPricing.filter((p) => (p.provider || 'other') === provider);
      if (items.length > 0) {
        acc[provider] = items;
      }
      return acc;
    },
    {} as Record<string, PricingItem[]>,
  );

  const formatPrice = (value: number) => {
    return `$ ${value.toFixed(4)}`;
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Tabela de Custos LLM</h1>
          <p className="text-muted-foreground">Preços por milhão de tokens (input/output)</p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={async () => {
              const newMultiplier = prompt('Novo multiplicador para TODOS os modelos:', '2.68');
              if (!newMultiplier) return;
              const value = parseFloat(newMultiplier);
              if (isNaN(value) || value <= 0) {
                alert('Valor inválido');
                return;
              }
              try {
                const response = await fetch('/api/admin/pricing/bulk-update-multiplier', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ sell_multiplier: value, provider: 'all' }),
                });
                const data = await response.json();
                if (response.ok) {
                  alert(`${data.message}`);
                  fetchPricing();
                } else {
                  alert(`Erro: ${data.detail}`);
                }
              } catch (error: any) {
                alert(`Erro: ${error.message}`);
              }
            }}
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
          >
            Atualizar Multiplicador
          </Button>

          <Button
            onClick={async () => {
              setSyncingOpenRouter(true);
              try {
                const response = await fetch('/api/admin/pricing/sync-openrouter', {
                  method: 'POST',
                  credentials: 'include',
                });
                const data = await response.json();
                if (response.ok) {
                  alert(`Sync concluído! ${data.message}`);
                  fetchPricing();
                } else {
                  alert(`Erro: ${data.detail}`);
                }
              } catch (error: any) {
                alert(`Erro: ${error.message}`);
              } finally {
                setSyncingOpenRouter(false);
              }
            }}
            disabled={syncingOpenRouter}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncingOpenRouter ? 'animate-spin' : ''}`} />
            {syncingOpenRouter ? 'Sincronizando...' : 'Sync OpenRouter'}
          </Button>

          <Button
            onClick={reloadCache}
            disabled={reloading}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${reloading ? 'animate-spin' : ''}`} />
            Reload Cache
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar modelo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-background border-border text-foreground"
          />
        </div>

        <Select value={filterProvider} onValueChange={setFilterProvider}>
          <SelectTrigger className="w-[180px] bg-background border-border text-foreground">
            <SelectValue placeholder="Filtrar provider" />
          </SelectTrigger>
          <SelectContent className="bg-background border-border">
            <SelectItem value="all" className="text-foreground">
              Todos
            </SelectItem>
            <SelectItem value="anthropic" className="text-foreground">
              🟠 Anthropic
            </SelectItem>
            <SelectItem value="openai" className="text-foreground">
              🟢 OpenAI
            </SelectItem>
            <SelectItem value="google" className="text-foreground">
              🔵 Google
            </SelectItem>
            <SelectItem value="openrouter" className="text-foreground">
              🟣 OpenRouter
            </SelectItem>
            <SelectItem value="other" className="text-foreground">
              ⚪ Outros
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando...</div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-medium text-muted-foreground uppercase">
                  Modelo
                </th>
                <th className="px-6 py-4 text-right text-xs font-medium text-muted-foreground uppercase">
                  Input/1M
                </th>
                <th className="px-6 py-4 text-right text-xs font-medium text-muted-foreground uppercase">
                  Output/1M
                </th>
                <th className="px-6 py-4 text-right text-xs font-medium text-muted-foreground uppercase">
                  Multiplicador
                </th>
                <th className="px-6 py-4 text-center text-xs font-medium text-muted-foreground uppercase">
                  Ativo
                </th>
                <th className="px-6 py-4 text-center text-xs font-medium text-muted-foreground uppercase">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.entries(groupedPricing).map(([provider, items]) => (
                <Fragment key={provider}>
                  {/* Provider Header */}
                  <tr className="bg-muted/50">
                    <td colSpan={6} className="px-6 py-3">
                      <span className="text-lg font-semibold text-foreground">
                        {PROVIDER_ICONS[provider]}{' '}
                        {provider.charAt(0).toUpperCase() + provider.slice(1)}
                      </span>
                    </td>
                  </tr>

                  {/* Provider Items */}
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-accent/50">
                      <td className="px-6 py-4 text-foreground font-mono text-sm">
                        {item.model_name}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {editingId === item.id ? (
                          <Input
                            type="number"
                            step="0.0001"
                            value={editForm.input}
                            onChange={(e) =>
                              setEditForm({ ...editForm, input: parseFloat(e.target.value) })
                            }
                            className="w-24 bg-background border-blue-500 text-foreground text-right"
                          />
                        ) : (
                          <span
                            className={`text-foreground ${item.unit === 'minute' ? 'text-blue-400' : ''}`}
                          >
                            {formatPrice(item.input_price_per_million)}
                            {item.unit === 'minute' && '/min'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {editingId === item.id ? (
                          <Input
                            type="number"
                            step="0.0001"
                            value={editForm.output}
                            onChange={(e) =>
                              setEditForm({ ...editForm, output: parseFloat(e.target.value) })
                            }
                            className="w-24 bg-background border-blue-500 text-foreground text-right"
                          />
                        ) : (
                          <span className="text-foreground">
                            {formatPrice(item.output_price_per_million)}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {editingId === item.id ? (
                          <Input
                            type="number"
                            step="0.01"
                            value={editForm.sell_multiplier}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                sell_multiplier: parseFloat(e.target.value),
                              })
                            }
                            className="w-20 bg-background border-blue-500 text-foreground text-right"
                          />
                        ) : (
                          <span className="text-emerald-400 font-medium">
                            {(item.sell_multiplier ?? 2.68).toFixed(2)}x
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {editingId === item.id ? (
                          <div className="flex items-center justify-center">
                            <Switch
                              checked={editForm.is_active}
                              onCheckedChange={(checked) =>
                                setEditForm({ ...editForm, is_active: checked })
                              }
                            />
                          </div>
                        ) : (
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${item.is_active ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'}`}
                          >
                            {item.is_active ? 'Ativo' : 'Inativo'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {editingId === item.id ? (
                          <div className="flex gap-2 justify-center">
                            <Button
                              size="sm"
                              onClick={handleSave}
                              disabled={saving}
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleCancel}
                              className="bg-background text-foreground hover:bg-muted border-0"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(item)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}

              {filteredPricing.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    {pricing.length === 0
                      ? 'Nenhum modelo encontrado. Execute o seed_pricing.py primeiro.'
                      : 'Nenhum modelo corresponde aos filtros.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Info */}
      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <p className="text-blue-400 text-sm">
          💡 <strong>Dica:</strong> Após editar preços, clique em "Reload Cache" para que as
          mudanças tenham efeito imediato no cálculo de custos.
        </p>
      </div>
    </div>
  );
}
