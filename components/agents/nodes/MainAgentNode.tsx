'use client';

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Bot, Edit, Archive, CheckCircle, XCircle, Users } from 'lucide-react';

type MainAgentNodeData = {
    agent: {
        id: string;
        name: string;
        slug: string;
        is_active: boolean;
        llm_provider?: string;
        llm_model?: string;
        allow_web_search: boolean;
        allow_vision: boolean;
        has_api_key?: boolean;
        has_whatsapp: boolean;
        is_subagent?: boolean;
    };
    subCount: number;
    onEdit: (id: string) => void;
    onArchive: (id: string) => void;
};

export function MainAgentNode({
    data,
}: NodeProps<Node<MainAgentNodeData>>) {
    const { agent, subCount, onEdit, onArchive } = data;

    return (
        <div className="main-agent-node group" style={{ width: 320 }}>
            <div
                className="
          relative rounded-xl border border-[#2D2D2D] bg-[#141419]
          transition-all duration-300
          group-hover:border-indigo-500/50 group-hover:shadow-lg group-hover:shadow-indigo-500/10
        "
                style={{
                    background:
                        'linear-gradient(135deg, rgba(20,20,25,1) 0%, rgba(25,20,35,1) 100%)',
                }}
            >
                {/* Glow border on hover */}
                <div
                    className="
            absolute -inset-[1px] rounded-xl opacity-0 group-hover:opacity-100
            transition-opacity duration-500 -z-10
          "
                    style={{
                        background:
                            'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.15))',
                        filter: 'blur(4px)',
                    }}
                />

                {/* Header */}
                <div className="px-4 pt-4 pb-3">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                                <Bot className="w-5 h-5 text-indigo-400" />
                            </div>
                            <div>
                                <h3 className="text-[15px] font-semibold text-white leading-tight">
                                    {agent.name}
                                </h3>
                                <p className="text-xs text-gray-500 mt-0.5">/{agent.slug}</p>
                            </div>
                        </div>
                        <div className="flex items-center">
                            {agent.is_active ? (
                                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                                    <CheckCircle className="w-3 h-3" />
                                    Ativo
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-500/10 border border-gray-500/20 px-2 py-0.5 rounded-full">
                                    <XCircle className="w-3 h-3" />
                                    Inativo
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Model Info */}
                <div className="px-4 pb-3 space-y-1.5">
                    <div className="flex items-center justify-between text-[13px]">
                        <span className="text-gray-500">Provider</span>
                        <span className="text-gray-300 font-medium">
                            {agent.llm_provider || '—'}
                        </span>
                    </div>
                    <div className="flex items-center justify-between text-[13px]">
                        <span className="text-gray-500">Modelo</span>
                        <span className="text-gray-300 font-medium truncate max-w-[160px]">
                            {agent.llm_model || '—'}
                        </span>
                    </div>
                </div>

                {/* Capabilities */}
                <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                    {agent.allow_web_search && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-blue-500/25 text-blue-400 bg-blue-500/5">
                            🌐 Web
                        </span>
                    )}
                    {agent.allow_vision && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-purple-500/25 text-purple-400 bg-purple-500/5">
                            👁 Vision
                        </span>
                    )}
                    {agent.has_whatsapp && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-500/25 text-emerald-400 bg-emerald-500/5">
                            💬 WhatsApp
                        </span>
                    )}
                </div>

                {/* Actions */}
                <div className="px-4 pb-3 flex gap-2 border-t border-[#2D2D2D] pt-3">
                    <button
                        onClick={() => onEdit(agent.id)}
                        className="
              flex-1 flex items-center justify-center gap-1.5 text-[12px] font-medium
              py-1.5 rounded-lg
              bg-indigo-500/10 border border-indigo-500/25 text-indigo-400
              hover:bg-indigo-500/20 hover:border-indigo-500/40
              transition-all duration-200 cursor-pointer
            "
                    >
                        <Edit className="w-3 h-3" />
                        Editar
                    </button>
                    <button
                        onClick={() => onArchive(agent.id)}
                        className="
              flex items-center justify-center gap-1.5 text-[12px] font-medium
              py-1.5 px-3 rounded-lg
              bg-red-500/10 border border-red-500/25 text-red-400
              hover:bg-red-500/20 hover:border-red-500/40
              transition-all duration-200 cursor-pointer
            "
                    >
                        <Archive className="w-3 h-3" />
                    </button>
                </div>

                {/* Sub-agent count badge */}
                {subCount > 0 && (
                    <div className="px-4 pb-3 flex justify-center">
                        <span className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 rounded-full">
                            <Users className="w-3 h-3" />
                            {subCount} sub-agent{subCount > 1 ? 's' : ''}
                        </span>
                    </div>
                )}
            </div>

            {/* Handle at bottom for sub-agent connections */}
            {subCount > 0 && (
                <Handle
                    type="source"
                    position={Position.Bottom}
                    className="!bg-indigo-500/50 !border-indigo-400/30 !w-2 !h-2"
                />
            )}
        </div>
    );
}
