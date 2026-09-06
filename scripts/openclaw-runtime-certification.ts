import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { getOpenClawServerMethodContractDiff } from "@/lib/openclaw/application/update-contract-diff-service";
import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import {
  DEFAULT_NATIVE_TIMEOUT_MS,
  type GatewayEventFrame
} from "@/lib/openclaw/client/native-ws-gateway-types";
import { normalizeGatewayTurnEvent } from "@/lib/openclaw/client/native-ws-gateway-mappers";
import { normalizeClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import { redactGatewayUrl } from "@/lib/openclaw/compat/targets";
import { bridgeOpenClawStaticRuntimeEvidence } from "@/lib/openclaw/runtime-certification/evidence-bridge";
import { runOpenClawRuntimeCertification } from "@/lib/openclaw/runtime-certification/harness";
import { evaluateOpenClawRuntimeMigrationReadiness } from "@/lib/openclaw/runtime-certification/readiness-gate";
import { serializeOpenClawRuntimeCertificationArtifact } from "@/lib/openclaw/runtime-certification/serialization";
import { createOpenClawRuntimeProviderFixture, OPENCLAW_RUNTIME_FIXTURE_MODEL_ID } from "@/scripts/openclaw-runtime-provider-fixture";
import { OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT } from "@/lib/openclaw/identity/contract";
import { OPENCLAW_NATIVE_CONTRACT_VERSION } from "@/lib/openclaw/versions";
import type {
  OpenClawRuntimeCertificationContext,
  OpenClawRuntimeCertificationProbe,
  OpenClawRuntimeCertificationReport,
  OpenClawRuntimeEvidenceDimension,
  OpenClawRuntimeRequirementLevel
} from "@/lib/openclaw/runtime-certification/types";

type OfficialBackedGatewayClient = ReturnType<typeof createOfficialBackedOpenClawGatewayClient>;

const TARGET_VERSION = process.env.OPENCLAW_RUNTIME_CERT_TARGET?.trim() || OPENCLAW_NATIVE_CONTRACT_VERSION;
const TARGET_COMMIT = process.env.OPENCLAW_RUNTIME_CERT_TARGET_COMMIT?.trim() || OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT;
const STATIC_COMPARISON_SOURCE_VERSION = process.env.OPENCLAW_RUNTIME_CERT_STATIC_CURRENT_VERSION?.trim() || "2026.6.11";
const GATEWAY_URL = process.env.OPENCLAW_RUNTIME_CERT_GATEWAY_URL?.trim() || "ws://127.0.0.1:18789";
const TOKEN =
  process.env.OPENCLAW_RUNTIME_CERT_TOKEN?.trim() ||
  process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN?.trim() ||
  null;
const OUTPUT_PATH = process.env.OPENCLAW_RUNTIME_CERT_OUTPUT?.trim() ||
  path.resolve(`docs/evidence/openclaw-${TARGET_VERSION}-runtime-certification.json`);
const STATE_DIR = process.env.OPENCLAW_RUNTIME_CERT_STATE_DIR?.trim() || null;
const OPENCLAW_CLI = process.env.OPENCLAW_RUNTIME_CERT_CLI?.trim() || null;
const USE_FIXTURE = process.env.OPENCLAW_RUNTIME_CERT_USE_FIXTURE !== "0";
const QUIET = process.env.OPENCLAW_RUNTIME_CERT_QUIET === "1";
const FULL_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.questions",
  "operator.pairing",
  "operator.talk",
  "operator.talk.secrets"
];

const CORE_CONTROL_DIMENSIONS: OpenClawRuntimeEvidenceDimension[] = [
  "availability",
  "authorization",
  "positiveExecution",
  "responseShape"
];
const CORE_LIFECYCLE_DIMENSIONS: OpenClawRuntimeEvidenceDimension[] = [
  ...CORE_CONTROL_DIMENSIONS,
  "lifecycle"
];
const OPTIONAL_DIMENSIONS: OpenClawRuntimeEvidenceDimension[] = [
  "availability",
  "positiveExecution",
  "responseShape"
];

type RuntimeResources = {
  sessionKey: string;
  sessionId: string | null;
  sessionCleaned: boolean;
  agentId: string | null;
  agentCleaned: boolean;
  questionId: string | null;
  questionCleaned: boolean;
  cronId: string | null;
  cronCleaned: boolean;
  workspacePath: string;
};

async function main() {
  if (!TOKEN) {
    console.error("OpenClaw runtime certification requires OPENCLAW_RUNTIME_CERT_TOKEN or AGENTOS_OPENCLAW_GATEWAY_TOKEN.");
    return 1;
  }

  const fixture = USE_FIXTURE ? await createOpenClawRuntimeProviderFixture({ modelId: OPENCLAW_RUNTIME_FIXTURE_MODEL_ID }) : null;
  const fullClient = createClient(FULL_SCOPES);
  const readClient = createClient(["operator.read"]);
  const workspaceBase = process.env.OPENCLAW_RUNTIME_CERT_WORKSPACE?.trim() || STATE_DIR || "/tmp";
  const resources: RuntimeResources = {
    sessionKey: `agent:dev:agentos-runtime-cert-${Date.now()}`,
    sessionId: null,
    sessionCleaned: false,
    agentId: null,
    agentCleaned: false,
    questionId: null,
    questionCleaned: false,
    cronId: null,
    cronCleaned: false,
    workspacePath: path.join(workspaceBase, `agentos-runtime-cert-workspace-${Date.now()}`)
  };
  let report: OpenClawRuntimeCertificationReport | null = null;
  let staticReport: Awaited<ReturnType<typeof getOpenClawServerMethodContractDiff>> | null = null;
  let evidenceBridge: ReturnType<typeof bridgeOpenClawStaticRuntimeEvidence> | null = null;
  let failure: string | null = null;

  try {
    const handshake = await fullClient.probeNativeHandshake({ timeoutMs: DEFAULT_NATIVE_TIMEOUT_MS });
    const readHandshake = await readClient.probeNativeHandshake({ timeoutMs: DEFAULT_NATIVE_TIMEOUT_MS });
    if (fixture) await configureFixtureProvider(fullClient, fixture);
    const contextClients = {
      full: {
        client: fullClient,
        handshake,
        probeHandshake: () => fullClient.probeNativeHandshake({ timeoutMs: 2_000 })
      },
      read: {
        client: readClient,
        handshake: readHandshake,
        probeHandshake: () => readClient.probeNativeHandshake({ timeoutMs: 2_000 })
      }
    };
    const probes = createProbes({
      resources,
      cronName: `agentos-runtime-cert-${Date.now()}`,
      questionRequestId: `runtime_cert_question_${Date.now()}`,
      fixture
    });

    report = await runOpenClawRuntimeCertification({
      targetVersion: TARGET_VERSION,
      gatewayUrl: redactGatewayUrl(GATEWAY_URL) ?? "[redacted]",
      handshake,
      clients: contextClients,
      defaultClientId: "full",
      probes,
      metadata: {
        provider: fixture
          ? {
              kind: "loopback-fixture",
              modelRef: `agentos-fixture/${fixture.modelId}`,
              externalCredentialRequired: false,
              externalCredentialUsed: false
            }
          : {
              kind: "none",
              modelRef: null,
              externalCredentialRequired: true,
              externalCredentialUsed: false
            }
      }
    });

    staticReport = await getOpenClawServerMethodContractDiff({
      // The static source is intentionally explicit historical evidence. The
      // active AgentOS baseline may equal the runtime target and must not be
      // self-compared as a fake upgrade.
      currentVersion: STATIC_COMPARISON_SOURCE_VERSION,
      targetVersion: TARGET_VERSION
    });
    evidenceBridge = bridgeOpenClawStaticRuntimeEvidence({
      staticReport,
      runtimeReport: report
    });
    report.persistence = await collectPersistenceEvidence();
    report.migrationReadiness = evaluateOpenClawRuntimeMigrationReadiness({
      runtimeReport: report,
      staticTargetVersion: staticReport.targetVersion
    });
  } catch (error) {
    failure = normalizeClientError(error).message;
  } finally {
    const cleanup = await cleanupResources(fullClient, resources);
    if (fixture) {
      try {
        await fixture.close();
        cleanup.resources.push({ kind: "provider", status: "cleaned" });
      } catch {
        cleanup.resources.push({ kind: "provider", status: "failed" });
        cleanup.status = "partial";
      }
    } else {
      cleanup.resources.push({ kind: "provider", status: "not-created" });
    }

    fullClient.close("runtime certification complete");
    readClient.close("runtime certification complete");

    if (report && staticReport && evidenceBridge) {
      report.cleanup = cleanup;
      const output = {
        runtime: report,
        staticContract: {
          source: staticReport.source,
          targetCommit: TARGET_COMMIT,
          currentVersion: staticReport.currentVersion,
          targetVersion: staticReport.targetVersion,
          status: staticReport.status,
          targetMethodCount: staticReport.targetMethodCount,
          changedServerMethodFiles: staticReport.changedServerMethodFiles,
          changedProtocolFiles: staticReport.changedProtocolFiles,
          changes: staticReport.changes,
          blockerCount: staticReport.blockerCount,
          warningCount: staticReport.warningCount,
          unknownCount: staticReport.unknownCount,
          error: staticReport.error
        },
        evidenceBridge
      };
      await writeReport(output);
    }
  }

  if (failure) {
    console.error(`OpenClaw runtime certification could not complete: ${failure}`);
    return 1;
  }
  if (!report || !evidenceBridge) return 1;

  printSummary(report, evidenceBridge.summary);
  return report.migrationReadiness?.readyForMigrationEngine ? 0 : 1;
}

