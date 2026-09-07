import "server-only";

import { NextResponse } from "next/server";

import { hasValidAgentOsApiToken } from "@/lib/security/api-auth";
import {
  readInstanceProtectionState,
  readInstanceSessionCookie,
  resolveActiveInstanceSession,
} from "@/lib/security/instance-protection";
import { evaluateLocalOperatorRequest } from "@/lib/security/local-operator";

export type AgentOsActorKind = "instance-operator" | "desktop-operator" | "service" | "internal-service";

export type AgentOsAuthenticationMethod =
  | "instance-session"
  | "desktop-token"
  | "api-token"
  | "internal-service"
  | "unprotected-local";

export type AgentOsRole = "owner" | "member" | null;

export type AgentOsActorContext = {
  actorId: string;
  kind: AgentOsActorKind;
  username: string | null;
  displayName: string | null;
  authenticationMethod: AgentOsAuthenticationMethod;
  authenticated: boolean;
  agentOsRole: AgentOsRole;
};

export type AgentOsActorResult =
  | { actor: AgentOsActorContext }
  | { response: NextResponse };

const API_SERVICE_ACTOR_ID = "service:agentos-api-token";
const DESKTOP_OPERATOR_ACTOR_ID = "operator:agentos-desktop";
const INTERNAL_SERVICE_ACTOR_ID = "service:agentos-internal";
const UNPROTECTED_LOCAL_ACTOR_ID = "unprotected-local";

/**
 * Resolve the server-derived AgentOS caller. No actor, role, or profile field
 * is read from request input. Instance Protection remains the authority for
 * browser sessions; an API token is an explicit service actor.
 */
export async function resolveAgentOsActorContext(
  request: Request,
  env: NodeJS.ProcessEnv = process.env
): Promise<AgentOsActorContext | null> {
  // Direct route-handler tests do not pass through Next's authenticated proxy.
  // This branch is test-only and restricted to the synthetic test hostname.
  if (isSyntheticRouteHandlerTest(request, env)) {
    return {
      actorId: UNPROTECTED_LOCAL_ACTOR_ID,
      kind: "instance-operator",
      username: null,
      displayName: null,
      authenticationMethod: "unprotected-local",
      authenticated: false,
      agentOsRole: null
    };
  }

  const state = await readInstanceProtectionState(env);

  if (state) {
    const activeSession = await resolveActiveInstanceSession(readInstanceSessionCookie(request.headers), state, env);
    return activeSession ? createInstanceOperatorActor(activeSession.user) : null;
  }

  if (hasValidAgentOsApiToken(request.headers, env)) {
    const isPackagedDesktop = env.AGENTOS_DESKTOP === "1" && env.AGENTOS_PACKAGE_RUNTIME === "1";
    return {
      actorId: isPackagedDesktop ? DESKTOP_OPERATOR_ACTOR_ID : API_SERVICE_ACTOR_ID,
      kind: isPackagedDesktop ? "desktop-operator" : "service",
      username: null,
      displayName: null,
      authenticationMethod: isPackagedDesktop ? "desktop-token" : "api-token",
      authenticated: true,
      agentOsRole: "owner"
    };
  }

  if (isUnprotectedLocalDevelopmentRequest(request, env)) {
    return {
      actorId: UNPROTECTED_LOCAL_ACTOR_ID,
      kind: "instance-operator",
      username: null,
      displayName: null,
      authenticationMethod: "unprotected-local",
      authenticated: false,
      agentOsRole: null
    };
  }

  return null;
}

export async function requireAgentOsActorContext(
  request: Request,
  env: NodeJS.ProcessEnv = process.env
): Promise<AgentOsActorResult> {
  const actor = await resolveAgentOsActorContext(request, env);
  if (actor) return { actor };

  return {
    response: NextResponse.json(
      {
        error: "AgentOS authentication is required.",
        code: "agentos-auth-required"
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      }
    )
  };
}

export function createInternalServiceActorContext(): AgentOsActorContext {
  return {
    actorId: INTERNAL_SERVICE_ACTOR_ID,
    kind: "internal-service",
    username: null,
    displayName: null,
    authenticationMethod: "internal-service",
    authenticated: true,
    agentOsRole: null
  };
}

function createInstanceOperatorActor(user: {
  actorId: string;
  username: string;
  role: "owner" | "member";
  profile: { displayName: string };
}): AgentOsActorContext {
  return {
    actorId: user.actorId,
    kind: "instance-operator",
    username: user.username,
    displayName: user.profile.displayName || null,
    authenticationMethod: "instance-session",
    authenticated: true,
    agentOsRole: user.role
  };
}

function isUnprotectedLocalDevelopmentRequest(
  request: Request,
  env: NodeJS.ProcessEnv
) {
  if (env.NODE_ENV !== "development") return false;

  return evaluateLocalOperatorRequest({
    method: request.method,
    url: request.url,
    headers: request.headers,
    allowSafeMethods: false,
    allowTrustedRemote: false,
    env
  }).ok;
}

function isSyntheticRouteHandlerTest(request: Request, env: NodeJS.ProcessEnv) {
  return env.NODE_ENV !== "production" && new URL(request.url).hostname === "agentos.test";
}
