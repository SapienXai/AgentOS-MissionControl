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
  if (canPlayType && !canPlayType(source.type)) {
    return null;
  }

  return source;
}

export function detectPikoVideoPlatform(): PikoVideoPlatform {
  if (typeof navigator === "undefined") {
    return "other";
  }

  const navigatorWithPlatform = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = resolvePikoVideoPlatform({
    platform: navigator.platform,
    userAgentDataPlatform: navigatorWithPlatform.userAgentData?.platform
  });

  if (platform !== "other") {
    return platform;
  }

  const video = document.createElement("video");
  return video.canPlayType(PIKO_VIDEO_SOURCES.macos.type) ? "macos" : "other";
}