function createClient(scopes: string[]) {
  return createOfficialBackedOpenClawGatewayClient({
    url: GATEWAY_URL,
    token: TOKEN,
    scopes,
    timeoutMs: DEFAULT_NATIVE_TIMEOUT_MS,
    clientName: "gateway-client",
    clientVersion: "0.1.0-runtime-certification",
    ...(STATE_DIR ? { stateDir: STATE_DIR } : {}),
    sharedStateMode: "read-only"
  });
}

function createProbes(input: {
  resources: RuntimeResources;
  questionRequestId: string;
  cronName: string;
  fixture: Awaited<ReturnType<typeof createOpenClawRuntimeProviderFixture>> | null;
}): OpenClawRuntimeCertificationProbe[] {
  const uniqueSessionLabel = `AgentOS runtime certification ${Date.now()}`;
  const sessionData = (context: OpenClawRuntimeCertificationContext) => ({
    key: input.resources.sessionKey,
    archived: true,
    ...(typeof context.data.sessionId === "string" ? { expectedSessionId: context.data.sessionId } : {})
  });

  return [
    probe("gateway-health", "gateway.health", "Gateway handshake", "health", "required", ["availability", "positiveExecution", "responseShape"], "AgentOS requires a reachable authenticated Gateway.", {
      params: {},
      validateResponse: objectWith("ok")
    }),
    probe("gateway-status", "gateway.health", "Gateway status", "status", "required", OPTIONAL_DIMENSIONS, "AgentOS reads the native Gateway status snapshot during startup reconciliation.", {
      clientId: "read",
      params: {},
      validateResponse: objectWith()
    }),
    probe("tasks-list", "taskEvents", "Task ledger", "tasks.list", "required", OPTIONAL_DIMENSIONS, "AgentOS reads the native task ledger before projecting task state.", {
      clientId: "read",
      params: {},
      validateResponse: objectWith("tasks")
    }),
    probe("channels-status", "channels", "Channel status", "channels.status", "required", OPTIONAL_DIMENSIONS, "AgentOS reads configured channel status without probing or mutating external providers.", {
      clientId: "read",
      params: { probe: false },
      validateResponse: objectWith()
    }),
    probe("skills-status", "skills", "Skill status", "skills.status", "required", OPTIONAL_DIMENSIONS, "AgentOS reads the effective skill status for the disposable dev agent.", {
      clientId: "read",
      params: { agentId: "dev" },
      validateResponse: objectWith()
    }),
    probe("tools-catalog", "tools", "Tool catalog", "tools.catalog", "required", OPTIONAL_DIMENSIONS, "AgentOS reads the native tool catalog without invoking a tool.", {
      clientId: "read",
      params: { agentId: "dev" },
      validateResponse: objectWith()
    }),
    probe("users-list", "userDirectory", "Gateway user directory", "users.list", "required", OPTIONAL_DIMENSIONS, "AgentOS reads the Gateway user directory with the minimum operator.read scope.", {
      clientId: "read",
      params: {},
      validateResponse: objectWith("profiles")
    }),
    probe("sessions-list", "sessions.list", "Sessions", "sessions.list", "required", OPTIONAL_DIMENSIONS, "AgentOS reads the Gateway session catalog.", {
      validateResponse: objectWith("sessions")
    }),
    probe("sessions-create", "sessions.create", "Session lifecycle", "sessions.create", "required", CORE_LIFECYCLE_DIMENSIONS, "AgentOS creates durable sessions before work begins.", {
      params: {
        key: input.resources.sessionKey,
        agentId: "dev",
        label: uniqueSessionLabel
      },
      validateResponse: objectWith("ok", "key", "sessionId"),
      captureResponse: (payload, context) => {
        const record = asRecord(payload);
        const sessionId = readString(record?.sessionId) ?? readString(asRecord(record?.entry)?.sessionId);
        if (sessionId) {
          input.resources.sessionId = sessionId;
          context.data.sessionId = sessionId;
        }
      },
      contributesTo: ["positiveExecution", "responseShape", "lifecycle"]
    }),
    probe("sessions-create-read-denial", "sessions.create", "Read-only session creation denial", "sessions.create", "required", CORE_LIFECYCLE_DIMENSIONS, "A read-only caller must not create sessions.", {
      clientId: "read",
      params: { key: `${input.resources.sessionKey}-read-denied`, agentId: "dev" },
      expectedOutcome: "authorization-denied"
    }),
    probe("sessions-describe", "sessions.describe", "Session details", "sessions.describe", "required", OPTIONAL_DIMENSIONS, "AgentOS reads durable session identity and lifecycle metadata.", {
      params: { key: input.resources.sessionKey },
      validateResponse: objectWith("session"),
      captureResponse: (payload, context) => {
        const session = asRecord(asRecord(payload)?.session);
        if (typeof session?.lifecycleRevision === "number") context.data.lifecycleRevision = session.lifecycleRevision;
        const sessionId = readString(session?.sessionId);
        if (sessionId) {
          input.resources.sessionId = sessionId;
          context.data.sessionId = sessionId;
        }
      }
    }),
    probe("tools-effective", "tools", "Effective tools", "tools.effective", "required", OPTIONAL_DIMENSIONS, "AgentOS reads session-scoped effective tools without invoking or changing them.", {
      clientId: "read",
      params: { agentId: "dev", sessionKey: input.resources.sessionKey },
      validateResponse: objectWith()
    }),
    probe("session-collaboration-members-read", "session.collaboration", "Session collaboration membership", "session.members.listEvidence", "optional", OPTIONAL_DIMENSIONS, "OpenClaw session collaboration is read safely for capability discovery without changing visibility, membership, or ownership.", {
      params: { sessionKey: input.resources.sessionKey, agentId: "dev" },
      validateResponse: objectWith("sessionKey", "members", "identities", "role", "allowedVisibilities")
    }),
    probe("worktrees-list-discovery", "worktrees", "Managed worktree inventory", "worktrees.list", "optional", OPTIONAL_DIMENSIONS, "OpenClaw managed worktrees are read safely for capability discovery; no worktree is created, removed, restored, or garbage-collected.", {
      params: {},
      validateResponse: objectWith("worktrees")
    }),
    probe("task-suggestions-list-discovery", "taskSuggestions", "Task suggestion inventory", "taskSuggestions.list", "optional", OPTIONAL_DIMENSIONS, "OpenClaw task suggestions are read safely for capability discovery; no suggestion is created, accepted, or dismissed.", {
      params: {},
      validateResponse: objectWith("suggestions")
    }),
    probe("skills-library-list-discovery", "skillsLibrary", "Skills library inventory", "skills.library.list", "optional", OPTIONAL_DIMENSIONS, "OpenClaw skills library entries are read safely for capability discovery; no skill, revision, selection, or activation is changed.", {
      params: {},
      validateResponse: objectWith("entries")
    }),
    probe("sessions-preview", "sessions.preview", "Session preview", "sessions.preview", "optional", OPTIONAL_DIMENSIONS, "The session preview is a lower-level optional roster projection.", {
      params: { keys: [input.resources.sessionKey] },
      validateResponse: objectWith("previews")
    }),
    probe("chat-history-before", "chat.history", "Chat history", "chat.history", "required", OPTIONAL_DIMENSIONS, "AgentOS reads history to reconcile completed work.", {
      params: { sessionKey: input.resources.sessionKey, limit: 20 },
      validateResponse: objectWith("messages", "sessionKey")
    }),
    probe("chat-send-read-denial", "chat.send", "Read-only chat send denial", "chat.send", "required", CORE_CONTROL_DIMENSIONS, "A read-only caller must not start model-backed work.", {
      clientId: "read",
      params: {
        sessionKey: input.resources.sessionKey,
        message: "AGENTOS_SYNTHETIC_AUTHORIZATION_PROBE",
        idempotencyKey: "runtime_cert_chat_read_denial"
      },
      expectedOutcome: "authorization-denied"
    }),
    probe("chat-send-model-turn", "chat.send", "Model-backed chat send", "chat.send", "required", CORE_CONTROL_DIMENSIONS, "Migration requires a positive model-backed Gateway turn.", {
      params: {},
      execute: async (context) => {
        if (!input.fixture) throw new Error("No loopback model fixture is configured.");
        const evidence = await runStreamingTurn({
          client: context.clients.full.client,
          sessionKey: input.resources.sessionKey,
          message: "AGENTOS_SYNTHETIC_FIRST_PROMPT",
          idempotencyKey: "runtime_cert_first_turn"
        });
        const history = await readHistoryUntil(context.clients.full.client, input.resources.sessionKey, 1);
        const assistantMessages = readAssistantMessages(history);
        const positiveResponse = assistantMessages.some((message) => message.includes("AGENTOS_FIXTURE_FIRST_REPLY"));
        context.data.firstTurn = { historyCount: assistantMessages.length, positiveResponse };
        context.data.firstTurnStreaming = evidence;
        return {
          accepted: evidence.accepted,
          runIdPresent: evidence.runIdPresent,
          assistantMessagePresent: positiveResponse,
          historyCount: assistantMessages.length
        };
      },
      validateResponse: (payload) => {
        const record = asRecord(payload);
        return {
          valid: record?.accepted === true && record.runIdPresent === true && record.assistantMessagePresent === true,
          evidence: `The isolated Gateway accepted a model turn and persisted an assistant response (accepted=${String(record?.accepted)}, runId=${String(record?.runIdPresent)}, assistant=${String(record?.assistantMessagePresent)}, historyCount=${String(record?.historyCount)}).`
        };
      },
      contributesTo: ["positiveExecution", "responseShape"]
    }),
    probe("chat-streaming", "chat.streaming", "Streaming model turn", "chat.send", "required", CORE_CONTROL_DIMENSIONS, "Migration requires native streaming evidence normalized through the AgentOS event mapper.", {
      params: {},
      execute: async (context) => context.data.firstTurnStreaming ?? { accepted: false },
      validateResponse: (payload) => {
        const record = asRecord(payload);
        return {
          valid: record?.accepted === true && readNumber(record.normalizedTextFrames) >= 2 && record.normalizedCompletion === true && record.sessionMatches === true,
          evidence: "Gateway stream frames were associated with the requested session and normalized to a completed turn."
        };
      },
      contributesTo: ["positiveExecution", "responseShape"]
    }),
    probe("chat-streaming-read-denial", "chat.streaming", "Read-only streaming denial", "chat.send", "required", CORE_CONTROL_DIMENSIONS, "A read-only caller must not start a streaming model turn.", {
      clientId: "read",
      params: {
        sessionKey: input.resources.sessionKey,
        message: "AGENTOS_SYNTHETIC_STREAM_AUTHORIZATION_PROBE",
        idempotencyKey: "runtime_cert_stream_read_denial"
      },
      expectedOutcome: "authorization-denied"
    }),
    probe("sessions-subscribe", "sessions.subscribe", "Session event subscription", "sessions.subscribe", "required", OPTIONAL_DIMENSIONS, "AgentOS subscribes to live session changes.", {
      params: {},
      validateResponse: objectWith("subscribed")
    }),
    probe("sessions-messages-subscribe", "sessions.messages.subscribe", "Session message subscription", "sessions.messages.subscribe", "required", OPTIONAL_DIMENSIONS, "AgentOS subscribes to live session messages.", {
      params: { key: input.resources.sessionKey },
      validateResponse: objectWith("subscribed")
    }),
    probe("sessions-messages-unsubscribe", "sessions.messages.unsubscribe", "Session message unsubscription", "sessions.messages.unsubscribe", "optional", OPTIONAL_DIMENSIONS, "Message unsubscription is a recoverable stream lifecycle operation.", {
      params: { key: input.resources.sessionKey },
      validateResponse: objectWith("subscribed")
    }),
    probe("sessions-patch-label", "sessions.patch", "Session metadata patch", "sessions.patch", "required", CORE_LIFECYCLE_DIMENSIONS, "AgentOS updates session metadata through the Gateway.", {
      params: { key: input.resources.sessionKey, label: `${uniqueSessionLabel} patched` },
      validateResponse: objectWith("ok", "key"),
      contributesTo: ["positiveExecution", "responseShape", "lifecycle"]
    }),
    probe("sessions-patch-read-denial", "sessions.patch", "Read-only session patch denial", "sessions.patch", "required", CORE_LIFECYCLE_DIMENSIONS, "A read-only caller must not mutate session metadata.", {
      clientId: "read",
      params: { key: input.resources.sessionKey, label: `${uniqueSessionLabel} read denied` },
      expectedOutcome: "authorization-denied"
    }),
    probe("sessions-patch-many", "sessions.patchMany", "Session batch patch", "sessions.patchMany", "optional", OPTIONAL_DIMENSIONS, "Batch session mutation is not a current AgentOS core dependency but remains a low-risk runtime probe.", {
      params: (context) => ({
        targets: [{
          key: input.resources.sessionKey,
          agentId: "dev",
          ...(typeof context.data.sessionId === "string" ? { expectedSessionId: context.data.sessionId } : {})
        }],
        patch: { label: `${uniqueSessionLabel} batch-patched` }
      }),
      validateResponse: objectWith("outcomes")
    }),
    probe("sessions-abort-idle", "sessions.abort", "Idle session abort", "sessions.abort", "optional", OPTIONAL_DIMENSIONS, "Abort is a recoverable optional session control operation.", {
      params: { key: input.resources.sessionKey },
      validateResponse: objectWith("ok")
    }),
    probe("sessions-dispatch", "sessions.dispatch", "Session dispatch", "sessions.dispatch", "optional", OPTIONAL_DIMENSIONS, "AgentOS does not currently require worker/device dispatch; the documented auto-device request is probed while the disposable session is still active.", {
      skipReason: "No paired session-host node exists in the isolated runtime, so dispatch was intentionally not attempted."
    }),
    probe("sessions-move", "sessions.move", "Session placement move", "sessions.move", "optional", OPTIONAL_DIMENSIONS, "AgentOS does not currently require placement moves; a documented Gateway target with an intentionally unavailable environment is probed while the disposable session is active.", {
      skipReason: "The disposable session remains on local placement and no alternate session-host environment exists, so placement mutation was intentionally not attempted."
    }),
    probe("session-continuity-read-denial", "session.continuity", "Read-only continuity mutation denial", "sessions.patch", "required", CORE_LIFECYCLE_DIMENSIONS, "A read-only caller must not mutate the session used for continuity.", {
      clientId: "read",
      params: { key: input.resources.sessionKey, label: "AGENTOS_SYNTHETIC_CONTINUITY_AUTHORIZATION_PROBE" },
      expectedOutcome: "authorization-denied"
    }),
    probe("gateway-restart", "gateway.restart", "Gateway restart and reconnect", "gateway.restart.request", "required", CORE_LIFECYCLE_DIMENSIONS, "Migration requires control-plane restart recovery before session continuity is claimed.", {
      params: { reason: "AgentOS runtime certification isolated recovery probe" },
      execute: async (context) => {
        const clientContext = context.clients.full;
        const accepted = await clientContext.client.callNative("gateway.restart.request", { reason: "AgentOS runtime certification isolated recovery probe" }, { timeoutMs: 4_000 }, { safety: "mutation", timeoutMs: 4_000 });
        await wait(1_000);
        if (!clientContext.probeHandshake) return { accepted: Boolean(accepted), recovered: false };
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          try {
            const recovered = await clientContext.probeHandshake();
            clientContext.handshake = recovered;
            context.data.recoveredHandshake = recovered;
            // OpenClaw can acknowledge the new socket before its restarted
            // method registry is ready. Refresh every certification client and
            // let the restarted Gateway settle before continuing with probes.
            await wait(2_000);
            for (const client of Object.values(context.clients)) {
              if (!client.probeHandshake) continue;
              for (let refreshAttempt = 0; refreshAttempt < 6; refreshAttempt += 1) {
                try {
                  client.handshake = await client.probeHandshake();
                  break;
                } catch (refreshError) {
                  if (refreshAttempt === 5) throw refreshError;
                  await wait(500);
                }
              }
            }
            return { accepted: true, recovered: true };
          } catch (error) {
            lastError = error;
            await wait(500);
          }
        }
        throw lastError ?? new Error("Gateway did not reconnect after restart request.");
      },
      validateResponse: (payload) => ({ valid: asRecord(payload)?.accepted === true && asRecord(payload)?.recovered === true, evidence: "Restart request was accepted and a fresh native handshake succeeded." }),
      contributesTo: ["positiveExecution", "responseShape", "lifecycle"]
    }),
    probe("gateway-restart-read-denial", "gateway.restart", "Read-only Gateway restart denial", "gateway.restart.request", "required", CORE_LIFECYCLE_DIMENSIONS, "A read-only caller must not restart the Gateway.", {
      clientId: "read",
      params: { reason: "AGENTOS_SYNTHETIC_RESTART_AUTHORIZATION_PROBE" },
      expectedOutcome: "authorization-denied"
    }),
    probe("session-continuity", "session.continuity", "Session continuity after restart", "chat.send", "required", CORE_LIFECYCLE_DIMENSIONS, "Migration requires the same durable session to continue after Gateway restart.", {
      params: {},
      execute: async (context) => {
        if (!input.fixture) throw new Error("No loopback model fixture is configured.");
        const before = context.data.firstTurn as { positiveResponse?: boolean } | undefined;
        const evidence = await runStreamingTurn({
          client: context.clients.full.client,
          sessionKey: input.resources.sessionKey,
          message: "AGENTOS_SYNTHETIC_SECOND_CONTINUITY_PROMPT",
          idempotencyKey: "runtime_cert_second_turn"
        });
        const history = await readHistoryUntil(context.clients.full.client, input.resources.sessionKey, 2);
        const assistantMessages = readAssistantMessages(history);
        const secondResponse = assistantMessages.some((message) => message.includes("AGENTOS_FIXTURE_SECOND_REPLY"));
        return {
          restartedSessionStillReadable: true,
          firstResponsePresent: before?.positiveResponse === true,
          secondResponsePresent: secondResponse,
          assistantMessageCount: assistantMessages.length,
          streamCompleted: evidence.normalizedCompletion === true
        };
      },
      validateResponse: (payload) => {
        const record = asRecord(payload);
        return {
          valid: record?.restartedSessionStillReadable === true && record.firstResponsePresent === true && record.secondResponsePresent === true && record.streamCompleted === true,
          evidence: `The original session remained addressable after restart and persisted both synthetic assistant turns (first=${String(record?.firstResponsePresent)}, second=${String(record?.secondResponsePresent)}, count=${String(record?.assistantMessageCount)}, stream=${String(record?.streamCompleted)}).`
        };
      },
      contributesTo: ["positiveExecution", "responseShape", "lifecycle"]
    }),
    probe("sessions-patch-archive", "sessions.patch", "Session lifecycle archive", "sessions.patch", "required", CORE_LIFECYCLE_DIMENSIONS, "AgentOS must be able to close a durable session with its observed identity.", {
      params: sessionData,
      validateResponse: objectWith("ok", "key"),
      contributesTo: ["positiveExecution", "responseShape", "lifecycle"]
    }),
    probe("sessions-delete-archived", "sessions.delete", "Archived session deletion", "sessions.delete", "required", CORE_LIFECYCLE_DIMENSIONS, "AgentOS cleans up or removes durable sessions through the Gateway.", {
      params: () => ({ key: input.resources.sessionKey, archivedOnly: true, deleteTranscript: false }),
      validateResponse: objectWith("ok", "deleted"),
      captureResponse: () => {
        input.resources.sessionCleaned = true;
      },
      contributesTo: ["positiveExecution", "responseShape", "lifecycle"]
    }),
    probe("sessions-delete-read-denial", "sessions.delete", "Read-only session deletion denial", "sessions.delete", "required", CORE_LIFECYCLE_DIMENSIONS, "A read-only caller must not delete sessions.", {
      clientId: "read",
      params: { key: input.resources.sessionKey, archivedOnly: false },
      expectedOutcome: "authorization-denied"
    }),
    probe("agents-list", "agents.list", "Agent catalog", "agents.list", "required", OPTIONAL_DIMENSIONS, "AgentOS reads the Gateway agent catalog.", {
      validateResponse: objectWith("agents")
    }),
    probe("agents-create", "agents.create", "Disposable agent creation", "agents.create", "required", CORE_CONTROL_DIMENSIONS, "AgentOS requires the Gateway agent lifecycle for controlled workspaces.", {
      params: {
        name: `agentos-runtime-cert-agent-${Date.now()}`,
        workspace: input.resources.workspacePath
      },
      validateResponse: objectWith("ok", "agentId"),
      captureResponse: (payload) => {
        const agentId = readString(asRecord(payload)?.agentId);
        if (agentId) input.resources.agentId = agentId;
      }
    }),
    probe("agents-create-read-denial", "agents.create", "Read-only agent creation denial", "agents.create", "required", CORE_CONTROL_DIMENSIONS, "A read-only caller must not create agents.", {
      clientId: "read",
      params: { name: "agentos-runtime-cert-read-denied", workspace: "/tmp/agentos-runtime-cert-read-denied" },
      expectedOutcome: "authorization-denied"
    }),
    probe("agents-update", "agents.update", "Disposable agent update", "agents.update", "required", CORE_CONTROL_DIMENSIONS, "AgentOS requires Gateway agent updates.", {
      params: () => ({ agentId: input.resources.agentId ?? "agentos-runtime-cert-agent-missing", name: `AgentOS runtime certification updated ${Date.now()}` }),
      validateResponse: objectWith("ok", "agentId")
    }),
    probe("agents-update-read-denial", "agents.update", "Read-only agent update denial", "agents.update", "required", CORE_CONTROL_DIMENSIONS, "A read-only caller must not update agents.", {
      clientId: "read",
      params: { agentId: input.resources.agentId ?? "agentos-runtime-cert-agent-missing", name: "AGENTOS_SYNTHETIC_READ_DENIED" },
      expectedOutcome: "authorization-denied"
    }),
    probe("agents-delete", "agents.delete", "Disposable agent deletion", "agents.delete", "required", CORE_CONTROL_DIMENSIONS, "AgentOS requires Gateway agent cleanup.", {
      params: () => ({ agentId: input.resources.agentId ?? "agentos-runtime-cert-agent-missing" }),
      validateResponse: objectWith("ok", "agentId"),
      captureResponse: () => {
        input.resources.agentCleaned = true;
      }
    }),
    probe("agents-delete-read-denial", "agents.delete", "Read-only agent deletion denial", "agents.delete", "required", CORE_CONTROL_DIMENSIONS, "A read-only caller must not delete agents.", {
      clientId: "read",
      params: { agentId: input.resources.agentId ?? "agentos-runtime-cert-agent-missing" },
      expectedOutcome: "authorization-denied"
    }),
    probe("config-get", "config.get", "Config snapshot", "config.get", "required", ["availability", "positiveExecution", "responseShape"], "AgentOS reads Gateway config before mutations.", {
      validateResponse: objectWith("config", "hash"),
      captureResponse: (payload, context) => {
        const hash = readString(asRecord(payload)?.hash);
        if (hash) context.data.configHash = hash;
      }
    }),
    probe("config-schema", "config.schema", "Config schema", "config.schema", "optional", OPTIONAL_DIMENSIONS, "Config schema discovery is optional diagnostic evidence.", {
      validateResponse: objectWith("schema")
    }),
    probe("config-schema-lookup", "config.schema.lookup", "Config schema lookup", "config.schema.lookup", "optional", OPTIONAL_DIMENSIONS, "Config path schema lookup is optional diagnostic evidence.", {
      params: { path: "models.providers" },
      validateResponse: objectWith("schema")
    }),
    probe("config-patch-fixture", "config.patch", "Loopback provider config patch", "config.patch", "required", CORE_CONTROL_DIMENSIONS, "Migration requires a positive Gateway config mutation; the patch is applied only to the isolated test Gateway.", {
      params: (context) => ({
        raw: JSON.stringify(buildFixtureConfigPatch(input.fixture)),
        ...(typeof context.data.configHash === "string" ? { baseHash: context.data.configHash } : {})
      }),
      validateResponse: (payload) => ({ valid: Boolean(asRecord(payload)), evidence: "The isolated Gateway accepted the loopback provider and default model configuration patch." }),
      contributesTo: ["positiveExecution", "responseShape", "lifecycle"]
    }),
    probe("config-patch-read-denial", "config.patch", "Read-only config mutation denial", "config.patch", "required", CORE_CONTROL_DIMENSIONS, "A read-only caller must not mutate Gateway config.", {
      clientId: "read",
      params: { raw: "{}" },
      expectedOutcome: "authorization-denied"
    }),
    probe("models-list", "models.list", "Model catalog", "models.list", "required", OPTIONAL_DIMENSIONS, "AgentOS reads configured model availability.", {
      validateResponse: objectWith("models")
    }),
    probe("models-auth-status", "models.authStatus", "Model auth status", "models.authStatus", "optional", OPTIONAL_DIMENSIONS, "Provider auth status is optional once the isolated fixture proves execution without external credentials.", {
      validateResponse: objectWith("providers")
    }),
    probe("models-probe", "models.probe", "Model provider probe", "models.probe", "optional", OPTIONAL_DIMENSIONS, "The provider probe is not needed for core migration readiness.", {
      skipReason: "Provider probing is optional; positive model execution was proven through the isolated loopback fixture."
    }),
    probe("models-auth-logout", "models.authLogout", "Model auth logout", "models.authLogout", "experimental", OPTIONAL_DIMENSIONS, "Credential logout is destructive and outside runtime contract certification.", {
      skipReason: "Credential logout was not required and was intentionally not run."
    }),
    probe("approval-list", "exec.approval.list", "Execution approval list", "exec.approval.list", "optional", OPTIONAL_DIMENSIONS, "Approval inventory is an optional operator surface.", {
      validateResponse: (payload) => ({ valid: Array.isArray(payload), evidence: "Approval list returned an array." })
    }),
    probe("question-list", "question.list", "Question list", "question.list", "optional", OPTIONAL_DIMENSIONS, "Question inventory is an optional operator surface.", {
      validateResponse: objectWith("questions")
    }),
    probe("question-request", "question.request", "Question request", "question.request", "optional", OPTIONAL_DIMENSIONS, "Question request/resolve is optional operator coordination evidence.", {
      params: {
        id: input.questionRequestId,
        questions: [{ questionId: "runtime_certification", header: "Verify", question: "AgentOS runtime certification question", options: [{ label: "Continue" }, { label: "Cancel" }] }],
        timeoutMs: 10_000
      },
      validateResponse: objectWith("id"),
      captureResponse: (payload) => {
        const id = readString(asRecord(payload)?.id);
        if (id) input.resources.questionId = id;
      }
    }),
    probe("question-get", "question.get", "Question retrieval", "question.get", "optional", OPTIONAL_DIMENSIONS, "Question retrieval is optional operator coordination evidence.", {
      params: () => ({ id: input.resources.questionId ?? input.questionRequestId }),
      validateResponse: objectWith("question")
    }),
    probe("question-wait-answer", "question.waitAnswer", "Question wait", "question.waitAnswer", "optional", OPTIONAL_DIMENSIONS, "Question waiting is optional operator coordination evidence.", {
      params: () => ({ id: input.resources.questionId ?? input.questionRequestId, timeoutMs: 10 }),
      validateResponse: objectWith("status")
    }),
    probe("question-resolve-cancel", "question.resolve", "Question cancellation", "question.resolve", "optional", OPTIONAL_DIMENSIONS, "Disposable question cancellation prevents test resources from remaining pending.", {
      params: () => ({ id: input.resources.questionId ?? input.questionRequestId, cancel: true }),
      validateResponse: objectWith("status"),
      captureResponse: () => {
        input.resources.questionCleaned = true;
      }
    }),
    probe("fs-list-dir", "fs.listDir", "Host directory listing", "fs.listDir", "optional", OPTIONAL_DIMENSIONS, "The low-risk host directory listing is optional and is tested only against /tmp.", {
      params: { path: "/tmp" },
      validateResponse: objectWith("path", "entries")
    }),
    probe("channels-pairing-approve", "channels.pairing.approve", "Channel pairing approval", "channels.pairing.approve", "experimental", OPTIONAL_DIMENSIONS, "No pending external channel pairing is required by AgentOS core.", {
      skipReason: "No pending external channel pairing request exists in the isolated runtime."
    }),
    probe("node-list", "node.list", "Node list", "node.list", "optional", OPTIONAL_DIMENSIONS, "Node inventory is optional for AgentOS core runtime certification.", {
      validateResponse: objectWith("nodes")
    }),
    probe("node-pair-list", "node.pair.list", "Node pairing list", "node.pair.list", "optional", OPTIONAL_DIMENSIONS, "Node pairing inventory is optional for AgentOS core runtime certification.", {
      validateResponse: objectWith("pending", "paired")
    }),
    probe("node-invoke", "node.invoke", "Paired node invocation", "node.invoke", "experimental", OPTIONAL_DIMENSIONS, "No physical node is part of AgentOS core migration readiness.", {
      skipReason: "Node invocation was not run because the isolated runtime has no paired node and no safe command target."
    }),
    probe("node-invoke-read-denial", "node.invoke", "Read-only node invocation denial", "node.invoke", "experimental", OPTIONAL_DIMENSIONS, "Node authorization is retained as an optional negative proof.", {
      clientId: "read",
      params: { nodeId: "agentos-runtime-cert-missing-node", command: "device.info", params: {}, idempotencyKey: "runtime_cert_node_read_denial" },
      expectedOutcome: "authorization-denied"
    }),
    probe("node-invoke-progress", "node.invoke.progress", "Node invoke progress", "node.invoke.progress", "experimental", OPTIONAL_DIMENSIONS, "Physical node progress events are outside AgentOS core migration readiness.", {
      skipReason: "No physical node invocation exists for progress-event certification."
    }),
    probe("node-plugin-tools-update", "node.pluginTools.update", "Node plugin tools update", "node.pluginTools.update", "experimental", OPTIONAL_DIMENSIONS, "Physical node plugin tools are outside AgentOS core migration readiness.", {
      skipReason: "No paired node is available for plugin tool update certification."
    }),
    probe("node-runner-inventory-update", "node.runnerInventory.update", "Node runner inventory update", "node.runnerInventory.update", "experimental", OPTIONAL_DIMENSIONS, "Physical node runner inventory is outside AgentOS core migration readiness.", {
      skipReason: "No paired node is available for runner inventory certification."
    }),
    probe("node-skills-update", "node.skills.update", "Node skills update", "node.skills.update", "experimental", OPTIONAL_DIMENSIONS, "Physical node skills are outside AgentOS core migration readiness.", {
      skipReason: "No paired node is available for node skills certification."
    }),
    probe("device-pair-list", "device.pair.list", "Device pairing list", "device.pair.list", "experimental", OPTIONAL_DIMENSIONS, "Device pairing is not an AgentOS core dependency.", {
      validateResponse: objectWith("pending", "paired")
    }),
    probe("talk-config", "talk.config", "Talk configuration", "talk.config", "optional", OPTIONAL_DIMENSIONS, "Talk configuration is optional for AgentOS core migration readiness.", {
      validateResponse: objectWith("config")
    }),
    probe("talk-config-secrets-denial", "talk.config", "Talk secret configuration denial", "talk.config", "optional", OPTIONAL_DIMENSIONS, "Talk secret access remains optional and must not be inferred from ordinary config reads.", {
      clientId: "read",
      params: { includeSecrets: true },
      expectedOutcome: "authorization-denied"
    }),
    probe("talk-catalog", "talk.catalog", "Talk catalog", "talk.catalog", "optional", OPTIONAL_DIMENSIONS, "Talk catalog is optional for AgentOS core migration readiness.", {
      validateResponse: objectWith("modes", "transports")
    }),
    probe("talk-session", "talk.session.create", "Talk session", "talk.session.create", "experimental", OPTIONAL_DIMENSIONS, "Talk audio transport is not an AgentOS core dependency.", {
      skipReason: "Talk session creation and audio transport were not required in the isolated runtime."
    }),
    probe("memory-status", "doctor.memory.status", "Memory status", "doctor.memory.status", "optional", OPTIONAL_DIMENSIONS, "Memory diagnostics are optional for AgentOS core migration readiness.", {
      params: { agentId: "dev" },
      validateResponse: objectWith("agentId", "embedding")
    }),
    probe("memory-dream-diary", "doctor.memory.dreamDiary", "Memory dream diary", "doctor.memory.dreamDiary", "optional", OPTIONAL_DIMENSIONS, "Memory diary diagnostics are optional for AgentOS core migration readiness.", {
      params: { agentId: "dev" },
      validateResponse: objectWith("agentId")
    }),
    probe("memory-search", "memory.search", "Semantic memory search", "memory.search", "experimental", OPTIONAL_DIMENSIONS, "Semantic memory search depends on embedding configuration and is not a core migration gate.", {
      skipReason: "Semantic memory search was not required because the loopback fixture intentionally provides chat completion only."
    }),
    probe("cron-status", "cron.status", "Cron status", "cron.status", "optional", OPTIONAL_DIMENSIONS, "Cron scheduling is optional but AgentOS exposes it as an operator surface.", {
      validateResponse: objectWith("enabled", "jobs")
    }),
    probe("cron-list", "cron.list", "Cron list", "cron.list", "optional", OPTIONAL_DIMENSIONS, "Cron inventory is optional but AgentOS exposes it as an operator surface.", {
      validateResponse: objectWith("jobs")
    }),
    probe("cron-add", "cron.add", "Disposable cron creation", "cron.add", "optional", OPTIONAL_DIMENSIONS, "The isolated Gateway must accept an agentTurn cron declaration before manual execution is tested.", {
      params: {
        name: input.cronName,
        agentId: "dev",
        schedule: { kind: "every", everyMs: 3_600_000 },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "AGENTOS_SYNTHETIC_CRON_PROMPT" },
        delivery: { mode: "none" },
        enabled: true,
        deleteAfterRun: false
      },
      validateResponse: (payload) => ({ valid: Boolean(asRecord(payload)?.id || asRecord(asRecord(payload)?.job)?.id), evidence: "An enabled disposable isolated agentTurn cron job was created." }),
      captureResponse: (payload) => {
        const record = asRecord(payload);
        input.resources.cronId = readString(record?.id) ?? readString(asRecord(record?.job)?.id);
      }
    }),
    probe("cron-update", "cron.update", "Disposable cron update", "cron.update", "optional", OPTIONAL_DIMENSIONS, "Cron update is optional lifecycle evidence for the operator surface.", {
      params: () => ({ id: input.resources.cronId ?? "agentos-runtime-cert-missing", patch: { name: `${input.cronName}-updated` } }),
      validateResponse: objectWith("id")
    }),
    probe("cron-run", "cron.run", "Cron execution", "cron.run", "optional", OPTIONAL_DIMENSIONS, "Cron execution is proven through the isolated loopback model and run-history poll.", {
      params: {},
      execute: async (context) => {
        const cronId = input.resources.cronId;
        if (!cronId) throw new Error("Disposable cron job was not created.");
        const queued = await context.clients.full.client.callNative("cron.run", { id: cronId, mode: "force" }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
        const runId = readString(asRecord(queued)?.runId);
        if (!runId) throw new Error("Cron run did not return a run id.");
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const runs = await context.clients.full.client.callNative("cron.runs", { jobId: cronId, runId, limit: 10 }, { timeoutMs: 4_000 }, { safety: "read", timeoutMs: 4_000 });
          const entry = findCronRun(runs, runId);
          if (entry && ["ok", "error", "skipped", "cancelled"].includes(readString(entry.status) ?? "")) {
            return { runIdPresent: true, terminal: true, status: readString(entry.status) ?? "unknown", succeeded: entry.status === "ok" };
          }
          await wait(500);
        }
        return { runIdPresent: true, terminal: false, status: "timeout", succeeded: false };
      },
      validateResponse: (payload) => ({ valid: asRecord(payload)?.runIdPresent === true && asRecord(payload)?.terminal === true && asRecord(payload)?.succeeded === true, evidence: `The cron run reached a successful terminal history entry through the isolated model provider (runId=${String(asRecord(payload)?.runIdPresent)}, terminal=${String(asRecord(payload)?.terminal)}, succeeded=${String(asRecord(payload)?.succeeded)}).` }),
      contributesTo: ["positiveExecution", "responseShape", "lifecycle"]
    }),
    probe("cron-remove", "cron.remove", "Disposable cron removal", "cron.remove", "optional", OPTIONAL_DIMENSIONS, "Cron cleanup prevents disposable jobs from surviving certification.", {
      params: () => ({ id: input.resources.cronId ?? "agentos-runtime-cert-missing" }),
      validateResponse: objectWith("removed"),
      captureResponse: () => {
        input.resources.cronCleaned = true;
      }
    }),
    probe("gateway-restart-preflight", "gateway.restart.preflight", "Gateway restart preflight", "gateway.restart.preflight", "optional", OPTIONAL_DIMENSIONS, "Structured restart safety diagnostics are optional control-plane evidence.", {
      validateResponse: objectWith("safe", "counts", "blockers", "summary")
    })
  ];
}

