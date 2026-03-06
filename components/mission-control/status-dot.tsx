"use client";

import { motion } from "motion/react";

import { cn } from "@/lib/utils";

export function StatusDot({
  tone,
  pulse = false,
  className
}: {
  tone: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex h-2.5 w-2.5 items-center justify-center", className)}>
      {pulse ? (
        <motion.span
          className={cn("absolute inset-0 rounded-full", tone)}
          animate={{ opacity: [0.4, 0], scale: [1, 2.2] }}
          transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
        />
      ) : null}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", tone)} />
    </span>
  );
}
