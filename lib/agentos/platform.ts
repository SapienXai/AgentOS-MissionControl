/**
 * Platform-neutral product information shared by the web and desktop
 * surfaces. The implementation details of a native bridge stay outside this
 * module so React components do not need to inspect Tauri globals.
 */
export type AgentOSPlatform = "web" | "desktop";

export type PlatformCapabilities = {
  nativeFilesystem: boolean;
  localRuntimeControl: boolean;
  nativeNotifications: boolean;
  secureCredentialStore: boolean;
  terminal: boolean;
  systemTray: boolean;
  updater: boolean;
};

export const WEB_PLATFORM_CAPABILITIES: Readonly<PlatformCapabilities> = {
  nativeFilesystem: false,
  localRuntimeControl: false,
  nativeNotifications: false,
  secureCredentialStore: false,
  terminal: false,
  systemTray: false,
  updater: false
};

export const DESKTOP_PLATFORM_CAPABILITIES: Readonly<PlatformCapabilities> = {
  nativeFilesystem: true,
  localRuntimeControl: true,
  nativeNotifications: true,
  secureCredentialStore: true,
  terminal: true,
  systemTray: true,
  updater: true
};

export function getPlatformCapabilities(platform: AgentOSPlatform): Readonly<PlatformCapabilities> {
  return platform === "desktop" ? DESKTOP_PLATFORM_CAPABILITIES : WEB_PLATFORM_CAPABILITIES;
}