function probe(
  id: string,
  operationId: string,
  operation: string,
  method: string,
  requirementLevel: OpenClawRuntimeRequirementLevel,
  requiredEvidenceDimensions: OpenClawRuntimeEvidenceDimension[],
  requirementRationale: string,
  options: Omit<OpenClawRuntimeCertificationProbe, "id" | "operationId" | "operation" | "method" | "requirementLevel" | "requiredEvidenceDimensions" | "requirementRationale">
): OpenClawRuntimeCertificationProbe {
  return { id, operationId, operation, method, requirementLevel, requiredEvidenceDimensions, requirementRationale, ...options };
}

function buildFixtureConfigPatch(fixture: Awaited<ReturnType<typeof createOpenClawRuntimeProviderFixture>> | null) {
  if (!fixture) return {};
  return {
    models: {
      mode: "merge",
      providers: {
        "agentos-fixture": {
          baseUrl: fixture.baseUrl,
          api: "openai-completions",
          apiKey: "agentos-runtime-fixture",
          timeoutSeconds: 30,
          models: [{
            id: fixture.modelId,
            name: "AgentOS Runtime Fixture",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 32_768,
            maxTokens: 128
          }]
        }
      }
    },
    agents: { defaults: { model: { primary: `agentos-fixture/${fixture.modelId}` } } }
  };
}

