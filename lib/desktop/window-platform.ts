export type TauriDesktopPlatform = "macos" | "windows" | "linux" | null;

export function resolveTauriDesktopPlatform(): TauriDesktopPlatform {
  if (
    typeof window === "undefined" ||
    !(window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  ) {
    return null;
  }

  const navigatorWithPlatform = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = (
    navigatorWithPlatform.userAgentData?.platform || navigator.platform || ""
  ).toLowerCase();

  if (platform.includes("mac")) return "macos";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux")) return "linux";
  return null;
}

export function syncTauriDesktopPlatformMarker() {
  if (typeof document === "undefined") {
    return;
  }

  const platform = resolveTauriDesktopPlatform();
  if (platform) {
    document.documentElement.dataset.agentosDesktopPlatform = platform;
  } else {
    delete document.documentElement.dataset.agentosDesktopPlatform;
  }
}
