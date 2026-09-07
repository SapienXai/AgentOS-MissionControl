"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type PikoLoaderProps = {
  open: boolean;
  title: string;
  description: string;
  className?: string;
};

type LoaderMotion = {
  frame: number | null;
  lastTimestamp: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  velocityX: number;
  velocityY: number;
};

/**
 * A blocking operation indicator for work that is still happening in OpenClaw.
 * It is portaled above dialogs so it can be used from any screen or workflow.
 */
export function PikoLoader({ open, title, description, className }: PikoLoaderProps) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const useTransparentVideo = mounted && supportsTransparentVideo();
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const motionRef = useRef<LoaderMotion>({
    frame: null,
    lastTimestamp: 0,
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    velocityX: 0,
    velocityY: 0
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    const motion = motionRef.current;
    motion.x = window.innerWidth / 2;
    motion.y = window.innerHeight / 2;
    motion.targetX = motion.x;
    motion.targetY = motion.y;
    motion.velocityX = 0;
    motion.velocityY = 0;

    if (loaderRef.current) {
      loaderRef.current.style.left = `${motion.x}px`;
      loaderRef.current.style.top = `${motion.y}px`;
      loaderRef.current.style.transform = "translate3d(0, 0, 0)";
    }

    const animate = (timestamp: number) => {
      const elapsed = Math.min((timestamp - motion.lastTimestamp) / 1000, 0.04);
      motion.lastTimestamp = timestamp;

      const deltaX = motion.targetX - motion.x;
      const deltaY = motion.targetY - motion.y;
      const springStrength = 24;
      const damping = 8;

      motion.velocityX = (motion.velocityX + deltaX * springStrength * elapsed) * Math.exp(-damping * elapsed);
      motion.velocityY = (motion.velocityY + deltaY * springStrength * elapsed) * Math.exp(-damping * elapsed);
      motion.x += motion.velocityX * elapsed;
      motion.y += motion.velocityY * elapsed;

      if (loaderRef.current) {
        loaderRef.current.style.left = `${motion.x}px`;
        loaderRef.current.style.top = `${motion.y}px`;
      }

      const settled =
        Math.abs(deltaX) < 0.4 &&
        Math.abs(deltaY) < 0.4 &&
        Math.abs(motion.velocityX) < 0.4 &&
        Math.abs(motion.velocityY) < 0.4;

      motion.frame = settled ? null : window.requestAnimationFrame(animate);
    };

    const handlePointerMove = (event: PointerEvent) => {
      motion.targetX = event.clientX + 32;
      motion.targetY = event.clientY + 24;

      if (motion.frame === null) {
        motion.lastTimestamp = performance.now();
        motion.frame = window.requestAnimationFrame(animate);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (motion.frame !== null) {
        window.cancelAnimationFrame(motion.frame);
        motion.frame = null;
      }
    };
  }, [open]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[10000]"
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <div
        ref={loaderRef}
        className={cn("piko-loader-follow absolute left-1/2 top-1/2 flex w-full max-w-[152px] flex-col items-center text-center", className)}
      >
        <div className="piko-loader-float relative flex h-[90px] w-[90px] items-center justify-center sm:h-[107px] sm:w-[107px]">
          <div className="absolute inset-3 rounded-full bg-violet-400/20 blur-3xl" />
          {useTransparentVideo ? (
            <video
              className="relative h-full w-full object-contain drop-shadow-[0_18px_24px_rgba(0,0,0,0.5)]"
              src="/assets/pikoLoader.webm"
              autoPlay
              loop
              muted
              playsInline
              aria-hidden="true"
            />
          ) : (
            <span
              className="relative flex h-[72%] w-[72%] items-center justify-center rounded-full border border-cyan-200/35 bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.28),rgba(34,211,238,0.15)_42%,rgba(124,58,237,0.12)_72%,transparent)] shadow-[0_12px_30px_rgba(34,211,238,0.18)]"
              aria-hidden="true"
            >
              <span className="absolute inset-2 rounded-full border border-cyan-100/25" />
              <LoaderCircle className="h-8 w-8 animate-spin text-cyan-200" strokeWidth={1.6} />
            </span>
          )}
        </div>
        <div className="mt-0.5 rounded-md border border-border/70 bg-background/80 px-1.5 py-1 shadow-sm backdrop-blur-sm">
          <p className="font-display text-[10px] font-semibold tracking-[-0.02em] text-foreground">{title}</p>
          <p className="mt-px text-[8px] leading-3 text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>,
    document.body
  );
}

function supportsTransparentVideo() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent;
  const isAppleWebKit = /AppleWebKit/i.test(userAgent) &&
    !/(Chrome|Chromium|CriOS|Edg|OPR)/i.test(userAgent);
  // macOS WebKit/WKWebView can decode VP9 WebM but paint its alpha channel
  // as opaque black. Keep the loader transparent and legible on that path.
  return !isAppleWebKit;
}
