export type CelestialSky = {
  accent: string;
  auroraOpacity: number;
  bottom: string;
  daylight: number;
  horizon: string;
  label: string;
  middle: string;
  moonOpacity: number;
  moonX: number;
  moonY: number;
  starOpacity: number;
  sunOpacity: number;
  sunX: number;
  sunY: number;
  top: string;
};

type SkyStop = {
  accent: string;
  auroraOpacity: number;
  bottom: string;
  horizon: string;
  label: string;
  middle: string;
  minute: number;
  starOpacity: number;
  top: string;
};

const SKY_STOPS: readonly SkyStop[] = [
  { minute: 0, label: "Midnight", top: "#070d15", middle: "#101a25", bottom: "#1d2933", horizon: "#33404a", accent: "#aebcc6", starOpacity: 0.62, auroraOpacity: 0.05 },
  { minute: 240, label: "Before dawn", top: "#0e1722", middle: "#1d2832", bottom: "#343d43", horizon: "#6b6d6b", accent: "#b7aa97", starOpacity: 0.36, auroraOpacity: 0.045 },
  { minute: 330, label: "First light", top: "#45515a", middle: "#7e8587", bottom: "#b9aa98", horizon: "#d2c2ab", accent: "#c3a37b", starOpacity: 0.08, auroraOpacity: 0.035 },
  { minute: 420, label: "Sunrise", top: "#929da4", middle: "#c0c6c7", bottom: "#ddd5cb", horizon: "#eee8de", accent: "#d2b17f", starOpacity: 0, auroraOpacity: 0.025 },
  { minute: 570, label: "Morning", top: "#aeb9c0", middle: "#d0d4d3", bottom: "#e3ded7", horizon: "#eeeae3", accent: "#d4b98e", starOpacity: 0, auroraOpacity: 0.022 },
  { minute: 750, label: "Solar noon", top: "#a8b4bb", middle: "#d2d5d3", bottom: "#e2ded7", horizon: "#f0ece5", accent: "#d8bd91", starOpacity: 0, auroraOpacity: 0.018 },
  { minute: 990, label: "Late afternoon", top: "#8d9aa1", middle: "#bbc2c1", bottom: "#d9d0c5", horizon: "#e6d6c2", accent: "#c9aa7f", starOpacity: 0.02, auroraOpacity: 0.025 },
  { minute: 1110, label: "Golden hour", top: "#59656d", middle: "#7f8788", bottom: "#bca58b", horizon: "#d7b88e", accent: "#c39568", starOpacity: 0.08, auroraOpacity: 0.035 },
  { minute: 1200, label: "Sunset", top: "#293640", middle: "#4c565b", bottom: "#776f67", horizon: "#b29473", accent: "#b5855e", starOpacity: 0.22, auroraOpacity: 0.045 },
  { minute: 1290, label: "Blue hour", top: "#111c28", middle: "#202d38", bottom: "#35424a", horizon: "#566168", accent: "#9eabb4", starOpacity: 0.48, auroraOpacity: 0.05 },
  { minute: 1440, label: "Midnight", top: "#070d15", middle: "#101a25", bottom: "#1d2933", horizon: "#33404a", accent: "#aebcc6", starOpacity: 0.62, auroraOpacity: 0.05 }
] as const;

export function getCelestialSky(date: Date): CelestialSky {
  return getCelestialSkyAtMinute(date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60);
}

export function getCelestialSkyAtMinute(rawMinute: number): CelestialSky {
  const minute = ((rawMinute % 1440) + 1440) % 1440;
  const nextIndex = SKY_STOPS.findIndex((stop) => stop.minute >= minute);
  const end = SKY_STOPS[Math.max(1, nextIndex)];
  const start = SKY_STOPS[Math.max(0, nextIndex - 1)];
  const progress = smoothstep((minute - start.minute) / Math.max(1, end.minute - start.minute));
  const sunProgress = clamp((minute - 330) / (1200 - 330));
  const sunVisible = smoothWindow(minute, 315, 355, 1180, 1220);
  const daylight = smoothWindow(minute, 300, 420, 1110, 1230);
  const nightMinute = minute < 360 ? minute + 1440 : minute;
  const moonProgress = clamp((nightMinute - 1200) / (1800 - 1200));
  const moonVisible = Math.max(
    smoothWindow(nightMinute, 1170, 1230, 1740, 1800),
    smoothWindow(minute, -30, 30, 300, 360)
  );

  return {
    accent: mixHex(start.accent, end.accent, progress),
    auroraOpacity: mix(start.auroraOpacity, end.auroraOpacity, progress),
    bottom: mixHex(start.bottom, end.bottom, progress),
    daylight,
    horizon: mixHex(start.horizon, end.horizon, progress),
    label: progress < 0.5 ? start.label : end.label,
    middle: mixHex(start.middle, end.middle, progress),
    moonOpacity: moonVisible,
    moonX: 62 + moonProgress * 32,
    moonY: 77 - Math.sin(moonProgress * Math.PI) * 65,
    starOpacity: mix(start.starOpacity, end.starOpacity, progress),
    sunOpacity: sunVisible,
    sunX: 8 + sunProgress * 84,
    sunY: 78 - Math.sin(sunProgress * Math.PI) * 68,
    top: mixHex(start.top, end.top, progress)
  };
}

function smoothWindow(value: number, fadeInStart: number, fullStart: number, fullEnd: number, fadeOutEnd: number) {
  if (value <= fadeInStart || value >= fadeOutEnd) return 0;
  if (value < fullStart) return smoothstep((value - fadeInStart) / (fullStart - fadeInStart));
  if (value > fullEnd) return 1 - smoothstep((value - fullEnd) / (fadeOutEnd - fullEnd));
  return 1;
}

function smoothstep(value: number) {
  const normalized = clamp(value);
  return normalized * normalized * (3 - 2 * normalized);
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function mix(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function mixHex(start: string, end: string, progress: number) {
  const from = hexToRgb(start);
  const to = hexToRgb(end);
  const channels = from.map((value, index) => Math.round(mix(value, to[index], progress)));
  return `rgb(${channels.join(" ")})`;
}

function hexToRgb(value: string) {
  const normalized = value.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}
