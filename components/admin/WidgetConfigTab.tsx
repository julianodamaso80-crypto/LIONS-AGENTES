'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Agent, WidgetConfig } from '@/types/agent';
import { Copy, Check, MessageCircle } from 'lucide-react';

interface Props {
  agent: Agent;
  onChange: (config: WidgetConfig) => void;
}

export function WidgetConfigTab({ agent, onChange }: Props) {
  const [config, setConfig] = useState<WidgetConfig>(
    agent.widget_config || {
      title: 'Suporte Online',
      subtitle: 'Geralmente responde em alguns minutos',
      primaryColor: '#2563EB',
      position: 'bottom-right',
      initialMessage: 'Olá! Como posso ajudar você hoje?',
      showFooter: true,
    },
  );

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    onChange(config);
  }, [config, onChange]);

  const updateConfig = (key: keyof WidgetConfig, value: any) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://app.smith.ai';

  const embedCode = `<script id="mw" src="${appUrl}/widget.js" onload="window.mw && window.mw('init', { agentId: '${agent.id}' })"></script>`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Configuration Panel */}
      <div className="space-y-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm text-foreground flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              Aparência do Widget
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Título do Chat</Label>
              <Input
                value={config.title || ''}
                onChange={(e) => updateConfig('title', e.target.value)}
                className="bg-background border-border text-foreground"
                placeholder="Suporte Online"
              />
            </div>
            <div>
              <Label className="text-muted-foreground">Subtítulo</Label>
              <Input
                value={config.subtitle || ''}
                onChange={(e) => updateConfig('subtitle', e.target.value)}
                className="bg-background border-border text-foreground"
                placeholder="Geralmente responde em alguns minutos"
              />
            </div>
            <div>
              <Label className="text-muted-foreground">Cor Principal</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={config.primaryColor || '#2563EB'}
                  onChange={(e) => updateConfig('primaryColor', e.target.value)}
                  className="w-12 h-10 p-1 bg-background border-border cursor-pointer"
                />
                <Input
                  value={config.primaryColor || '#2563EB'}
                  onChange={(e) => updateConfig('primaryColor', e.target.value)}
                  className="flex-1 bg-background border-border text-foreground font-mono"
                  placeholder="#2563EB"
                />
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Posição</Label>
              <Select
                value={config.position || 'bottom-right'}
                onValueChange={(v) => updateConfig('position', v)}
              >
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="bottom-right" className="text-foreground">
                    Direita Inferior
                  </SelectItem>
                  <SelectItem value="bottom-left" className="text-foreground">
                    Esquerda Inferior
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-muted-foreground">Mensagem Inicial</Label>
              <Input
                value={config.initialMessage || ''}
                onChange={(e) => updateConfig('initialMessage', e.target.value)}
                className="bg-background border-border text-foreground"
                placeholder="Olá! Como posso ajudar?"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm text-foreground">🔧 Código de Instalação</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 p-3 rounded-md border border-border relative group">
              <pre className="text-xs text-black dark:text-white whitespace-pre-wrap break-all font-mono overflow-x-auto pr-10">
                {embedCode}
              </pre>
              <Button
                size="icon"
                variant="ghost"
                onClick={copyToClipboard}
                className="absolute top-2 right-2 hover:bg-white/10"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Cole este código antes da tag{' '}
              <code className="bg-muted px-1 rounded">&lt;/body&gt;</code> do seu site.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Live Preview */}
      <div className="relative bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl border border-white/10 min-h-[550px] flex items-end p-6 overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)',
              backgroundSize: '20px 20px',
            }}
          ></div>
        </div>

        <div className="absolute top-4 left-4">
          <span className="text-xs text-gray-500 bg-gray-800/50 px-2 py-1 rounded">Preview</span>
        </div>

        {/* Mock do Widget */}
        <div
          className={`relative flex flex-col items-${config.position === 'bottom-left' ? 'start' : 'end'} gap-4 w-full`}
        >
          {/* Janela de Chat (Mock) */}
          <div className="w-full max-w-[340px] bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200">
            <div
              className="p-4 text-white flex items-center gap-3"
              style={{ backgroundColor: config.primaryColor || '#2563EB' }}
            >
              {agent.avatar_url ? (
                <img
                  src={agent.avatar_url}
                  alt=""
                  className="w-10 h-10 rounded-full bg-white/20 object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5" />
                </div>
              )}
              <div>
                <div className="font-bold text-sm">{config.title || 'Suporte Online'}</div>
                <div className="text-xs opacity-90">{config.subtitle || 'Online'}</div>
              </div>
            </div>
            <div className="h-[280px] bg-gray-50 p-4 flex flex-col gap-3">
              <div className="self-start bg-white p-3 rounded-2xl rounded-tl-sm shadow-sm text-sm text-gray-800 border border-gray-100 max-w-[85%]">
                {config.initialMessage || 'Olá! Como posso ajudar?'}
              </div>
            </div>
            <div className="p-3 border-t bg-white">
              <div className="h-10 bg-gray-100 rounded-full w-full flex items-center px-4">
                <span className="text-gray-400 text-sm">Digite sua mensagem...</span>
              </div>
            </div>
            {config.showFooter !== false && (
              <div className="text-center py-2 bg-gray-50 border-t">
                <span className="text-[10px] text-gray-400">Powered by Agent Smith</span>
              </div>
            )}
          </div>

          {/* Bolinha (Launcher) */}
          <div
            className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center cursor-pointer hover:scale-105 transition-transform"
            style={{ backgroundColor: config.primaryColor || '#2563EB' }}
          >
            <MessageCircle className="w-7 h-7 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}
