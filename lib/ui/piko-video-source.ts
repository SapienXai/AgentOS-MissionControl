import { resolveTauriDesktopPlatform } from "@/lib/desktop/window-platform";

export type PikoVideoPlatform = "macos" | "chromium" | "other";

export type PikoVideoSource = {
  src: string;
  type: string;
};

export const PIKO_VIDEO_SOURCES: Record<Exclude<PikoVideoPlatform, "other">, PikoVideoSource> = {
  macos: {
    src: "/assets/pikoLoader.hevc.mov",
    type: "video/quicktime; codecs=\"hvc1\""
  },
  chromium: {
    src: "/assets/pikoLoader.webm",
    type: "video/webm; codecs=\"vp09.00.10.08\""
  }
};

export function resolvePikoVideoPlatform(input?: {
  platform?: string;
  userAgentDataPlatform?: string;
}): PikoVideoPlatform {
  const platform = (input?.userAgentDataPlatform || input?.platform || "").toLowerCase();

  if (platform.includes("mac")) {
    return "macos";
  }

  if (platform.includes("win") || platform.includes("linux") || platform.includes("chrome")) {
    return "chromium";
  }

  return "other";
}

export function resolvePikoVideoSource(
  platform: PikoVideoPlatform,
  canPlayType?: (mimeType: string) => string
) {
  if (platform === "other") {
    return null;
  }

  const source = PIKO_VIDEO_SOURCES[platform];
  // WKWebView can return an empty canPlayType result for HEVC alpha even when
  // the packaged MOV is playable. Let the media element make the final call
  // on macOS so its error event can activate the static fallback if needed.
  if (platform !== "macos" && canPlayType && !canPlayType(source.type)) {
    return null;
  }

  return source;
}

export function resolvePikoBrowserVideoPlatform(input?: {
  userAgent?: string;
  canPlayHevc?: boolean;
}): PikoVideoPlatform {
  const userAgent = input?.userAgent ?? "";
  const isAppleWebKitBrowser =
    /AppleWebKit/i.test(userAgent) &&
    !/(Chrome|Chromium|CriOS|Edg|OPR)/i.test(userAgent);

  if (isAppleWebKitBrowser) {
    return input?.canPlayHevc ? "macos" : "other";
  }

  return "chromium";
}

export function detectPikoVideoPlatform(): PikoVideoPlatform {
  if (typeof navigator === "undefined") {
    return "other";
  }

  const tauriPlatform = resolveTauriDesktopPlatform();
  if (tauriPlatform === "macos") {
    return "macos";
  }
  if (tauriPlatform) {
    return "chromium";
  }

  const video = document.createElement("video");
  return resolvePikoBrowserVideoPlatform({
    userAgent: navigator.userAgent,
    canPlayHevc: Boolean(video.canPlayType(PIKO_VIDEO_SOURCES.macos.type))
  });
}
