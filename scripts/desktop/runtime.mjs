export const DESKTOP_NODE_VERSION = process.env.AGENTOS_DESKTOP_NODE_VERSION?.trim() || "24.15.0";

export function resolveTargetPlatform(value = process.env.AGENTOS_DESKTOP_TARGET_PLATFORM || process.platform) {
  if (value === "darwin" || value === "linux" || value === "win32") return value;
  throw new Error(`Unsupported desktop target platform: ${value}`);
}

export function resolveTargetArch(value = process.env.AGENTOS_DESKTOP_TARGET_ARCH || process.arch) {
  if (value === "x64" || value === "arm64") return value;
  throw new Error(`Unsupported desktop target architecture: ${value}`);
}

export function nodeExecutableName(platform = process.platform) {
  return platform === "win32" ? "node.exe" : "node";
}

export function nodeArchiveName({ platform, arch, version = DESKTOP_NODE_VERSION }) {
  const platformName = platform === "win32" ? "win" : platform;
  const extension = platform === "win32" ? "zip" : "tar.gz";
  return `node-v${version}-${platformName}-${arch}.${extension}`;
}

export function nodeArchiveUrl({ platform, arch, version = DESKTOP_NODE_VERSION }) {
  return `https://nodejs.org/dist/v${version}/${nodeArchiveName({ platform, arch, version })}`;
}

export function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

export function isAllowedNavigation(rawUrl, allowedPort) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol === "tauri:" && url.hostname === "localhost") return true;
  if (url.protocol !== "http:" || !isLoopbackHost(url.hostname)) return false;

  const port = Number(url.port || "80");
  return Number.isInteger(allowedPort) && port === allowedPort;
}

export function sanitizeDiagnostics(value, maxLength = 1_200) {
  return String(value || "")
    .replace(/(?:authorization|cookie|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s]+/gi, (match) => match.replace(/([?&](?:token|key|secret|password)=)[^&#\s]+/gi, "$1[redacted]"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-12)
    .join("\n")
    .slice(-maxLength);
}
