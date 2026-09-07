import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const AGENTOS_RUNTIME_DIR_ENV = "AGENTOS_RUNTIME_DIR";
export const AGENTOS_PACKAGE_RUNTIME_ENV = "AGENTOS_PACKAGE_RUNTIME";
export const AGENTOS_GATEWAY_AUTH_STATE_FILE = "openclaw-gateway-auth.json";

export type AgentOsGatewayAuthCredential = {
  kind: "token" | "password";
  value: string;
};

type AgentOsGatewayAuthStateFile = {
  version?: unknown;
  kind?: unknown;
  value?: unknown;
};

export function isAgentOsPackageRuntime(env: NodeJS.ProcessEnv = process.env) {
  return env[AGENTOS_PACKAGE_RUNTIME_ENV] === "1";
}

export function resolveAgentOsRuntimeDir(env: NodeJS.ProcessEnv = process.env) {
  const override = env[AGENTOS_RUNTIME_DIR_ENV]?.trim();
  return override ? expandHomePath(override) : join(homedir(), ".agentos");
}

export function resolveAgentOsGatewayAuthStatePath(env: NodeJS.ProcessEnv = process.env) {
  return join(resolveAgentOsRuntimeDir(env), AGENTOS_GATEWAY_AUTH_STATE_FILE);
}

export async function saveAgentOsGatewayAuthCredential(
  credential: AgentOsGatewayAuthCredential,
  env: NodeJS.ProcessEnv = process.env
) {
  const value = credential.value.trim();

  if (!value) {
    throw new Error("Gateway token/password is required.");
  }

  const authPath = resolveAgentOsGatewayAuthStatePath(env);
  await mkdir(dirname(authPath), { recursive: true });
  await writeFile(authPath, `${JSON.stringify({
    version: 1,
    kind: credential.kind,
    value,
    updatedAt: new Date().toISOString()
  }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(authPath, 0o600);

  return authPath;
}

export async function readAgentOsGatewayAuthCredential(
  env: NodeJS.ProcessEnv = process.env
): Promise<AgentOsGatewayAuthCredential | null> {
  try {
    return parseAgentOsGatewayAuthCredential(
      JSON.parse(await readFile(resolveAgentOsGatewayAuthStatePath(env), "utf8")) as AgentOsGatewayAuthStateFile
    );
  } catch {
    return null;
  }
}

/**
 * The Gateway client factory is intentionally synchronous, so packaged
 * startup needs a synchronous read of the credential persisted by setup.
 */
export function readAgentOsGatewayAuthCredentialSync(
  env: NodeJS.ProcessEnv = process.env
): AgentOsGatewayAuthCredential | null {
  try {
    return parseAgentOsGatewayAuthCredential(
      JSON.parse(readFileSync(resolveAgentOsGatewayAuthStatePath(env), "utf8")) as AgentOsGatewayAuthStateFile
    );
  } catch {
    return null;
  }
}

function parseAgentOsGatewayAuthCredential(
  payload: AgentOsGatewayAuthStateFile
): AgentOsGatewayAuthCredential | null {
  const kind = payload.kind === "token" || payload.kind === "password" ? payload.kind : null;
  const value = typeof payload.value === "string" && payload.value.trim() ? payload.value.trim() : null;

  return kind && value ? { kind, value } : null;
}

function expandHomePath(value: string) {
  return value.startsWith("~") ? join(homedir(), value.slice(1)) : value;
}
