import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export const DESKTOP_NODE_VERSION = process.env.AGENTOS_DESKTOP_NODE_VERSION?.trim() || "24.20.0";

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

export function nodeChecksumManifestUrl(version = DESKTOP_NODE_VERSION) {
  return `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;
}

export function parseSha256Manifest(manifestText, archiveName) {
  let sawArchiveName = false;

  for (const rawLine of String(manifestText).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (line.includes(archiveName)) sawArchiveName = true;
    if (!match || match[2] !== archiveName) continue;
    return match[1].toLowerCase();
  }

  if (sawArchiveName) {
    throw new Error(`Malformed SHA-256 checksum entry for ${archiveName}.`);
  }

  return null;
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function verifySha256File(filePath, expectedChecksum) {
  if (!/^[0-9a-f]{64}$/i.test(expectedChecksum)) {
    throw new Error("Expected a 64-character SHA-256 checksum.");
  }

  const actualChecksum = await sha256File(filePath);
  if (actualChecksum.toLowerCase() !== expectedChecksum.toLowerCase()) {
    throw new Error(`SHA-256 checksum mismatch for ${filePath}: expected ${expectedChecksum}, got ${actualChecksum}.`);
  }

  return actualChecksum;
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
