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
  const taskFocused = Boolean(data?.taskFocused);
  const surfaceTether = Boolean(data?.surfaceTether);
  const edgeActive = Boolean(animated) || composerFocused || taskFocused || surfaceTether;
  const strokeWidth = resolveStrokeWidth(style?.strokeWidth, edgeActive);
  const glowStrokeWidth = strokeWidth + (composerFocused ? 5 : taskFocused ? 4.6 : surfaceTether ? 4.8 : 4);
  const motionPathId = `mission-edge-motion-${sanitizeDomId(id)}`;
  const packetSpecs = composerFocused || taskFocused
    ? [
        { size: 5.2, halo: 9.2, duration: 1.95, delay: 0, alpha: 1 },
        { size: 3.8, halo: 7.2, duration: 2.3, delay: 0.58, alpha: 0.92 },
        { size: 2.8, halo: 5.8, duration: 2.05, delay: 1.12, alpha: 0.88 },
        { size: 2.1, halo: 4.8, duration: 2.7, delay: 1.82, alpha: 0.82 }
      ]
    : surfaceTether
      ? [
          { size: 4.8, halo: 8.8, duration: 2.15, delay: 0, alpha: 0.98 },
          { size: 3.5, halo: 7.1, duration: 2.45, delay: 0.55, alpha: 0.9 },
          { size: 2.4, halo: 5.3, duration: 2.15, delay: 1.1, alpha: 0.84 },
          { size: 1.8, halo: 4.2, duration: 2.9, delay: 1.75, alpha: 0.76 }
        ]
      : edgeActive
      ? [
          { size: 4.6, halo: 8.4, duration: 2.4, delay: 0, alpha: 0.96 },
          { size: 3.2, halo: 6.4, duration: 2.95, delay: 0.78, alpha: 0.86 },
          { size: 2.2, halo: 5.2, duration: 2.65, delay: 1.42, alpha: 0.8 }
        ]
      : [];
  const tetherPalette = surfaceTether ? buildSurfaceTetherPalette(data?.surfaceAccentColor) : null;

  const glowStyle: CSSProperties = {
    ...style,
    animation: "none",
    pointerEvents: "none",
    strokeDasharray: "none",
    strokeWidth: glowStrokeWidth,
    ...(tetherPalette ?? {})
  };

  const coreStyle: CSSProperties = {
    ...style,
    animation: "none",
    pointerEvents: "none",
    strokeDasharray: "none",
    strokeWidth,
    ...(tetherPalette ?? {})
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        className={cn(
          "mission-edge__path mission-edge__path--glow",
          edgeActive && "mission-edge__path--animated",
          composerFocused && "mission-edge__path--composer",
          surfaceTether && "mission-edge__path--surface-tether",
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
          surfaceTether && "mission-edge__path--surface-tether",
          selected && "mission-edge__path--selected"
        )}
        interactionWidth={interactionWidth}
        markerEnd={surfaceTether ? undefined : markerEnd}
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

function buildSurfaceTetherPalette(color: string | null | undefined) {
  const normalized = normalizeHexColor(color);
  const core = normalized ?? "#7dd3fc";

  return {
    "--mission-edge-core": `${core}cc`,
    "--mission-edge-core-active": core,
    "--mission-edge-glow": `${core}55`,
    "--mission-edge-glow-active": `${core}88`,
    "--mission-edge-packet": core
  } as CSSProperties;
}

function normalizeHexColor(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}
