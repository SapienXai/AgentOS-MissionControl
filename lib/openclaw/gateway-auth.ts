export type GatewayAuthSecretState = "missing" | "present" | "redacted" | "unknown";

export type GatewayNativeAuthIssueKind =
  | "auth"
  | "disabled"
  | "malformed-response"
  | "scope-limited"
  | "timeout"
  | "unreachable"
  | "unknown";

export type GatewayNativeAuthStatus = {
  mode: string | null;
  env: {
    token: boolean;
    password: boolean;
  };
  config: {
    authToken: GatewayAuthSecretState;
    authPassword: GatewayAuthSecretState;
    remoteToken: GatewayAuthSecretState;
    remotePassword: GatewayAuthSecretState;
  };
  native: {
    ok: boolean;
    checkedAt: string;
    kind: GatewayNativeAuthIssueKind | null;
    issue: string | null;
    disabledByEnv: boolean;
  };
  envFile: {
    path: string | null;
    token: boolean;
    password: boolean;
    gitignored: boolean;
  };
  recommendation: string;
};

export type GatewayNativeAuthCredentialKind = "token" | "password";

export type GatewayNativeDeviceAccessRepairResult = {
  approved: boolean;
  requestId: string | null;
  deviceId: string | null;
  scopes: string[];
  envSynced: boolean;
  activeEnvName: string | null;
  approvalIssue: string | null;
};
