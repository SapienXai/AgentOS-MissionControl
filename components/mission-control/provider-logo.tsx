"use client";

import Image from "next/image";
import * as simpleIcons from "simple-icons";

import { cn } from "@/lib/utils";

type SimpleIconData = {
  title: string;
  hex: string;
  path: string;
};

type ProviderLogoConfig =
  | { kind: "image"; src: string }
  | { kind: "simple"; icon: SimpleIconData };

const simpleIconMap = simpleIcons as Record<string, SimpleIconData | undefined>;

const providerLogoConfig: Record<string, ProviderLogoConfig> = {
  "openai-codex": {
    kind: "image",
    src: "/assets/provider-logos/openai.svg"
  },
  openai: {
    kind: "image",
    src: "/assets/provider-logos/openai.svg"
  },
  anthropic: {
    kind: "simple",
    icon: requireSimpleIcon("siAnthropic", "Anthropic")
  },
  gemini: {
    kind: "simple",
    icon: requireSimpleIcon("siGooglegemini", "Gemini")
  },
  deepseek: {
    kind: "image",
    src: "/assets/provider-logos/deepseek.svg"
  },
  mistral: {
    kind: "simple",
    icon: requireSimpleIcon("siMistralai", "Mistral")
  },
  openrouter: {
    kind: "simple",
    icon: requireSimpleIcon("siOpenrouter", "OpenRouter")
  },
  ollama: {
    kind: "simple",
    icon: requireSimpleIcon("siOllama", "Ollama")
  },
  xai: {
    kind: "image",
    src: "/assets/provider-logos/xai.svg"
  }
};

function requireSimpleIcon(key: string, title: string): SimpleIconData {
  const icon = simpleIconMap[key];

  if (!icon) {
    return {
      title,
      hex: "ffffff",
      path: "M0 0h24v24H0z"
    };
  }

  return icon;
}

export function ProviderLogo({
  provider,
  className
}: {
  provider: string;
  className?: string;
}) {
  const config = providerLogoConfig[provider.trim().toLowerCase()];

  if (!config) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[16px] border border-black/5 bg-white/95 text-slate-900 shadow-[0_1px_1px_rgba(0,0,0,0.04)]",
        className
      )}
      aria-hidden="true"
    >
      {config.kind === "image" ? (
        <Image
          src={config.src}
          alt=""
          width={18}
          height={18}
          className="h-[72%] w-[72%] select-none object-contain"
          unoptimized
        />
      ) : (
        <svg viewBox="0 0 24 24" className="h-[72%] w-[72%] select-none" fill={`#${config.icon.hex}`}>
          <path d={config.icon.path} />
        </svg>
      )}
    </div>
  );
}
