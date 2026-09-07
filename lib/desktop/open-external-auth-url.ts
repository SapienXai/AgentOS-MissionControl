import { validateOpenAiAuthorizationUrl } from "@/lib/openclaw/chatgpt-auth-url";

export type ExternalAuthOpenMethod = "tauri" | "browser";

const duplicateOpenWindowMs = 10_000;
const inFlightOpenAttempts = new Map<string, Promise<ExternalAuthOpenMethod>>();
const recentlyOpenedUrls = new Map<string, { method: ExternalAuthOpenMethod; openedAt: number }>();

export function isTauriDesktopRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}
/**
 * Open the OpenClaw-produced OpenAI authorization URL using the packaged
 * shell's native opener, with a normal-browser fallback for the web app.
 */
export async function openExternalAuthUrl(value: string): Promise<ExternalAuthOpenMethod> {
  const url = validateOpenAiAuthorizationUrl(value);

  if (!url) {
    throw new Error("OpenClaw returned an invalid OpenAI authorization URL.");
  }

  const now = Date.now();
  for (const [recentUrl, recentEntry] of recentlyOpenedUrls) {
    if (now - recentEntry.openedAt >= duplicateOpenWindowMs) {
      recentlyOpenedUrls.delete(recentUrl);
    }
  }

  const recent = recentlyOpenedUrls.get(url);
  if (recent) {
    return recent.method;
  }

  const inFlight = inFlightOpenAttempts.get(url);
  if (inFlight) {
    return inFlight;
  }

  const attempt = openValidatedAuthUrl(url).then((method) => {
    recentlyOpenedUrls.set(url, { method, openedAt: Date.now() });
    return method;
  }).finally(() => {
    inFlightOpenAttempts.delete(url);
  });

  inFlightOpenAttempts.set(url, attempt);
  return attempt;
}

async function openValidatedAuthUrl(url: string): Promise<ExternalAuthOpenMethod> {

  if (isTauriDesktopRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external_auth_url", { url });
    return "tauri";
  }

  const openedWindow = window.open(url, "_blank", "noopener,noreferrer");
  if (!openedWindow) {
    throw new Error("The browser blocked automatic sign-in opening. Use Open sign-in to continue.");
  }

  return "browser";
}
