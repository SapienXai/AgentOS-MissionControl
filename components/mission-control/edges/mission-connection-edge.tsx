"use client";

import { BaseEdge, type Edge, type EdgeProps, getSimpleBezierPath } from "@xyflow/react";
import type { CSSProperties } from "react";

import type { MissionEdgeData } from "@/components/mission-control/canvas-types";
import { cn } from "@/lib/utils";

type MissionEdge = Edge<MissionEdgeData, "simplebezier">;

export function MissionConnectionEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  data,
  selected,
  animated,
  markerEnd,
  interactionWidth = 28
}: EdgeProps<MissionEdge>) {
  const [edgePath] = getSimpleBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  const composerFocused = Boolean(data?.composerFocused);
  const telegramTether = Boolean(data?.telegramTether);
  const edgeActive = Boolean(animated) || composerFocused;
  const strokeWidth = resolveStrokeWidth(style?.strokeWidth, edgeActive);
  const glowStrokeWidth = strokeWidth + (telegramTether ? 3.6 : composerFocused ? 5 : 4);
  const motionPathId = `mission-edge-motion-${sanitizeDomId(id)}`;
  const packetSpecs = telegramTether
    ? composerFocused
      ? [
          { size: 3.8, halo: 7.2, duration: 2.05, delay: 0, alpha: 1 },
          { size: 2.4, halo: 5, duration: 2.55, delay: 0.74, alpha: 0.9 }
        ]
      : edgeActive
        ? [
            { size: 3.2, halo: 6, duration: 2.5, delay: 0, alpha: 0.96 },
            { size: 2.1, halo: 4.4, duration: 3.05, delay: 0.72, alpha: 0.84 }
          ]
        : []
    : composerFocused
      ? [
          { size: 5.2, halo: 9.2, duration: 1.95, delay: 0, alpha: 1 },
          { size: 3.8, halo: 7.2, duration: 2.3, delay: 0.58, alpha: 0.92 },
          { size: 2.8, halo: 5.8, duration: 2.05, delay: 1.12, alpha: 0.88 },
          { size: 2.1, halo: 4.8, duration: 2.7, delay: 1.82, alpha: 0.82 }
        ]
      : edgeActive
        ? [
            { size: 4.6, halo: 8.4, duration: 2.4, delay: 0, alpha: 0.96 },
            { size: 3.2, halo: 6.4, duration: 2.95, delay: 0.78, alpha: 0.86 },
            { size: 2.2, halo: 5.2, duration: 2.65, delay: 1.42, alpha: 0.8 }
          ]
        : [];

  const glowStyle: CSSProperties = {
    ...style,
    animation: "none",
    pointerEvents: "none",
    strokeDasharray: "none",
    strokeWidth: glowStrokeWidth
  };

  const coreStyle: CSSProperties = {
    ...style,
    animation: "none",
    pointerEvents: "none",
    strokeDasharray: "none",
    strokeWidth
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        className={cn(
          "mission-edge__path mission-edge__path--glow",
          edgeActive && "mission-edge__path--animated",
          composerFocused && "mission-edge__path--composer",
          telegramTether && "mission-edge__path--telegram-tether",
          selected && "mission-edge__path--selected"
        )}
        interactionWidth={0}
        style={glowStyle}
      />
      <BaseEdge
        path={edgePath}
        className={cn(
          "mission-edge__path mission-edge__path--core",
          edgeActive && "mission-edge__path--animated",
          composerFocused && "mission-edge__path--composer",
          telegramTether && "mission-edge__path--telegram-tether",
          selected && "mission-edge__path--selected"
        )}
        interactionWidth={interactionWidth}
        markerEnd={telegramTether ? undefined : markerEnd}
        style={coreStyle}
      />
      {edgeActive ? (
        <path
          id={motionPathId}
          d={edgePath}
          fill="none"
          stroke="none"
          opacity={0}
          style={{ pointerEvents: "none" }}
        />
      ) : null}
      {packetSpecs.map((packet, index) => (
        <g
          key={`${motionPathId}-packet-${index}`}
          className="mission-edge__packet"
          style={
            {
              color: "var(--mission-edge-packet)",
              opacity: packet.alpha,
              filter: "drop-shadow(0 0 10px var(--mission-edge-glow-active))"
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <circle r={packet.halo} fill="currentColor" opacity={0.16} />
          <circle r={packet.size} fill="currentColor" opacity={0.95} />
          <animateMotion
            dur={`${packet.duration}s`}
            begin={`${packet.delay}s`}
            repeatCount="indefinite"
            rotate="auto"
          >
            <mpath href={`#${motionPathId}`} />
          </animateMotion>
        </g>
      ))}
    </>
  );
}

function resolveStrokeWidth(strokeWidth: unknown, animated: boolean) {
  if (typeof strokeWidth === "number" && Number.isFinite(strokeWidth)) {
    return strokeWidth;
  }

  if (typeof strokeWidth === "string") {
    const parsed = Number.parseFloat(strokeWidth);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return animated ? 2.95 : 2.25;
}

function sanitizeDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
