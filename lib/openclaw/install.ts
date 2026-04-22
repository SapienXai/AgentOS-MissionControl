import "server-only";

import os from "node:os";
import path from "node:path";

export const OPENCLAW_INSTALL_DOCS_URL = "https://docs.openclaw.ai/install";

const OPENCLAW_INSTALL_CLI_URL = "https://openclaw.ai/install-cli.sh";
const OPENCLAW_INSTALL_POWERSHELL_URL = "https://openclaw.ai/install.ps1";

export function getOpenClawLocalPrefix() {
  return path.join(os.homedir(), ".openclaw");
}

export function getOpenClawLocalPrefixBinPath() {
  return path.join(getOpenClawLocalPrefix(), "bin", process.platform === "win32" ? "openclaw.cmd" : "openclaw");
}

export function getOpenClawBundledNodeBinPath() {
  return path.join(
    getOpenClawLocalPrefix(),
    "tools",
    "node",
    "bin",
    process.platform === "win32" ? "openclaw.cmd" : "openclaw"
  );
}

export function getOpenClawUserLocalBinPath() {
  return path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "openclaw.cmd" : "openclaw");
}

export function getOpenClawInstallCommand() {
  if (process.platform === "win32") {
    return `& ([scriptblock]::Create((iwr -useb ${OPENCLAW_INSTALL_POWERSHELL_URL}))) -NoOnboard`;
  }

  return `set -euo pipefail; curl -fsSL --proto '=https' --tlsv1.2 ${OPENCLAW_INSTALL_CLI_URL} | bash -s -- --prefix "$HOME/.openclaw" --no-onboard`;
}
