'use client';

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Zap, Edit, Archive } from 'lucide-react';

type SubAgentNodeData = {
    agent: {
        id: string;
        name: string;
        slug?: string;
        is_active?: boolean;
        llm_provider?: string;
        llm_model?: string;
    };
    parentName: string | null;
    taskDescription: string;
    onEdit: (id: string) => void;
    onArchive: (id: string) => void;
};

export function SubAgentNode({
    data,
}: NodeProps<Node<SubAgentNodeData>>) {
    const { agent, parentName, onEdit, onArchive } = data;

    const modelInfo = [agent.llm_provider, agent.llm_model]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="sub-agent-node group" style={{ width: 260 }}>
            {/* Handle at top for parent connection */}
            <Handle
                type="target"
                position={Position.Top}
                className="!bg-indigo-500/50 !border-indigo-400/30 !w-2 !h-2"
            />

            <div
                className="
          relative rounded-lg border border-[#252530] bg-[#12121a]
          transition-all duration-300
          group-hover:border-indigo-500/30 group-hover:shadow-md group-hover:shadow-indigo-500/5
        "
            >
                {/* Header */}
                <div className="px-3 pt-3 pb-2">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-violet-500/10 rounded-md border border-violet-500/15">
                                <Zap className="w-3.5 h-3.5 text-violet-400" />
                            </div>
                            <div>
                                <h4 className="text-[13px] font-medium text-gray-200 leading-tight">
                                    {agent.name}
                                </h4>
                                {parentName && (
                                    <p className="text-[10px] text-gray-600 mt-0.5">
                                        Sub-agente de {parentName}
                                    </p>
                                )}
                            </div>
                        </div>
                        {/* Status dot */}
                        <span
                            className={`w-2 h-2 rounded-full mt-1.5 ${agent.is_active !== false
                                    ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                                    : 'bg-gray-600'
                                }`}
                        />
                    </div>
                </div>

                {/* Model info condensed */}
                {modelInfo && (
                    <div className="px-3 pb-2">
                        <p className="text-[11px] text-gray-500 truncate">{modelInfo}</p>
                    </div>
                )}

                {/* Actions */}
                <div className="px-3 pb-2.5 flex gap-1.5 border-t border-[#1f1f2e] pt-2">
                    <button
                        onClick={() => onEdit(agent.id)}
                        className="
              flex-1 flex items-center justify-center gap-1 text-[11px] font-medium
              py-1 rounded-md
              bg-indigo-500/8 border border-indigo-500/20 text-indigo-400
              hover:bg-indigo-500/15 hover:border-indigo-500/30
              transition-all duration-200 cursor-pointer
            "
                    >
                        <Edit className="w-2.5 h-2.5" />
                        Editar
                    </button>
                    <button
                        onClick={() => onArchive(agent.id)}
                        className="
              flex items-center justify-center gap-1 text-[11px] font-medium
              py-1 px-2 rounded-md
              bg-red-500/8 border border-red-500/20 text-red-400
              hover:bg-red-500/15 hover:border-red-500/30
              transition-all duration-200 cursor-pointer
            "
                    >
                        <Archive className="w-2.5 h-2.5" />
                    </button>
                </div>
            </div>
        </div>
    );
}
