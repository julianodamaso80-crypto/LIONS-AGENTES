'use client';

import {
    ReactFlow,
    Background,
    Controls,
    PanOnScrollMode,
    type Node,
    type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { MainAgentNode } from './nodes/MainAgentNode';
import { SubAgentNode } from './nodes/SubAgentNode';
import { GlowAnimatedEdge } from './edges/GlowAnimatedEdge';
import {
    useAgentFlowLayout,
    type AgentWithDelegations,
} from './hooks/useAgentFlowLayout';

const nodeTypes = {
    mainAgent: MainAgentNode,
    subAgent: SubAgentNode,
};

const edgeTypes = {
    glowAnimated: GlowAnimatedEdge,
};

interface AgentFlowViewProps {
    agents: AgentWithDelegations[];
    onEdit: (agentId: string) => void;
    onArchive: (agentId: string) => void;
}

export function AgentFlowView({ agents, onEdit, onArchive }: AgentFlowViewProps) {
    const { nodes, edges } = useAgentFlowLayout(agents, onEdit, onArchive);

    return (
        <div
            className="w-full rounded-xl border border-[#1e1e2a] overflow-hidden"
            style={{
                height: 'calc(100vh - 260px)',
                minHeight: 420,
                background: 'linear-gradient(180deg, #0c0c14 0%, #0e0e18 100%)',
            }}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                colorMode="dark"
                fitView
                fitViewOptions={{ padding: 0.35, maxZoom: 1.2 }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={true}
                panOnScroll={true}
                panOnScrollMode={PanOnScrollMode.Horizontal}
                zoomOnScroll={false}
                minZoom={0.4}
                maxZoom={1.5}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#1a1a2e" gap={24} size={1} />
                <Controls
                    showInteractive={false}
                    className="!bg-[#1a1a24] !border-[#2a2a3a] !shadow-lg !rounded-lg"
                />

                {/* SVG defs for glow effects on edges */}
                <svg style={{ position: 'absolute', width: 0, height: 0 }}>
                    <defs>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                            <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                        <filter id="edge-blur">
                            <feGaussianBlur stdDeviation="4" />
                        </filter>
                        <linearGradient
                            id="edge-gradient"
                            x1="0%"
                            y1="0%"
                            x2="0%"
                            y2="100%"
                        >
                            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
                            <stop offset="50%" stopColor="#7c3aed" stopOpacity="0.6" />
                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.4" />
                        </linearGradient>
                    </defs>
                </svg>
            </ReactFlow>
        </div>
    );
}