async function configureFixtureProvider(
  client: OfficialBackedGatewayClient,
  fixture: Awaited<ReturnType<typeof createOpenClawRuntimeProviderFixture>>
) {
  const snapshot = await client.callNative<Record<string, unknown>>("config.get", {}, { timeoutMs: 8_000 }, { safety: "read", timeoutMs: 8_000 });
  const hash = readString(snapshot.hash);
  await client.callNative("config.patch", {
    raw: JSON.stringify(buildFixtureConfigPatch(fixture)),
    ...(hash ? { baseHash: hash } : {})
  }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
  await wait(500);
}

async function runStreamingTurn(input: {
  client: OpenClawRuntimeCertificationContext["clients"][string]["client"];
  sessionKey: string;
  message: string;
  idempotencyKey: string;
}) {
  const frames: GatewayEventFrame[] = [];
  const nativeClient = input.client as OfficialBackedGatewayClient;
  let eventSubscription: { close: () => void } | null = null;
  try {
    eventSubscription = await nativeClient.subscribeNativeEvents(
      { subscribeSessions: true, sessionKeys: [input.sessionKey] },
      { onEvent: (frame) => frames.push(frame) },
      { timeoutMs: 8_000 }
    );
    const dispatch = await nativeClient.callNative<Record<string, unknown>>("chat.send", {
      sessionKey: input.sessionKey,
      message: input.message,
      idempotencyKey: input.idempotencyKey
    }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
    const runId = readString(dispatch.runId);
    await waitForTerminalEvent(frames, input.sessionKey, runId, 30_000);
    const normalized = frames
      .map((frame) => normalizeGatewayTurnEvent(frame, input.sessionKey, runId))
      .filter((event): event is NonNullable<ReturnType<typeof normalizeGatewayTurnEvent>> => event !== null);
    return {
      accepted: true,
      runIdPresent: Boolean(runId),
      eventCount: frames.length,
      eventNames: [...new Set(frames.map((frame) => readString(frame.event)).filter((event): event is string => event !== null))],
      normalizedTextFrames: normalized.filter((event) => Boolean(event.text)).length,
      normalizedCompletion: normalized.some((event) => event.done && event.payload.status === "completed"),
      sessionMatches: normalized.length > 0,
      textObserved: normalized.some((event) => Boolean(event.text))
    };
  } finally {
    eventSubscription?.close();
  }
}

async function waitForTerminalEvent(frames: GatewayEventFrame[], sessionKey: string, runId: string | null, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const normalized = frames
      .map((frame) => normalizeGatewayTurnEvent(frame, sessionKey, runId))
      .filter((event): event is NonNullable<ReturnType<typeof normalizeGatewayTurnEvent>> => event !== null);
    if (normalized.some((event) => event.done)) return;
    await wait(100);
  }
  throw new Error("Timed out waiting for a terminal normalized Gateway turn event.");
}

async function readHistoryUntil(client: OpenClawRuntimeCertificationContext["clients"][string]["client"], sessionKey: string, minimumAssistantMessages: number) {
  let last: unknown = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    last = await client.callNative("chat.history", { sessionKey, limit: 20 }, { timeoutMs: 4_000 }, { safety: "read", timeoutMs: 4_000 });
    if (readAssistantMessages(last).length >= minimumAssistantMessages) return last;
    await wait(250);
  }
  return last;
}

