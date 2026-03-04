'use client';

import {
    getSmoothStepPath,
    type EdgeProps,
    type Edge,
    BaseEdge,
} from '@xyflow/react';

export type GlowAnimatedEdgeData = Record<string, unknown>;

export function GlowAnimatedEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
}: EdgeProps<Edge<GlowAnimatedEdgeData>>) {
    const [edgePath] = getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 16,
    });

    return (
        <g className="react-flow__edge-glow">
            {/* Layer 1: Blur background for depth */}
            <path
                d={edgePath}
                fill="none"
                stroke="rgba(99, 102, 241, 0.08)"
                strokeWidth={10}
                filter="url(#edge-blur)"
            />

            {/* Layer 2: Main gradient line with glow */}
            <BaseEdge
                id={id}
                path={edgePath}
                style={{
                    stroke: 'url(#edge-gradient)',
                    strokeWidth: 2,
                    filter: 'url(#glow)',
                }}
            />

            {/* Layer 3: Animated particles */}
            {[...Array(4)].map((_, i) => (
                <g key={i}>
                    {/* Particle halo */}
                    <circle r="5" fill="rgba(129, 140, 248, 0.1)" filter="url(#edge-blur)">
                        <animateMotion
                            begin={`${i * 0.75}s`}
                            dur="3s"
                            repeatCount="indefinite"
                            path={edgePath}
                            calcMode="spline"
                            keySplines="0.42, 0, 0.58, 1.0"
                        />
                    </circle>
                    {/* Particle core */}
                    <circle r="2" fill="#818cf8" opacity={0.85}>
                        <animateMotion
                            begin={`${i * 0.75}s`}
                            dur="3s"
                            repeatCount="indefinite"
                            path={edgePath}
                            calcMode="spline"
                            keySplines="0.42, 0, 0.58, 1.0"
                        />
                    </circle>
                </g>
            ))}
        </g>
    );
}
