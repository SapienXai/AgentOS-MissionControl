"use client";

import { ExternalLink, FolderOpenDot } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { compactPath } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type InteractiveContentProps = {
  text: string;
  className?: string;
  url?: string | null;
  filePath?: string | null;
  displayPath?: string | null;
  compact?: boolean;
};

type FileReference = {
  path: string;
  label: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const KNOWN_RELATIVE_PATH_PATTERN =
  /(?:^|[\s(])((?:\.{1,2}\/)?(?:deliverables|memory|docs|app|components|lib|public|scripts|packages|hooks|output)\/[^\s`),;]+)/g;
const BACKTICK_PATH_PATTERN =
  /`((?:\/|\.{1,2}\/|deliverables\/|memory\/|docs\/|app\/|components\/|lib\/|public\/|scripts\/|packages\/|hooks\/|output\/)[^`\n]+)`/g;

export function InteractiveContent({
  text,
  className,
  url,
  filePath,
  displayPath,
  compact = false
}: InteractiveContentProps) {
  const urls = collectUrls(text, url);
  const emails = collectEmails(text);
  const fileReferences = collectFileReferences(text, filePath, displayPath);

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      <p className={cn("whitespace-pre-wrap break-words", className)}>{renderTextWithLinks(text)}</p>
      {urls.length > 0 || emails.length > 0 || fileReferences.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {urls.map((href) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border border-cyan-300/16 bg-cyan-400/[0.08] px-2 py-1 text-[10px] text-cyan-100 transition-colors hover:border-cyan-200/30 hover:bg-cyan-400/[0.14]",
                compact && "px-1.5 py-[3px] text-[9px]"
              )}
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink className={cn("h-3 w-3 shrink-0", compact && "h-2.5 w-2.5")} />
              <span className="truncate">{summarizeUrl(href)}</span>
            </a>
          ))}
          {emails.map((email) => (
            <a
              key={email}
              href={`mailto:${email}`}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border border-sky-300/16 bg-sky-400/[0.08] px-2 py-1 text-[10px] text-sky-50 transition-colors hover:border-sky-200/30 hover:bg-sky-400/[0.14]",
                compact && "px-1.5 py-[3px] text-[9px]"
              )}
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink className={cn("h-3 w-3 shrink-0", compact && "h-2.5 w-2.5")} />
              <span className="truncate">{email}</span>
            </a>
          ))}
          {fileReferences.map((reference) => (
            <button
              key={`${reference.path}:${reference.label}`}
              type="button"
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-300/16 bg-emerald-400/[0.08] px-2 py-1 text-[10px] text-emerald-50 transition-colors hover:border-emerald-200/30 hover:bg-emerald-400/[0.14]",
                compact && "px-1.5 py-[3px] text-[9px]"
              )}
              onClick={(event) => {
                event.stopPropagation();
                void revealLocalFile(reference.path);
              }}
            >
              <FolderOpenDot className={cn("h-3 w-3 shrink-0", compact && "h-2.5 w-2.5")} />
              <span className="truncate">{compactPath(reference.label)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderTextWithLinks(text: string) {
  const matches = Array.from(text.matchAll(URL_PATTERN));

  if (matches.length === 0) {
    return text;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const [match] of matches) {
    const index = text.indexOf(match, cursor);

    if (index > cursor) {
      parts.push(text.slice(cursor, index));
    }

    parts.push(
      <a
        key={`${match}:${index}`}
        href={match}
        target="_blank"
        rel="noreferrer"
        className="text-cyan-100 underline decoration-cyan-200/45 underline-offset-2 transition-colors hover:text-cyan-50 hover:decoration-cyan-100"
        onClick={(event) => event.stopPropagation()}
      >
        {match}
      </a>
    );
    cursor = index + match.length;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
}

function collectUrls(text: string, explicitUrl?: string | null) {
  const found = new Set<string>();

  if (explicitUrl) {
    found.add(explicitUrl);
  }

  for (const match of text.matchAll(URL_PATTERN)) {
    if (match[0]) {
      found.add(match[0]);
    }
  }

  return [...found];
}

function collectEmails(text: string) {
  const found = new Set<string>();

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    if (match[0]) {
      found.add(match[0]);
    }
  }

  return [...found];
}

function collectFileReferences(text: string, explicitPath?: string | null, explicitLabel?: string | null) {
  const found = new Map<string, FileReference>();

  if (explicitPath) {
    found.set(explicitPath, {
      path: explicitPath,
      label: explicitLabel || explicitPath
    });
  }

  for (const match of text.matchAll(BACKTICK_PATH_PATTERN)) {
    const value = match[1]?.trim();

    if (!value || found.has(value)) {
      continue;
    }

    found.set(value, {
      path: value,
      label: value
    });
  }

  for (const match of text.matchAll(KNOWN_RELATIVE_PATH_PATTERN)) {
    const value = match[1]?.trim();

    if (!value || found.has(value)) {
      continue;
    }

    found.set(value, {
      path: value,
      label: value
    });
  }

  return [...found.values()];
}

function summarizeUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return value;
  }
}

async function revealLocalFile(targetPath: string) {
  try {
    const response = await fetch("/api/files/reveal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: targetPath })
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      throw new Error(payload.error || "Unable to reveal file.");
    }

    toast.success("Revealed file.", {
      description: compactPath(targetPath)
    });
  } catch (error) {
    toast.error("Could not reveal file.", {
      description: error instanceof Error ? error.message : "Unknown file reveal error."
    });
  }
}