function readAssistantMessages(payload: unknown) {
  const messages = asRecord(payload)?.messages;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => {
    const record = asRecord(message);
    const role = readString(record?.role) ?? readString(asRecord(record?.message)?.role);
    const content = readMessageContent(record?.content) ?? readMessageContent(asRecord(record?.message)?.content);
    return role === "assistant" && content ? [content] : [];
  });
}

function readMessageContent(value: unknown): string | null {
  const direct = readString(value);
  if (direct) return direct;
  if (!Array.isArray(value)) return null;
  const text = value.flatMap((part) => {
    const record = asRecord(part);
    return readString(record?.text) ?? readString(record?.content) ?? "";
  }).join("");
  return text || null;
}

function findCronRun(payload: unknown, runId: string) {
  const record = asRecord(payload);
  const entries = Array.isArray(record?.entries)
    ? record.entries
    : Array.isArray(record?.runs)
      ? record.runs
      : Array.isArray(payload)
        ? payload
        : [];
  return entries.map(asRecord).find((run) => run?.runId === runId || run?.id === runId) ?? null;
}

async function cleanupResources(
  client: OfficialBackedGatewayClient,
  resources: RuntimeResources
): Promise<NonNullable<OpenClawRuntimeCertificationReport["cleanup"]>> {
  const output: NonNullable<OpenClawRuntimeCertificationReport["cleanup"]> = {
    status: "complete",
    resources: [
      { kind: "session", status: "not-created" },
      { kind: "agent", status: "not-created" },
      { kind: "question", status: "not-created" },
      { kind: "cron", status: "not-created" },
      { kind: "workspace", status: "not-created" },
      { kind: "gateway", status: "not-created" }
    ]
  };
  const clean = async (kind: "session" | "agent" | "question" | "cron", action: () => Promise<void>) => {
    try {
      await action();
      const resource = output.resources.find((entry) => entry.kind === kind);
      if (resource) resource.status = "cleaned";
    } catch {
      const resource = output.resources.find((entry) => entry.kind === kind);
      if (resource) resource.status = "failed";
      output.status = "partial";
    }
  };

  if (resources.sessionId && !resources.sessionCleaned) {
    await clean("session", async () => {
      await client.callNative("sessions.patch", { key: resources.sessionKey, archived: true, expectedSessionId: resources.sessionId }, { timeoutMs: 4_000 }, { safety: "mutation", timeoutMs: 4_000 });
      await client.callNative("sessions.delete", { key: resources.sessionKey, archivedOnly: true, deleteTranscript: false }, { timeoutMs: 4_000 }, { safety: "mutation", timeoutMs: 4_000 });
    });
  } else if (resources.sessionId) {
    output.resources.find((entry) => entry.kind === "session")!.status = "cleaned";
  }
  if (resources.agentId && !resources.agentCleaned) {
    await clean("agent", async () => {
      await client.callNative("agents.delete", { agentId: resources.agentId }, { timeoutMs: 4_000 }, { safety: "mutation", timeoutMs: 4_000 });
    });
  } else if (resources.agentId) {
    output.resources.find((entry) => entry.kind === "agent")!.status = "cleaned";
  }
  if (resources.questionId && !resources.questionCleaned) {
    await clean("question", async () => {
      await client.callNative("question.resolve", { id: resources.questionId, cancel: true }, { timeoutMs: 4_000 }, { safety: "mutation", timeoutMs: 4_000 });
    });
  } else if (resources.questionId) {
    output.resources.find((entry) => entry.kind === "question")!.status = "cleaned";
  }
  if (resources.cronId && !resources.cronCleaned) {
    await clean("cron", async () => {
      await client.callNative("cron.remove", { id: resources.cronId }, { timeoutMs: 4_000 }, { safety: "mutation", timeoutMs: 4_000 });
    });
  } else if (resources.cronId) {
    output.resources.find((entry) => entry.kind === "cron")!.status = "cleaned";
  }
  if (resources.agentId) {
    try {
      await rm(resources.workspacePath, { recursive: true, force: true });
      output.resources.find((entry) => entry.kind === "workspace")!.status = "cleaned";
    } catch {
      output.resources.find((entry) => entry.kind === "workspace")!.status = "failed";
      output.status = "partial";
    }
  }
  return output;
}

