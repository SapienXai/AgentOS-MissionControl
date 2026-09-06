import type { OpenClawReleaseNotesEvidence } from "@/lib/openclaw/upstream/types";

const MAX_RELEASE_NOTE_CHARS = 8_000;
const RELEASE_NOTE_SIGNAL_RULES: Array<[string, RegExp]> = [
  ["security", /\bsecurity\b|vulnerability|hardening|isolation|permission|scope|authenticat|authoriz/i],
  ["sessions", /session|transcript|conversation|visibility|agent-to-agent/i],
  ["updates", /update|upgrade|release|rollback|restart|reconnect|campaign/i],
  ["migration", /migration|migrate|config default|breaking|deprecated|removed/i],
  ["models", /model|provider|oauth|credential/i],
  ["gateway-lifecycle", /gateway|supervisor|launchd|systemd|service lifecycle/i]
];

export function buildOpenClawReleaseNotesEvidence(input: {
  body: string | null | undefined;
  sourceUrl: string | null;
}): OpenClawReleaseNotesEvidence {
  const excerpt = sanitizeReleaseNotes(input.body ?? "");
  return {
    sourceUrl: input.sourceUrl,
    excerpt,
    signals: RELEASE_NOTE_SIGNAL_RULES
      .filter(([, pattern]) => pattern.test(excerpt))
      .map(([signal]) => signal)
  };
}

export function sanitizeReleaseNotes(value: string) {
  const sanitized = value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/```/g, "'''")
    .replace(/<script\b/gi, "&lt;script")
    .replace(/<\/script>/gi, "&lt;/script&gt;")
    .replace(/\$\(/g, "$ (")
    .replace(/::(set-output|save-state|group|endgroup)\b/gi, "[workflow directive removed]")
    .trim();

  if (sanitized.length <= MAX_RELEASE_NOTE_CHARS) {
    return sanitized;
  }

  return `${sanitized.slice(0, MAX_RELEASE_NOTE_CHARS)}\n\n[Release notes excerpt truncated by AgentOS.]`;
}

export function sanitizeIssueText(value: string) {
  return sanitizeReleaseNotes(value)
    .replace(/\$\(/g, "$ (")
    .replace(/::(set-output|save-state|group|endgroup)\b/gi, "[workflow directive removed]");
}