async function collectPersistenceEvidence(): Promise<OpenClawRuntimeCertificationReport["persistence"]> {
  const sqlitePaths = STATE_DIR
    ? [path.join(STATE_DIR, "state", "openclaw.sqlite"), path.join(STATE_DIR, "openclaw.sqlite")]
    : [];
  const existingPath = await firstExistingPath(sqlitePaths);
  const sqlite = existingPath
    ? await runQuietProcess("sqlite3", [existingPath, "PRAGMA integrity_check;"])
    : null;
  const sqliteStatus = sqlite?.code === 0 && sqlite.stdout.trim() === "ok" ? "healthy" : existingPath ? "degraded" : "unknown";
  const doctor = OPENCLAW_CLI
    ? await runQuietProcess(process.execPath, [OPENCLAW_CLI, "doctor", "--json"], STATE_DIR ? { OPENCLAW_STATE_DIR: STATE_DIR } : undefined)
    : null;
  const doctorStatus = doctor ? doctor.code === 0 ? "healthy" : "degraded" : "unknown";
  const status = sqliteStatus === "healthy" || doctorStatus === "healthy"
    ? "healthy"
    : sqliteStatus === "degraded" || doctorStatus === "degraded"
      ? "degraded"
      : "unknown";
  return {
    status,
    sqlite: { status: sqliteStatus, checks: existingPath ? ["PRAGMA integrity_check"] : ["SQLite database path not provided or not found"] },
    doctor: { status: doctorStatus, checks: doctor ? ["OpenClaw doctor --json"] : ["OpenClaw CLI path not provided"] }
  };
}

async function firstExistingPath(paths: string[]) {
  for (const candidate of paths) {
    try {
      await stat(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

function runQuietProcess(command: string, args: string[], extraEnv?: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(command, args, {
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
      stdio: ["ignore", "pipe", "ignore"]
    });
    let stdout = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ code: null, stdout });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
  });
}

function objectWith(...keys: string[]) {
  return (payload: unknown) => {
    const record = asRecord(payload);
    return {
      valid: Boolean(record && keys.every((key) => Object.hasOwn(record, key))),
      evidence: `Response object ${keys.length > 0 ? `contains ${keys.join(", ")}` : "was received"}.`
    };
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function writeReport(output: unknown) {
  const serialized = serializeOpenClawRuntimeCertificationArtifact(output);
  if (!QUIET) {
    console.log("OPENCLAW_RUNTIME_CERTIFICATION_JSON_START");
    console.log(serialized);
    console.log("OPENCLAW_RUNTIME_CERTIFICATION_JSON_END");
  }
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, serialized, "utf8");
}

function printSummary(
  report: OpenClawRuntimeCertificationReport,
  bridgeSummary: { certified: number; partiallyCertified: number; failed: number; uncertified: number; staticOnly: number }
) {
  console.log(
    `OpenClaw ${report.targetVersion} runtime certification: ${report.summary.passed} PASS, ${report.summary.failed} FAIL, ${report.summary.skipped} SKIPPED, ${report.summary.expectedDenials} EXPECTED-DENIAL, ${report.summary.unknown} UNKNOWN.`
  );
  console.log(
    `Static to runtime evidence bridge: ${bridgeSummary.certified} certified, ${bridgeSummary.partiallyCertified} partially-certified, ${bridgeSummary.failed} failed, ${bridgeSummary.uncertified} uncertified, ${bridgeSummary.staticOnly} static-only.`
  );
  console.log(`Migration readiness: ${report.migrationReadiness?.readyForMigrationEngine ? "READY FOR PHASE 2B" : "NOT READY FOR PHASE 2B"}.`);
}

void main().then((exitCode) => {
  process.exitCode = exitCode;
});
