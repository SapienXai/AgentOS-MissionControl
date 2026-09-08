import "server-only";

import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { readOpenClawChangedPaths } from "@/lib/openclaw/client/native-ws-gateway-config";
import {
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import {
  filterAgentPolicySkills,
  upsertAgentConfigEntry
} from "@/lib/openclaw/domains/agent-config";
import {
  ensureAgentPolicySkill as ensureAgentPolicySkillFromProvisioning
} from "@/lib/openclaw/domains/agent-provisioning";
import {
  discoverDiscordRoutes,
  discoverSurfaceRoutes,
  discoverTelegramGroups,
  getChannelRegistry,
  parseDiscordRouteId,
  readChannelAccounts,
  readChannelRegistry
} from "@/lib/openclaw/domains/channels";
import { getSurfaceKind } from "@/lib/openclaw/surface-catalog";
import {
  buildSurfaceBindingRepairResult,
  buildSurfaceDriftSnapshot,
  createConfigOnlySurfaceRuntimeSnapshot,
  mergeManagedOpenClawBindings,
  validateSurfaceReconcilePreviewForApply,
  type SurfaceReconcilePreviewAudit
} from "@/lib/openclaw/surface-runtime";
import {
  normalizeChannelRegistry,
  uniqueByChatId
} from "@/lib/openclaw/domains/workspace-manifest";
import { writeTextFileEnsured } from "@/lib/openclaw/domains/workspace-bootstrap";
import { normalizeOptionalValue } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  channelRegistryPath,
  missionControlRootPath
} from "@/lib/openclaw/state/paths";
import { measureTiming, type TimingCollector } from "@/lib/openclaw/timing";
import { redactSecrets } from "@/lib/security/redaction";
import type {
  ChannelAccountRecord,
  ChannelRegistry,
  MissionControlSnapshot,
  MissionControlSurfaceProvider,
  PlannerChannelType,
  SurfaceBindingRepairResult,
  SurfaceConfigRepairMutation,
  WorkspaceChannelGroupAssignment,
  WorkspaceChannelSummary,
  WorkspaceChannelWorkspaceBinding
} from "@/lib/openclaw/types";

type ManagedChatChannelProvider = "slack" | "telegram" | "discord" | "googlechat";
type OpenClawConfigPatch = Record<string, unknown>;
type OpenClawConfigCommandResult = {
  stdout: string;
  stderr?: string;
};
type TelegramSettingsPatchPlan = {
  patch: OpenClawConfigPatch | null;
  defaultAccountId: string | null;
};
type SurfaceReconcileConfigBackupValues = Record<string, unknown>;

const surfaceReconcilePreviewMaxAgeMs = 15 * 60 * 1000;
const approvedSurfaceRepairConfigPaths = new Set([
  "bindings",
  "channels.telegram.enabled",
  "channels.telegram.defaultAccount",
  "channels.telegram.groups"
]);

export {
  discoverDiscordRoutes,
  discoverSurfaceRoutes,
  discoverTelegramGroups,
  getChannelRegistry
};

function invalidateSnapshotCache() {
  invalidateMissionControlSnapshotCache();
}

export async function upsertWorkspaceChannel(input: {
  workspaceId: string;
  workspacePath: string;
  channelId: string;
  type: MissionControlSurfaceProvider;
  name: string;
  primaryAgentId?: string | null;
  agentIds?: string[];
  groupAssignments?: WorkspaceChannelGroupAssignment[];
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await measureTiming(timings, "workspace-channel.registry-upsert", () =>
    mutateChannelRegistry((registry) => {
      const existingChannel = registry.channels.find((entry) => entry.id === channelId);
      const nextChannel: WorkspaceChannelSummary =
        existingChannel ??
        ({
          id: channelId,
          type: input.type,
          name: input.name.trim() || channelId,
          primaryAgentId: normalizeOptionalValue(input.primaryAgentId) ?? null,
          workspaces: []
        } satisfies WorkspaceChannelSummary);
      const workspaceId = input.workspaceId.trim();
      const workspacePath = input.workspacePath.trim();
      const workspaceBinding =
        nextChannel.workspaces.find((entry) => entry.workspaceId === workspaceId) ??
        ({
          workspaceId,
          workspacePath,
          agentIds: [],
          groupAssignments: []
        } satisfies WorkspaceChannelWorkspaceBinding);
      const nextAgentIds = uniqueStrings([
        ...workspaceBinding.agentIds,
        ...(input.agentIds ?? []).map((entry) => entry.trim()).filter(Boolean)
      ]);
      const nextGroupAssignments = uniqueByChatId([
        ...workspaceBinding.groupAssignments,
        ...(input.groupAssignments ?? []).filter((assignment) => Boolean(assignment.chatId))
      ]);

      const mergedWorkspaceBinding: WorkspaceChannelWorkspaceBinding = {
        ...workspaceBinding,
        workspacePath,
        agentIds: nextAgentIds,
        groupAssignments: nextGroupAssignments
      };

      const workspaceBindings = nextChannel.workspaces.filter((entry) => entry.workspaceId !== workspaceId);
      workspaceBindings.push(mergedWorkspaceBinding);

      const nextPrimaryAgentId = normalizeOptionalValue(input.primaryAgentId) ?? nextChannel.primaryAgentId;

      registry.channels = [
        ...registry.channels.filter((entry) => entry.id !== channelId),
        {
          ...nextChannel,
          id: channelId,
          type: input.type,
          name: input.name.trim() || nextChannel.name || channelId,
          primaryAgentId:
            nextPrimaryAgentId ||
            mergedWorkspaceBinding.agentIds[0] ||
            mergedWorkspaceBinding.groupAssignments.find((assignment) => assignment.agentId)?.agentId ||
            null,
          workspaces: workspaceBindings
        }
      ];
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function disconnectWorkspaceChannel(input: {
  workspaceId: string;
  channelId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await measureTiming(timings, "channel-registry.disconnect", () =>
    mutateChannelRegistry((registry) => {
      registry.channels = registry.channels
        .map((channel) => {
          if (channel.id !== channelId) {
            return channel;
          }

          const workspaceBindings = channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId);
          const remainingCandidates = uniqueStrings([
            ...workspaceBindings.flatMap((binding) => binding.agentIds),
            ...workspaceBindings.flatMap((binding) =>
              binding.groupAssignments
                .filter((assignment) => assignment.enabled !== false && assignment.agentId)
                .map((assignment) => assignment.agentId as string)
            )
          ]);

          return {
            ...channel,
            primaryAgentId: channel.primaryAgentId && remainingCandidates.includes(channel.primaryAgentId)
              ? channel.primaryAgentId
              : remainingCandidates[0] ?? null,
            workspaces: workspaceBindings
          };
        })
        .filter((channel) => channel.workspaces.length > 0 || channel.primaryAgentId);
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function deleteWorkspaceChannelEverywhere(input: {
  channelId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  const registry = await measureTiming(timings, "channel-registry.read-before-delete", () => readChannelRegistry());
  const channel = registry.channels.find((entry) => entry.id === channelId);

  if (!channel) {
    throw new Error("Channel was not found.");
  }

  const removedGroupIds = uniqueStrings(
    channel.workspaces.flatMap((workspace) =>
      workspace.groupAssignments
        .filter((assignment) => Boolean(assignment.chatId))
        .map((assignment) => assignment.chatId)
    )
  );
  const workspacePaths = uniqueStrings(channel.workspaces.map((workspace) => workspace.workspacePath));

  if (isPlannerChannelTypeValue(channel.type) && channel.type !== "internal") {
    await measureTiming(timings, "channel.delete-openclaw-remove", () =>
      getOpenClawAdapter().removeChannelAccount(
        {
          channel: channel.type,
          account: channelId,
          delete: true
        },
        {
          timeoutMs: 60000
        }
      )
    );
  }

  await measureTiming(timings, "channel.delete-registry-sync", () =>
    mutateChannelRegistry(
      (nextRegistry) => {
        nextRegistry.channels = nextRegistry.channels.filter((entry) => entry.id !== channelId);
      },
      {
        removedAccountIds: [channelId],
        removedGroupIds
      },
      timings
    )
  );

  await measureTiming(timings, "channel.delete-project-cleanup", () =>
    Promise.all(
      workspacePaths.map((workspacePath) =>
        removeWorkspaceProjectChannelReferences(workspacePath, channelId, timings)
      )
    )
  );

  invalidateSnapshotCache();
  return measureTiming(timings, "channel.delete-read-final-registry", () => getChannelRegistry());
}

export async function reconcileWorkspaceSurfaceBindings(input: {
  workspaceId: string;
  scope?: "workspace" | "all";
  dryRun?: boolean;
  confirmedPreviewAuditId?: string;
}, timings?: TimingCollector) {
  const scope = input.scope ?? "workspace";
  const dryRun = input.dryRun === true;
  const workspaceId = normalizeOptionalValue(input.workspaceId) ?? null;
  const confirmedPreviewAuditId = normalizeOptionalValue(input.confirmedPreviewAuditId) ?? null;
  if (scope === "workspace" && !workspaceId) {
    throw new Error("Workspace id is required.");
  }
  const previewAudit = dryRun ? null : await readSurfaceReconcilePreviewAudit(confirmedPreviewAuditId);

  const registry = await measureTiming(timings, "surface-reconcile.registry-read", () => readChannelRegistry());
  if (scope === "workspace") {
    const workspaceExists = registry.channels.some((channel) =>
      channel.workspaces.some((workspace) => workspace.workspaceId === workspaceId)
    );
    if (!workspaceExists) {
      throw new Error("Workspace binding was not found for any surface.");
    }
  }

  const previousBindings = await measureTiming(timings, "surface-reconcile.bindings-read", () =>
    getOpenClawAdapter().getConfig<unknown[]>("bindings").then((value) => (Array.isArray(value) ? value : []))
  );
  const nextBindings = mergeManagedOpenClawBindings({
    registry,
    currentBindings: previousBindings,
    scope,
    workspaceId
  });
  const managedChannels = registry.channels.filter(
    (channel) => isPlannerChannelTypeValue(channel.type) && channel.type !== "internal"
  );
  const telegramPatchPlan = scope === "all"
    ? await measureTiming(timings, "surface-reconcile.telegram-settings-plan", () =>
        buildManagedTelegramSettingsPatch(
          managedChannels.filter((channel) => channel.type === "telegram"),
          timings
        )
      )
    : { patch: null, defaultAccountId: null };
  const reconcilePatch = mergeConfigPatches({ bindings: nextBindings }, telegramPatchPlan.patch);
  const plannedConfigPaths = reconcilePatch
    ? flattenSurfaceConfigRepairPatch(reconcilePatch).map((write) => write.path)
    : [];
  assertApprovedSurfaceRepairConfigPaths(plannedConfigPaths);
  if (previewAudit) {
    validateSurfaceReconcilePreviewForApply({
      preview: previewAudit,
      previewMaxAgeMs: surfaceReconcilePreviewMaxAgeMs,
      scope,
      workspaceId: scope === "workspace" ? workspaceId : null,
      plannedConfigPaths,
      currentBindings: previousBindings,
      nextBindings
    });
  }
  const auditId = createSurfaceReconcileAuditId();
  const auditPath = path.join(missionControlRootPath, "surface-reconcile", `${auditId}.json`);
  const backupId = dryRun ? null : createSurfaceReconcileBackupId();
  const backupPath = backupId
    ? path.join(missionControlRootPath, "surface-reconcile", `${backupId}.json`)
    : null;
  const previousConfigValues = dryRun
    ? null
    : await readSurfaceReconcileConfigBackupValues(plannedConfigPaths, timings);
  const restorePlan = buildSurfaceReconcileRestorePlan({
    auditId,
    createdAt: new Date().toISOString(),
    configPaths: plannedConfigPaths,
    confirmedPreviewAuditId: confirmedPreviewAuditId ?? undefined,
    backupId: backupId ?? undefined,
    backupPath: backupPath ?? undefined
  });
  if (backupId && backupPath) {
    await writeSurfaceReconcileBackup({
      backupId,
      backupPath,
      auditId,
      confirmedPreviewAuditId,
      scope,
      workspaceId: scope === "workspace" ? workspaceId : null,
      previousBindings,
      nextBindings,
      reconcilePatch,
      plannedConfigPaths,
      previousConfigValues
    }, timings);
  }
  const configMutations = dryRun
    ? undefined
    : await measureTiming(timings, "surface-reconcile.config-write", () =>
        applySurfaceConfigRepairPatch(reconcilePatch!, timings)
      );

  if (scope === "all" && !dryRun) {
    const telegramChannels = managedChannels.filter((channel) => channel.type === "telegram");
    await measureTiming(timings, "surface-reconcile.telegram-settings-side-effects", () =>
      reconcileManagedTelegramSettingsSideEffects(telegramChannels, telegramPatchPlan.defaultAccountId, timings)
    );
    await measureTiming(timings, "surface-reconcile.discord-settings", () =>
      syncManagedDiscordSettings(
        managedChannels.filter((channel) => channel.type === "discord"),
        timings
      )
    );
  }

  const configuredAccounts = await measureTiming(timings, "surface-reconcile.accounts-read", () => readChannelAccounts());
  const surfaceRuntime = createConfigOnlySurfaceRuntimeSnapshot(configuredAccounts, registry);
  const drift = buildSurfaceDriftSnapshot({
    registry,
    currentBindings: nextBindings,
    surfaceRuntime,
    configuredAccounts,
    workspaceId: scope === "workspace" ? workspaceId : null
  });

  const repair = buildSurfaceBindingRepairResult({
    scope,
    workspaceId: scope === "workspace" ? workspaceId : null,
    registry,
    previousBindings,
    nextBindings,
    configMutations,
    dryRun,
    applied: !dryRun,
    auditId,
    auditPath,
    confirmedPreviewAuditId: confirmedPreviewAuditId ?? undefined,
    backupId: backupId ?? undefined,
    backupPath: backupPath ?? undefined,
    restorePlan,
    drift
  });

  await writeSurfaceReconcileAudit({
    auditPath,
    repair,
    previousBindings,
    nextBindings,
    reconcilePatch,
    plannedConfigPaths
  }, timings);

  if (!dryRun) {
    invalidateSnapshotCache();
  }

  return repair;
}

export async function setWorkspaceChannelPrimary(input: {
  channelId: string;
  primaryAgentId: string | null;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await measureTiming(timings, "channel.primary-update", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      channel.primaryAgentId = normalizeOptionalValue(input.primaryAgentId) ?? null;
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function setWorkspaceChannelGroups(input: {
  channelId: string;
  workspaceId: string;
  groupAssignments: WorkspaceChannelGroupAssignment[];
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  const removedGroupIds: string[] = [];

  await measureTiming(timings, "channel.groups-update", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
      if (!workspace) {
        throw new Error("Workspace binding was not found for this channel.");
      }

      const previousGroupIds = new Set(
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && Boolean(assignment.chatId))
          .map((assignment) => assignment.chatId)
      );

      workspace.groupAssignments = uniqueByChatId(
        input.groupAssignments.map((assignment) => ({
          chatId: assignment.chatId.trim(),
          agentId: normalizeOptionalValue(assignment.agentId) ?? null,
          title: normalizeOptionalValue(assignment.title) ?? null,
          enabled: assignment.enabled !== false
        }))
      );
      workspace.agentIds = uniqueStrings([
        ...workspace.agentIds,
        ...workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && assignment.agentId)
          .map((assignment) => assignment.agentId as string)
      ]);

      const nextGroupIds = new Set(
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && Boolean(assignment.chatId))
          .map((assignment) => assignment.chatId)
      );

      for (const chatId of previousGroupIds) {
        if (!nextGroupIds.has(chatId)) {
          removedGroupIds.push(chatId);
        }
      }
    }, { removedGroupIds }, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function bindWorkspaceChannelAgent(input: {
  channelId: string;
  workspaceId: string;
  workspacePath: string;
  agentId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  const agentId = slugify(input.agentId.trim());
  if (!channelId || !agentId) {
    throw new Error("Channel id and agent id are required.");
  }

  await measureTiming(timings, "channel.bind-agent", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
      const nextWorkspace: WorkspaceChannelWorkspaceBinding =
        workspace ??
        ({
          workspaceId: input.workspaceId,
          workspacePath: input.workspacePath,
          agentIds: [],
          groupAssignments: []
        } satisfies WorkspaceChannelWorkspaceBinding);

      nextWorkspace.agentIds = uniqueStrings([...nextWorkspace.agentIds, agentId]);
      nextWorkspace.workspacePath = input.workspacePath;
      channel.workspaces = [
        ...channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId),
        nextWorkspace
      ];

      if (!channel.primaryAgentId) {
        channel.primaryAgentId = agentId;
      }
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function unbindWorkspaceChannelAgent(input: {
  channelId: string;
  workspaceId: string;
  agentId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  const agentId = slugify(input.agentId.trim());
  if (!channelId || !agentId) {
    throw new Error("Channel id and agent id are required.");
  }

  await measureTiming(timings, "channel.unbind-agent", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
      if (!workspace) {
        return;
      }

      workspace.agentIds = workspace.agentIds.filter((entry) => entry !== agentId);
      workspace.groupAssignments = workspace.groupAssignments.filter((assignment) => assignment.agentId !== agentId);

      if (channel.primaryAgentId === agentId) {
        const fallbackAgent =
          workspace.agentIds[0] ??
          workspace.groupAssignments.find((assignment) => assignment.enabled !== false && assignment.agentId)?.agentId ??
          channel.workspaces
            .flatMap((binding) => binding.agentIds)
            .find((candidate) => candidate !== agentId) ??
          channel.workspaces
            .flatMap((binding) => binding.groupAssignments)
            .find((assignment) => assignment.enabled !== false && assignment.agentId && assignment.agentId !== agentId)
            ?.agentId ??
          null;
        channel.primaryAgentId = fallbackAgent;
      }

      channel.workspaces = [
        ...channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId),
        {
          ...workspace,
          agentIds: workspace.agentIds,
          groupAssignments: workspace.groupAssignments
        }
      ];
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function createManagedChatChannelAccount(input: {
  provider: ManagedChatChannelProvider;
  name: string;
  accountId?: string;
  token?: string;
  botToken?: string;
  appToken?: string;
  webhookUrl?: string;
}, timings?: TimingCollector) {
  if (input.provider === "telegram") {
    if (!input.token?.trim()) {
      throw new Error("Telegram bot token is required.");
    }

    return createTelegramChannelAccount({
      name: input.name,
      token: input.token,
      accountId: input.accountId
    }, timings);
  }

  const accountId =
    normalizeOptionalValue(input.accountId) ?? (await buildManagedSurfaceAccountId(input.provider, input.name, timings));
  const before = new Set(
    (
      await measureTiming(timings, `managed-chat.${input.provider}.read-before`, () => readChannelAccounts())
    )
      .filter((account) => account.type === input.provider)
      .map((account) => account.id)
  );
  const provisionInput = (() => {
    switch (input.provider) {
      case "discord":
        if (!input.token?.trim()) {
          throw new Error("Discord bot token is required.");
        }
        return {
          channel: "discord",
          account: accountId,
          token: input.token,
          name: input.name
        };
      case "slack":
        if (!input.botToken?.trim()) {
          throw new Error("Slack bot token is required.");
        }
        if (!input.appToken?.trim()) {
          throw new Error("Slack app token is required for Socket Mode.");
        }
        return {
          channel: "slack",
          account: accountId,
          botToken: input.botToken,
          appToken: input.appToken,
          name: input.name
        };
      case "googlechat":
        if (!input.webhookUrl?.trim()) {
          throw new Error("Google Chat webhook URL is required.");
        }
        return {
          channel: "googlechat",
          account: accountId,
          webhookUrl: input.webhookUrl,
          name: input.name
        };
      default:
        throw new Error(`OpenClaw provisioning is not implemented for ${input.provider}.`);
    }
  })();

  await measureTiming(timings, `managed-chat.${input.provider}.provision-openclaw`, () =>
    getOpenClawAdapter().provisionChannelAccount(provisionInput, { timeoutMs: 60000 })
  );

  const afterAccounts = (
    await measureTiming(timings, `managed-chat.${input.provider}.read-after`, () => readChannelAccounts())
  ).filter((account) => account.type === input.provider);
  const created =
    afterAccounts.find((account) => account.id === accountId) ??
    afterAccounts.find((account) => !before.has(account.id) && account.name === input.name) ??
    afterAccounts.find((account) => !before.has(account.id)) ??
    null;

  return (
    created ?? {
      id: accountId,
      type: input.provider,
      kind: getSurfaceKind(input.provider),
      name: input.name.trim() || accountId,
      enabled: true
    }
  );
}

export async function createManagedSurfaceAccount(input: {
  provider: MissionControlSurfaceProvider;
  name: string;
  accountId?: string;
  token?: string;
  botToken?: string;
  appToken?: string;
  webhookUrl?: string;
  config?: Record<string, unknown>;
}, timings?: TimingCollector) {
  if (isManagedChatChannelProvider(input.provider)) {
    return createManagedChatChannelAccount({
      provider: input.provider,
      name: input.name,
      accountId: input.accountId,
      token: input.token,
      botToken: input.botToken,
      appToken: input.appToken,
      webhookUrl: input.webhookUrl
    }, timings);
  }

  const provisionConfig = normalizeManagedSurfaceProvisionConfig(input.config);
  const normalizedName = input.name.trim();
  const accountIdentity = extractManagedSurfaceIdentity(input.provider, provisionConfig);
  const accountId =
    normalizeOptionalValue(input.accountId) ??
    accountIdentity ??
    (await buildManagedSurfaceAccountId(input.provider, input.name, timings));
  const configPath = getManagedSurfaceConfigPath(input.provider);

  switch (input.provider) {
    case "gmail": {
      const account = normalizeOptionalValue(
        (provisionConfig.account as string | null | undefined) ??
          (provisionConfig.email as string | null | undefined) ??
          (provisionConfig.address as string | null | undefined)
      );

      if (!account) {
        throw new Error("Gmail account email is required.");
      }

      await measureTiming(timings, "managed-surface.gmail.setup-openclaw", () =>
        getOpenClawAdapter().setupGmailWebhook(
          {
            account,
            config: provisionConfig
          },
          { timeoutMs: 60000 }
        )
      );

      const currentConfig = await measureTiming(timings, "managed-surface.gmail.read-config", () =>
        getOpenClawAdapter().getConfig<Record<string, unknown>>(configPath, { timeoutMs: 60000 })
      );
      const currentHooksConfig = await measureTiming(timings, "managed-surface.gmail.read-hooks", () =>
        getOpenClawAdapter().getConfig<Record<string, unknown>>("hooks", { timeoutMs: 60000 })
      );
      const currentPresetsValue = currentHooksConfig?.presets;
      const currentPresets = Array.isArray(currentPresetsValue)
        ? currentPresetsValue.filter((entry): entry is string => typeof entry === "string")
        : [];
      const nextHooksConfig = mergeManagedSurfaceConfig(currentHooksConfig, {
        enabled: true,
        presets: uniqueStrings([...currentPresets, "gmail"])
      });

      await measureTiming(timings, "managed-surface.gmail.write-hooks", () =>
        getOpenClawAdapter().setConfig("hooks", nextHooksConfig, { strictJson: true, timeoutMs: 60000 })
      );

      const nextConfig = mergeManagedSurfaceConfig(currentConfig, {
        enabled: true,
        name: normalizedName || account,
        label: normalizedName || account,
        accountId,
        account,
        email: account,
        address: account,
        ...provisionConfig
      });

      await measureTiming(timings, "managed-surface.gmail.write-config", () =>
        getOpenClawAdapter().setConfig(configPath, nextConfig, { strictJson: true, timeoutMs: 60000 })
      );
      break;
    }
    case "webhook": {
      const currentConfig = await measureTiming(timings, "managed-surface.webhook.read-config", () =>
        getOpenClawAdapter().getConfig<Record<string, unknown>>(configPath, { timeoutMs: 60000 })
      );
      const token = normalizeManagedSurfaceString(provisionConfig.token);
      if (!token) {
        throw new Error("Webhook token is required.");
      }

      const nextConfig = mergeManagedSurfaceConfig(currentConfig, {
        enabled: true,
        name: normalizedName || accountId,
        label: normalizedName || accountId,
        accountId,
        token,
        ...provisionConfig
      });

      await measureTiming(timings, "managed-surface.webhook.write-config", () =>
        getOpenClawAdapter().setConfig(configPath, nextConfig, { strictJson: true, timeoutMs: 60000 })
      );
      break;
    }
    case "cron": {
      const currentConfig = await measureTiming(timings, "managed-surface.cron.read-config", () =>
        getOpenClawAdapter().getConfig<Record<string, unknown>>(configPath, { timeoutMs: 60000 })
      );
      const webhookToken = normalizeManagedSurfaceString(provisionConfig.webhookToken);
      if (!webhookToken) {
        throw new Error("Cron webhook token is required.");
      }

      const nextConfig = mergeManagedSurfaceConfig(currentConfig, {
        enabled: true,
        name: normalizedName || accountId,
        label: normalizedName || accountId,
        accountId,
        webhookToken,
        ...provisionConfig
      });

      await measureTiming(timings, "managed-surface.cron.write-config", () =>
        getOpenClawAdapter().setConfig(configPath, nextConfig, { strictJson: true, timeoutMs: 60000 })
      );
      break;
    }
    case "email": {
      const currentConfig = await measureTiming(timings, "managed-surface.email.read-config", () =>
        getOpenClawAdapter().getConfig<Record<string, unknown>>(configPath, { timeoutMs: 60000 })
      );
      const address = normalizeManagedSurfaceString(provisionConfig.address ?? provisionConfig.email);
      if (!address) {
        throw new Error("Email address is required.");
      }

      const nextConfig = mergeManagedSurfaceConfig(currentConfig, {
        enabled: true,
        name: normalizedName || address,
        label: normalizedName || address,
        accountId,
        address,
        email: address,
        ...provisionConfig
      });

      await measureTiming(timings, "managed-surface.email.write-config", () =>
        getOpenClawAdapter().setConfig(configPath, nextConfig, { strictJson: true, timeoutMs: 60000 })
      );
      break;
    }
    default:
      throw new Error(`OpenClaw provisioning is not implemented for ${input.provider}.`);
  }

  const refreshedAccounts = (
    await measureTiming(timings, `managed-surface.${input.provider}.read-after`, () => readChannelAccounts())
  ).filter((account) => account.type === input.provider);
  const created =
    refreshedAccounts.find((account) => account.id === accountId) ??
    refreshedAccounts.find((account) => account.name.trim().toLowerCase() === input.name.trim().toLowerCase()) ??
    refreshedAccounts[0] ??
    null;

  return (
    created ?? {
      id: accountId,
      type: input.provider,
      kind: getSurfaceKind(input.provider),
      name: normalizedName || accountId,
      enabled: true
    }
  );
}

export async function createTelegramChannelAccount(
  input: { name: string; token: string; accountId?: string },
  timings?: TimingCollector
) {
  const accountId = normalizeOptionalValue(input.accountId) ?? (await buildTelegramAccountId(input.name, timings));

  await measureTiming(timings, "telegram.openclaw-add", () =>
    getOpenClawAdapter().provisionChannelAccount(
      {
        channel: "telegram",
        account: accountId,
        token: input.token,
        name: input.name
      },
      { timeoutMs: 60000 }
    )
  );

  const explicitAccount: ChannelAccountRecord = {
    id: accountId,
    type: "telegram",
    name: input.name.trim() || accountId,
    enabled: true
  };

  const afterAccounts = (
    await measureTiming(timings, "telegram.read-after", () => readChannelAccounts())
  ).filter((account) => account.type === "telegram");
  const explicitMatch = afterAccounts.find((account) => account.id === accountId);
  if (explicitMatch) {
    return {
      ...explicitMatch,
      name: input.name.trim() || explicitMatch.name
    };
  }

  return {
    ...explicitAccount,
    name: input.name.trim() || explicitAccount.name
  };
}

async function writeChannelRegistry(registry: ChannelRegistry) {
  await writeTextFileEnsured(channelRegistryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

async function removeWorkspaceProjectChannelReferences(
  workspacePath: string,
  channelId: string,
  timings?: TimingCollector
) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};

  try {
    const raw = await measureTiming(timings, `workspace-project.${path.basename(workspacePath)}.read`, () =>
      readFile(projectFilePath, "utf8")
    );
    const candidate = JSON.parse(raw);
    parsed = isObjectRecord(candidate) ? candidate : {};
  } catch {
    return;
  }

  if (!Array.isArray(parsed.agents)) {
    return;
  }

  let didChange = false;
  const nextAgents = parsed.agents.map((entry) => {
    if (!isObjectRecord(entry) || typeof entry.id !== "string") {
      return entry;
    }

    const currentChannelIds = Array.isArray(entry.channelIds)
      ? entry.channelIds.filter((value): value is string => typeof value === "string")
      : [];
    const nextChannelIds = currentChannelIds.filter((entry) => entry !== channelId);

    if (nextChannelIds.length === currentChannelIds.length) {
      return entry;
    }

    didChange = true;
    return {
      ...entry,
      channelIds: nextChannelIds
    };
  });

  if (!didChange) {
    return;
  }

  parsed.updatedAt = new Date().toISOString();
  parsed.agents = nextAgents;

  await measureTiming(timings, `workspace-project.${path.basename(workspacePath)}.write`, () =>
    writeTextFileEnsured(projectFilePath, `${JSON.stringify(parsed, null, 2)}\n`)
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEmptyObject(value: unknown) {
  if (value === null || value === undefined) {
    return true;
  }

  return isObjectRecord(value) && !Array.isArray(value) && Object.keys(value).length === 0;
}

function configValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(sortConfigComparable(left ?? null)) === JSON.stringify(sortConfigComparable(right ?? null));
}

function mergeConfigPatches(...patches: Array<OpenClawConfigPatch | null | undefined>): OpenClawConfigPatch | null {
  let merged: OpenClawConfigPatch | null = null;

  for (const patch of patches) {
    if (!patch || Object.keys(patch).length === 0) {
      continue;
    }

    merged = deepMergeConfigPatch(merged ?? {}, patch);
  }

  return merged;
}

function createSurfaceReconcileAuditId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `surface-reconcile-${timestamp}-${suffix}`;
}

function createSurfaceReconcileBackupId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `surface-reconcile-backup-${timestamp}-${suffix}`;
}

async function readSurfaceReconcilePreviewAudit(auditId: string | null): Promise<SurfaceReconcilePreviewAudit> {
  if (!auditId) {
    throw new Error("Integration repair requires a dry-run preview audit id before applying changes.");
  }

  if (!/^surface-reconcile-\d{4}-\d{2}-\d{2}T[0-9-]+Z-[a-z0-9]{6}$/.test(auditId)) {
    throw new Error("Integration repair preview audit id is invalid.");
  }

  const previewAuditPath = path.join(missionControlRootPath, "surface-reconcile", `${auditId}.json`);
  let raw: string;

  try {
    raw = await readFile(previewAuditPath, "utf8");
  } catch {
    throw new Error("Integration repair preview audit was not found. Run a dry-run preview before applying repair.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Integration repair preview audit is unreadable. Run a new dry-run preview before applying repair.");
  }

  if (!isObjectRecord(parsed)) {
    throw new Error("Integration repair preview audit is invalid. Run a new dry-run preview before applying repair.");
  }

  const parsedAuditId = typeof parsed.id === "string" ? normalizeOptionalValue(parsed.id) : null;
  const scope = parsed.scope === "workspace" || parsed.scope === "all" ? parsed.scope : null;
  const createdAt = typeof parsed.createdAt === "string" && parsed.createdAt.trim() ? parsed.createdAt : null;
  const plannedConfigPaths = Array.isArray(parsed.plannedConfigPaths)
    ? parsed.plannedConfigPaths.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];

  if (parsedAuditId !== auditId) {
    throw new Error("Integration repair preview audit id does not match the requested preview.");
  }

  if (!scope || !createdAt) {
    throw new Error("Integration repair preview audit is missing required metadata. Run a new dry-run preview before applying repair.");
  }

  assertApprovedSurfaceRepairConfigPaths(plannedConfigPaths);

  return {
    id: auditId,
    createdAt,
    dryRun: parsed.dryRun === true,
    applied: parsed.applied === false ? false : true,
    scope,
    workspaceId: typeof parsed.workspaceId === "string" ? normalizeOptionalValue(parsed.workspaceId) ?? null : null,
    plannedConfigPaths,
    ...(Array.isArray(parsed.previousBindings) ? { previousBindings: parsed.previousBindings } : {}),
    ...(Array.isArray(parsed.nextBindings) ? { nextBindings: parsed.nextBindings } : {})
  };
}

function assertApprovedSurfaceRepairConfigPaths(paths: string[]) {
  const unsupportedPath = paths.find((entry) => !approvedSurfaceRepairConfigPaths.has(entry));

  if (unsupportedPath) {
    throw new Error(`Integration repair is not allowed to write OpenClaw config path ${unsupportedPath}.`);
  }
}

async function readSurfaceReconcileConfigBackupValues(
  plannedConfigPaths: string[],
  timings?: TimingCollector
): Promise<SurfaceReconcileConfigBackupValues> {
  assertApprovedSurfaceRepairConfigPaths(plannedConfigPaths);

  const adapter = getOpenClawAdapter();
  const previousConfigValues: SurfaceReconcileConfigBackupValues = {};

  for (const configPath of Array.from(new Set(plannedConfigPaths)).sort()) {
    previousConfigValues[configPath] = await measureTiming(
      timings,
      `surface-reconcile.backup-read.${configPath}`,
      () => adapter.getConfig<unknown>(configPath, { timeoutMs: 60_000 })
    );
  }

  return previousConfigValues;
}

function buildSurfaceReconcileRestorePlan(input: {
  auditId: string;
  createdAt: string;
  configPaths: string[];
  confirmedPreviewAuditId?: string;
  backupId?: string;
  backupPath?: string;
}): SurfaceBindingRepairResult["restorePlan"] {
  const configPaths = Array.from(new Set(input.configPaths)).sort();

  return {
    auditId: input.auditId,
    createdAt: input.createdAt,
    configPaths,
    ...(input.backupId ? { backupId: input.backupId } : {}),
    ...(input.backupPath ? { backupPath: input.backupPath } : {}),
    ...(input.confirmedPreviewAuditId ? { confirmedPreviewAuditId: input.confirmedPreviewAuditId } : {}),
    instructions: buildSurfaceReconcileRestoreInstructions({
      auditId: input.auditId,
      configPaths,
      backupId: input.backupId,
      backupPath: input.backupPath
    })
  };
}

function buildSurfaceReconcileRestoreInstructions(input: {
  auditId: string;
  configPaths: string[];
  backupId?: string;
  backupPath?: string;
}) {
  if (input.configPaths.length === 0) {
    return [`Review audit ${input.auditId}; no OpenClaw config path changes were planned.`];
  }

  const backupDetail = input.backupId && input.backupPath
    ? ` Use backup ${input.backupId} at ${input.backupPath} as the redacted previous-value reference.`
    : " Run a new dry-run preview before applying a rollback.";

  return input.configPaths.map((configPath) =>
    `Review audit ${input.auditId}, verify the previous ${configPath} value, then restore only that OpenClaw config path if rollback is required.${backupDetail}`
  );
}

async function writeSurfaceReconcileBackup(input: {
  backupId: string;
  backupPath: string;
  auditId: string;
  confirmedPreviewAuditId: string | null;
  scope: "workspace" | "all";
  workspaceId: string | null;
  previousBindings: unknown[];
  nextBindings: unknown[];
  reconcilePatch: OpenClawConfigPatch | null;
  plannedConfigPaths: string[];
  previousConfigValues: SurfaceReconcileConfigBackupValues | null;
}, timings?: TimingCollector) {
  const backup = redactSecrets({
    id: input.backupId,
    createdAt: new Date().toISOString(),
    kind: "surface-reconcile-backup",
    auditId: input.auditId,
    confirmedPreviewAuditId: input.confirmedPreviewAuditId,
    scope: input.scope,
    workspaceId: input.workspaceId,
    plannedConfigPaths: input.plannedConfigPaths,
    previousBindings: input.previousBindings,
    nextBindings: input.nextBindings,
    previousConfigValues: input.previousConfigValues,
    reconcilePatch: input.reconcilePatch,
    restoreInstructions: input.plannedConfigPaths.length > 0
      ? input.plannedConfigPaths.map((configPath) =>
          `Restore only ${configPath} from previousConfigValues after operator review.`
        )
      : ["No OpenClaw config path changes were planned."]
  });

  await measureTiming(timings, "surface-reconcile.backup-write", () =>
    writeTextFileEnsured(input.backupPath, `${JSON.stringify(backup, null, 2)}\n`)
  );
}

async function writeSurfaceReconcileAudit(input: {
  auditPath: string;
  repair: SurfaceBindingRepairResult;
  previousBindings: unknown[];
  nextBindings: unknown[];
  reconcilePatch: OpenClawConfigPatch | null;
  plannedConfigPaths: string[];
}, timings?: TimingCollector) {
  const audit = redactSecrets({
    id: input.repair.auditId,
    createdAt: input.repair.checkedAt,
    kind: "surface-reconcile",
    dryRun: input.repair.dryRun,
    applied: input.repair.applied,
    scope: input.repair.scope,
    workspaceId: input.repair.workspaceId,
    changed: input.repair.changed,
    previousBindingCount: input.repair.previousBindingCount,
    nextBindingCount: input.repair.nextBindingCount,
    addedBindingCount: input.repair.addedBindingCount,
    removedBindingCount: input.repair.removedBindingCount,
    plannedConfigPaths: input.plannedConfigPaths,
    configMutations: input.repair.configMutations ?? [],
    confirmedPreviewAuditId: input.repair.confirmedPreviewAuditId,
    backupId: input.repair.backupId,
    backupPath: input.repair.backupPath,
    restorePlan: input.repair.restorePlan,
    previousBindings: input.previousBindings,
    nextBindings: input.nextBindings,
    reconcilePatch: input.reconcilePatch,
    drift: input.repair.drift
  });

  await measureTiming(timings, "surface-reconcile.audit-write", () =>
    writeTextFileEnsured(input.auditPath, `${JSON.stringify(audit, null, 2)}\n`)
  );
}

function deepMergeConfigPatch(left: OpenClawConfigPatch, right: OpenClawConfigPatch): OpenClawConfigPatch {
  const merged: OpenClawConfigPatch = { ...left };

  for (const [key, value] of Object.entries(right)) {
    const existing = merged[key];
    if (
      isObjectRecord(existing) &&
      !Array.isArray(existing) &&
      isObjectRecord(value) &&
      !Array.isArray(value)
    ) {
      merged[key] = deepMergeConfigPatch(existing, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

async function applySurfaceConfigRepairPatch(
  patch: OpenClawConfigPatch,
  timings?: TimingCollector
): Promise<SurfaceConfigRepairMutation[]> {
  const adapter = getOpenClawAdapter();
  const mutations: SurfaceConfigRepairMutation[] = [];
  const writes = flattenSurfaceConfigRepairPatch(patch);
  assertApprovedSurfaceRepairConfigPaths(writes.map((write) => write.path));

  for (const write of writes) {
    const result = await measureTiming(timings, `surface-repair.set-config.${write.path}`, () =>
      adapter.setConfig(write.path, write.value, { strictJson: true, timeoutMs: 60_000 })
    );
    mutations.push(readSurfaceConfigMutation(write.path, result));
  }

  return mutations;
}

function flattenSurfaceConfigRepairPatch(patch: OpenClawConfigPatch): Array<{ path: string; value: unknown }> {
  const writes: Array<{ path: string; value: unknown }> = [];

  for (const [key, value] of Object.entries(patch)) {
    if (key === "bindings") {
      writes.push({ path: "bindings", value });
      continue;
    }

    if (key === "channels" && isObjectRecord(value)) {
      const telegram = isObjectRecord(value.telegram) ? value.telegram : null;
      if (!telegram) {
        throw new Error("Integration repair only supports managed channels.telegram config paths.");
      }

      for (const [telegramKey, telegramValue] of Object.entries(telegram)) {
        if (!["enabled", "defaultAccount", "groups"].includes(telegramKey)) {
          throw new Error(`Integration repair does not support channels.telegram.${telegramKey} config writes.`);
        }
        writes.push({ path: `channels.telegram.${telegramKey}`, value: telegramValue });
      }
      continue;
    }

    throw new Error(`Integration repair does not support ${key} config writes.`);
  }

  return writes;
}

function readSurfaceConfigMutation(path: string, result: OpenClawConfigCommandResult): SurfaceConfigRepairMutation {
  const parsed = parseCommandResultJson(result);
  const configMutation = isObjectRecord(parsed?.configMutation) ? parsed.configMutation : null;
  const metadata = isObjectRecord(parsed?.metadata) && isObjectRecord(parsed.metadata.openClawConfig)
    ? parsed.metadata.openClawConfig
    : null;
  const source = configMutation ?? metadata;

  if (!source) {
    return {
      path,
      appliedVia: "cli"
    };
  }

  const appliedVia = readConfigMutationAppliedVia(source.appliedVia);
  return {
    path: typeof source.path === "string" && source.path.trim() ? source.path : path,
    appliedVia,
    ...(typeof source.baseHash === "string" && source.baseHash.trim() ? { baseHash: source.baseHash } : {}),
    ...(typeof source.reloadKind === "string" && source.reloadKind.trim() ? { reloadKind: source.reloadKind } : {}),
    ...(typeof source.restartRequired === "boolean" ? { restartRequired: source.restartRequired } : {}),
    ...(typeof source.hotReloaded === "boolean" ? { hotReloaded: source.hotReloaded } : {}),
    ...(readOpenClawChangedPaths(source) ? { changedPaths: readOpenClawChangedPaths(source) } : {})
  };
}

function parseCommandResultJson(result: OpenClawConfigCommandResult): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(result.stdout || "{}");
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readConfigMutationAppliedVia(value: unknown): SurfaceConfigRepairMutation["appliedVia"] {
  return value === "config.patch" || value === "config.apply" || value === "config.set" || value === "noop"
    ? value
    : "cli";
}

function sortConfigComparable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortConfigComparable);
  }

  if (!isObjectRecord(value) || Array.isArray(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entry]) => [key, sortConfigComparable(entry)])
  );
}

async function buildManagedSurfaceAccountId(
  provider: MissionControlSurfaceProvider,
  name: string,
  timings?: TimingCollector
) {
  const baseSlug = slugify(name.trim()) || provider;
  const baseId = `${provider}-${baseSlug}`;
  const registry = await measureTiming(timings, `managed-surface.${provider}.read-channel-registry`, () =>
    readChannelRegistry()
  );
  const channelAccounts = await measureTiming(timings, `managed-surface.${provider}.read-channel-accounts`, () =>
    readChannelAccounts()
  );
  const existingIds = new Set([
    ...registry.channels.filter((channel) => channel.type === provider).map((channel) => channel.id),
    ...channelAccounts.filter((account) => account.type === provider).map((account) => account.id)
  ]);

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (existingIds.has(`${baseId}-${index}`)) {
    index += 1;
  }

  return `${baseId}-${index}`;
}

async function buildTelegramAccountId(name: string, timings?: TimingCollector) {
  return buildManagedSurfaceAccountId("telegram", name, timings);
}

function getManagedSurfaceConfigPath(provider: MissionControlSurfaceProvider) {
  switch (provider) {
    case "gmail":
      return "hooks.gmail";
    case "email":
      return "email";
    case "webhook":
      return "hooks";
    case "cron":
      return "cron";
    default:
      throw new Error(`OpenClaw provisioning is not implemented for ${provider}.`);
  }
}

function isManagedChatChannelProvider(provider: MissionControlSurfaceProvider): provider is ManagedChatChannelProvider {
  return provider === "telegram" || provider === "discord" || provider === "slack" || provider === "googlechat";
}

function extractManagedSurfaceIdentity(provider: MissionControlSurfaceProvider, config: Record<string, unknown>) {
  switch (provider) {
    case "gmail":
      return (
        normalizeManagedSurfaceString(config.account) ??
        normalizeManagedSurfaceString(config.email) ??
        normalizeManagedSurfaceString(config.address)
      );
    case "email":
      return normalizeManagedSurfaceString(config.address) ?? normalizeManagedSurfaceString(config.email);
    case "webhook":
      return normalizeManagedSurfaceString(config.accountId) ?? normalizeManagedSurfaceString(config.name);
    case "cron":
      return normalizeManagedSurfaceString(config.accountId) ?? normalizeManagedSurfaceString(config.name);
    default:
      return null;
  }
}

function normalizeManagedSurfaceProvisionConfig(config?: Record<string, unknown>) {
  const nextConfig: Record<string, unknown> = {};

  if (!isObjectRecord(config)) {
    return nextConfig;
  }

  for (const [key, value] of Object.entries(config)) {
    assignManagedSurfaceConfigValue(nextConfig, key, normalizeManagedSurfaceConfigValue(value));
  }

  return nextConfig;
}

function mergeManagedSurfaceConfig(
  baseConfig: Record<string, unknown> | null,
  patch: Record<string, unknown>
) {
  const nextConfig = cloneManagedSurfaceConfig(baseConfig);

  for (const [key, value] of Object.entries(patch)) {
    assignManagedSurfaceConfigValue(nextConfig, key, normalizeManagedSurfaceConfigValue(value));
  }

  return nextConfig;
}

function cloneManagedSurfaceConfig(config: Record<string, unknown> | null) {
  if (!isObjectRecord(config)) {
    return {};
  }

  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

function assignManagedSurfaceConfigValue(target: Record<string, unknown>, pathValue: string, value: unknown) {
  if (value === undefined) {
    return;
  }

  const segments = pathValue
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return;
  }

  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const current = cursor[segment];
    if (!isObjectRecord(current)) {
      cursor[segment] = {};
    }

    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]] = value;
}

function normalizeManagedSurfaceConfigValue(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeManagedSurfaceConfigValue(entry))
      .filter((entry) => entry !== undefined);
  }

  if (isObjectRecord(value)) {
    const nextValue: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const normalized = normalizeManagedSurfaceConfigValue(nestedValue);
      if (normalized !== undefined) {
        nextValue[key] = normalized;
      }
    }
    return nextValue;
  }

  return value;
}

function normalizeManagedSurfaceString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function cloneChannelRegistry(registry: ChannelRegistry): ChannelRegistry {
  return normalizeChannelRegistry({
    version: 1,
    channels: registry.channels.map((channel) => ({
      ...channel,
      workspaces: channel.workspaces.map((workspace) => ({
        ...workspace,
        agentIds: [...workspace.agentIds],
        groupAssignments: workspace.groupAssignments.map((assignment) => ({ ...assignment }))
      }))
    }))
  });
}

async function saveChannelRegistry(registry: ChannelRegistry) {
  await writeChannelRegistry(normalizeChannelRegistry(registry));
}

type ManagedTelegramRoutingCleanup = {
  removedAccountIds?: string[];
  removedGroupIds?: string[];
};

type DiscordGuildConfig = Record<
  string,
  {
    requireMention?: boolean;
    roles?: unknown;
    channels?: Record<string, unknown>;
    name?: string;
  }
>;

async function updateManagedSurfaceRouting(
  registry: ChannelRegistry,
  cleanup: ManagedTelegramRoutingCleanup = {},
  timings?: TimingCollector
) {
  const currentBindings = await measureTiming(timings, "routing.read-bindings", () =>
    getOpenClawAdapter().getConfig<unknown[]>("bindings").then((value) => value ?? [])
  );

  const managedChannels = registry.channels.filter(
    (channel) => isPlannerChannelTypeValue(channel.type) && channel.type !== "internal"
  );
  const removedAccountIds = new Set(cleanup.removedAccountIds ?? []);
  const removedGroupIds = new Set(cleanup.removedGroupIds ?? []);
  const managedTelegramChannels = managedChannels.filter((channel) => channel.type === "telegram");
  const managedDiscordChannels = managedChannels.filter((channel) => channel.type === "discord");
  const nextBindings = mergeManagedOpenClawBindings({
    registry,
    currentBindings,
    scope: "all"
  }).filter((entry) => {
    if (!isObjectRecord(entry)) {
      return true;
    }

    const match = isObjectRecord(entry.match) ? entry.match : null;
    if (!match || typeof match.channel !== "string") {
      return true;
    }

    if (typeof match.accountId === "string" && removedAccountIds.has(match.accountId)) {
      return false;
    }

    if (
      match.channel === "telegram" &&
      isObjectRecord(match.peer) &&
      typeof match.peer.id === "string" &&
      removedGroupIds.has(match.peer.id)
    ) {
      return false;
    }

    return true;
  });

  const telegramPatchPlan = await measureTiming(timings, "routing.plan-telegram-settings", () =>
    buildManagedTelegramSettingsPatch(managedTelegramChannels, timings)
  );
  const routingPatch = mergeConfigPatches(
    !configValuesEqual(currentBindings, nextBindings) ? { bindings: nextBindings } : null,
    telegramPatchPlan.patch
  );

  if (routingPatch) {
    await measureTiming(timings, "routing.write-openclaw-config", () =>
      applySurfaceConfigRepairPatch(routingPatch, timings)
    );
  }
  await measureTiming(timings, "routing.reconcile-telegram-session-stores", () =>
    reconcileManagedTelegramSettingsSideEffects(managedTelegramChannels, telegramPatchPlan.defaultAccountId, timings)
  );
  await measureTiming(timings, "routing.sync-discord-settings", () =>
    syncManagedDiscordSettings(managedDiscordChannels, timings)
  );
}

async function buildManagedTelegramSettingsPatch(
  managedChannels: WorkspaceChannelSummary[],
  timings?: TimingCollector
): Promise<TelegramSettingsPatchPlan> {
  const nextEnabled = managedChannels.length > 0;
  const currentEnabled = await measureTiming(timings, "telegram-settings.read-enabled", () =>
    getOpenClawAdapter().getConfig<boolean>("channels.telegram.enabled")
  );
  const telegramPatch: Record<string, unknown> = {};

  const defaultAccountId = await measureTiming(timings, "telegram-settings.default-account-resolve", () =>
    resolveManagedTelegramDefaultAccountId(managedChannels, timings)
  );
  const currentDefaultAccountId = await measureTiming(timings, "telegram-settings.read-default-account", () =>
    getOpenClawAdapter().getConfig<string>("channels.telegram.defaultAccount")
  );

  if (currentEnabled !== nextEnabled) {
    telegramPatch.enabled = nextEnabled;
  }

  if (defaultAccountId && currentDefaultAccountId !== defaultAccountId) {
    telegramPatch.defaultAccount = defaultAccountId;
  } else if (!defaultAccountId && currentDefaultAccountId !== null) {
    telegramPatch.defaultAccount = null;
  }

  const nextGroupsConfig = Object.fromEntries(
    managedChannels.flatMap((channel) =>
      channel.workspaces.flatMap((workspace) =>
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false)
          .map((assignment) => [assignment.chatId, { requireMention: true }] as const)
      )
    )
  );
  const currentGroupsConfig = await measureTiming(timings, "telegram-settings.read-groups", () =>
    getOpenClawAdapter().getConfig<Record<string, unknown>>("channels.telegram.groups")
  );

  if (!isEmptyObject(nextGroupsConfig) || !isEmptyObject(currentGroupsConfig)) {
    if (!configValuesEqual(currentGroupsConfig ?? {}, nextGroupsConfig)) {
      telegramPatch.groups = nextGroupsConfig;
    }
  }

  return {
    patch: Object.keys(telegramPatch).length > 0
      ? {
          channels: {
            telegram: telegramPatch
          }
        }
      : null,
    defaultAccountId
  };
}

async function reconcileManagedTelegramSettingsSideEffects(
  managedChannels: WorkspaceChannelSummary[],
  defaultAccountId: string | null,
  timings?: TimingCollector
) {
  if (!defaultAccountId) {
    return;
  }

  await measureTiming(timings, "telegram-settings.reconcile-session-stores", () =>
    reconcileManagedTelegramSessionStores(managedChannels, defaultAccountId, timings)
  );
}

function collectManagedTelegramSessionStoreRoots(managedChannels: WorkspaceChannelSummary[]) {
  return uniqueStrings([
    path.join(os.homedir(), ".openclaw", "agents"),
    ...managedChannels.flatMap((channel) =>
      channel.workspaces.map((workspace) => path.join(workspace.workspacePath, ".openclaw", "agents"))
    )
  ]);
}

function isTelegramSessionStoreEntry(value: unknown): value is Record<string, unknown> {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (value.channel === "telegram" || value.lastChannel === "telegram") {
    return true;
  }

  const deliveryContext = isObjectRecord(value.deliveryContext) ? value.deliveryContext : null;
  if (deliveryContext?.channel === "telegram") {
    return true;
  }

  const origin = isObjectRecord(value.origin) ? value.origin : null;
  return origin?.provider === "telegram";
}

function resolveTelegramSessionStoreAccountId(value: Record<string, unknown>) {
  const lastAccountId = normalizeOptionalValue(typeof value.lastAccountId === "string" ? value.lastAccountId : null);
  if (lastAccountId) {
    return lastAccountId;
  }

  const deliveryContext = isObjectRecord(value.deliveryContext) ? value.deliveryContext : null;
  const deliveryAccountId = normalizeOptionalValue(
    typeof deliveryContext?.accountId === "string" ? deliveryContext.accountId : null
  );
  if (deliveryAccountId) {
    return deliveryAccountId;
  }

  const origin = isObjectRecord(value.origin) ? value.origin : null;
  return normalizeOptionalValue(typeof origin?.accountId === "string" ? origin.accountId : null);
}

async function reconcileTelegramSessionStoreFile(
  filePath: string,
  preferredAccountId: string,
  knownAccountIds: Set<string>,
  timings?: TimingCollector
) {
  try {
    const raw = await measureTiming(timings, `telegram-settings.read-session-store.${path.basename(filePath)}`, () =>
      readFile(filePath, "utf8")
    );
    const parsed = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return false;
    }

    let changed = false;

    for (const entry of Object.values(parsed)) {
      if (!isTelegramSessionStoreEntry(entry)) {
        continue;
      }

      const currentAccountId = resolveTelegramSessionStoreAccountId(entry);
      if (currentAccountId && knownAccountIds.has(currentAccountId)) {
        continue;
      }

      if (entry.lastAccountId !== preferredAccountId) {
        entry.lastAccountId = preferredAccountId;
        changed = true;
      }

      if (isObjectRecord(entry.deliveryContext) && entry.deliveryContext.accountId !== preferredAccountId) {
        entry.deliveryContext.accountId = preferredAccountId;
        changed = true;
      }

      if (isObjectRecord(entry.origin) && entry.origin.accountId !== preferredAccountId) {
        entry.origin.accountId = preferredAccountId;
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    await measureTiming(timings, `telegram-settings.write-session-store.${path.basename(filePath)}`, () =>
      writeTextFileEnsured(filePath, `${JSON.stringify(parsed, null, 2)}\n`)
    );
    return true;
  } catch {
    return false;
  }
}

async function reconcileManagedTelegramSessionStores(
  managedChannels: WorkspaceChannelSummary[],
  preferredAccountId: string,
  timings?: TimingCollector
) {
  const knownAccountIds = new Set(
    (await readChannelAccounts())
      .filter((account) => account.type === "telegram")
      .map((account) => account.id)
  );
  knownAccountIds.add(preferredAccountId);

  for (const root of collectManagedTelegramSessionStoreRoots(managedChannels)) {
    let entries;

    try {
      entries = await measureTiming(timings, `telegram-settings.read-agent-root.${path.basename(root)}`, () =>
        readdir(root, { withFileTypes: true })
      );
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sessionsPath = path.join(root, entry.name, "sessions", "sessions.json");
      try {
        await access(sessionsPath);
      } catch {
        continue;
      }

      await reconcileTelegramSessionStoreFile(sessionsPath, preferredAccountId, knownAccountIds, timings);
    }
  }
}

async function resolveManagedTelegramDefaultAccountId(
  managedChannels: WorkspaceChannelSummary[],
  timings?: TimingCollector
) {
  const channelAccounts = await measureTiming(timings, "telegram-settings.read-channel-accounts", () =>
    readChannelAccounts()
  );
  const telegramAccounts = channelAccounts.filter((account) => account.type === "telegram");
  const tokenBackedAccounts = telegramAccounts.filter(
    (account) => typeof account.metadata?.botId === "string" && account.metadata.botId.trim().length > 0
  );
  const managedChannelIds = new Set(managedChannels.map((channel) => channel.id));

  for (const channel of managedChannels) {
    const managedMatch = tokenBackedAccounts.find((account) => account.id === channel.id) ?? null;
    if (managedMatch) {
      return managedMatch.id;
    }
  }

  if (tokenBackedAccounts.length === 1) {
    return tokenBackedAccounts[0].id;
  }

  if (tokenBackedAccounts.length > 1) {
    const managedMatch =
      telegramAccounts.find(
        (account) =>
          managedChannelIds.has(account.id) &&
          typeof account.metadata?.botId === "string" &&
          account.metadata.botId.trim().length > 0
      ) ?? null;

    if (managedMatch) {
      return managedMatch.id;
    }

    return tokenBackedAccounts[0].id;
  }

  return managedChannels.find((channel) => Boolean(channel.primaryAgentId))?.id ?? managedChannels[0]?.id ?? null;
}

async function syncManagedDiscordSettings(managedChannels: WorkspaceChannelSummary[], timings?: TimingCollector) {
  if (managedChannels.length === 0) {
    return;
  }

  const currentGuilds = await measureTiming(timings, "discord-settings.read-guilds", () =>
    getOpenClawAdapter().getConfig<DiscordGuildConfig>("channels.discord.guilds").then((value) => value ?? {})
  );
  const nextGuilds: Record<string, Record<string, unknown>> = {};

  for (const [guildId, rawGuild] of Object.entries(currentGuilds ?? {})) {
    nextGuilds[guildId] = isObjectRecord(rawGuild) ? { ...(rawGuild as Record<string, unknown>) } : {};
  }

  let didChange = false;

  for (const channel of managedChannels) {
    for (const workspace of channel.workspaces) {
      for (const assignment of workspace.groupAssignments.filter((entry) => entry.enabled !== false)) {
        const parsed = parseDiscordRouteId(assignment.chatId);
        if (!parsed?.guildId) {
          continue;
        }

        const guild = nextGuilds[parsed.guildId] ?? {};
        const roles = Array.isArray(guild.roles)
          ? guild.roles
              .filter((entry) => typeof entry === "string" || typeof entry === "number")
              .map((entry) => String(entry))
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [];
        const channels = isObjectRecord(guild.channels) ? { ...(guild.channels as Record<string, unknown>) } : {};

        if (guild.requireMention === undefined) {
          guild.requireMention = true;
          didChange = true;
        }

        if (parsed.kind === "role") {
          if (!roles.includes(parsed.targetId)) {
            roles.push(parsed.targetId);
            didChange = true;
          }
          guild.roles = roles;
        } else {
          const allowedChannelIds = uniqueStrings(
            [parsed.targetId, parsed.kind === "thread" ? parsed.parentId ?? "" : ""].filter(Boolean)
          );

          for (const allowedChannelId of allowedChannelIds) {
            const existing = isObjectRecord(channels[allowedChannelId])
              ? (channels[allowedChannelId] as Record<string, unknown>)
              : {};
            if (existing.allow !== true) {
              existing.allow = true;
              didChange = true;
            }
            if (existing.requireMention === undefined) {
              existing.requireMention = true;
              didChange = true;
            }
            channels[allowedChannelId] = existing;
          }

          guild.channels = channels;
        }

        nextGuilds[parsed.guildId] = guild;
      }
    }
  }

  if (!didChange) {
    return;
  }

  await measureTiming(timings, "discord-settings.write-guilds", () =>
    getOpenClawAdapter().setConfig("channels.discord.guilds", nextGuilds, { strictJson: true })
  );
}

function collectTelegramChannelAgentIds(channel: WorkspaceChannelSummary | null | undefined) {
  if (!channel) {
    return [] as string[];
  }

  return uniqueStrings([
    channel.primaryAgentId ?? "",
    ...channel.workspaces.flatMap((workspace) => [
      ...workspace.agentIds,
      ...workspace.groupAssignments
        .filter((assignment) => assignment.enabled !== false && assignment.agentId)
        .map((assignment) => assignment.agentId as string)
    ])
  ]);
}

function normalizeTelegramCoordinationChannel(channel: WorkspaceChannelSummary | null | undefined) {
  if (!channel) {
    return null;
  }

  return {
    id: channel.id,
    name: channel.name,
    primaryAgentId: channel.primaryAgentId ?? null,
    workspaces: channel.workspaces
      .map((workspace) => ({
        workspaceId: workspace.workspaceId,
        workspacePath: workspace.workspacePath,
        agentIds: uniqueStrings([...workspace.agentIds]).sort(),
        groupAssignments: workspace.groupAssignments
          .map((assignment) => ({
            chatId: assignment.chatId,
            agentId: assignment.agentId ?? null,
            title: assignment.title ?? null,
            enabled: assignment.enabled !== false
          }))
          .sort((left, right) => {
            const leftKey = `${left.chatId}:${left.agentId ?? ""}:${left.title ?? ""}:${left.enabled}`;
            const rightKey = `${right.chatId}:${right.agentId ?? ""}:${right.title ?? ""}:${right.enabled}`;
            return leftKey.localeCompare(rightKey);
          })
      }))
      .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId))
  };
}

function areTelegramCoordinationChannelsEqual(
  previousChannel: WorkspaceChannelSummary | null | undefined,
  nextChannel: WorkspaceChannelSummary | null | undefined
) {
  return (
    JSON.stringify(normalizeTelegramCoordinationChannel(previousChannel)) ===
    JSON.stringify(normalizeTelegramCoordinationChannel(nextChannel))
  );
}

async function syncAgentPolicySkills(
  agentIds: string[],
  options: {
    snapshot?: MissionControlSnapshot;
    channelRegistry?: ChannelRegistry;
    timings?: TimingCollector;
  } = {}
) {
  const relevantAgentIds = uniqueStrings(agentIds);

  if (relevantAgentIds.length === 0) {
    return;
  }

  const snapshot =
    options.snapshot ??
    (await measureTiming(options.timings, "agent-policy.snapshot", () =>
      getMissionControlSnapshot({ includeHidden: true })
    ));
  const nextSnapshot = options.channelRegistry
    ? {
        ...snapshot,
        channelRegistry: options.channelRegistry
      }
    : snapshot;

  for (const agentId of relevantAgentIds) {
    await measureTiming(options.timings, `agent-policy.sync-agent.${agentId}`, async () => {
      const agent = nextSnapshot.agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      const setupAgentId =
        nextSnapshot.agents.find(
          (entry) => entry.workspaceId === agent.workspaceId && entry.policy.preset === "setup" && entry.id !== agent.id
        )?.id ?? null;

      const policySkillId = await ensureAgentPolicySkillFromProvisioning({
        workspacePath: agent.workspacePath,
        agentId: agent.id,
        agentName: agent.name,
        policy: agent.policy,
        setupAgentId,
        snapshot: nextSnapshot,
        channelRegistry: options.channelRegistry,
        timings: options.timings
      });

      await upsertAgentConfigEntry(
        agent.id,
        agent.workspacePath,
        {
          name: agent.name,
          model: normalizeOptionalValue(agent.modelId),
          heartbeat: agent.heartbeat.enabled && agent.heartbeat.every ? { every: agent.heartbeat.every } : null,
          skills: [...filterAgentPolicySkills(agent.skills), policySkillId],
          tools: agent.tools.includes("fs.workspaceOnly")
            ? {
                fs: {
                  workspaceOnly: true
                }
              }
            : null
        },
        nextSnapshot,
        options.timings
      );
    });
  }
}

async function syncTelegramCoordinationSkills(
  previousRegistry: ChannelRegistry,
  nextRegistry: ChannelRegistry,
  timings?: TimingCollector
) {
  const relevantAgentIds = await measureTiming(timings, "telegram-coordination.collect-changes", () => {
    const previousTelegramChannels = new Map(
      previousRegistry.channels
        .filter((channel) => channel.type === "telegram")
        .map((channel) => [channel.id, channel] as const)
    );
    const nextTelegramChannels = new Map(
      nextRegistry.channels
        .filter((channel) => channel.type === "telegram")
        .map((channel) => [channel.id, channel] as const)
    );

    return uniqueStrings(
      uniqueStrings([...previousTelegramChannels.keys(), ...nextTelegramChannels.keys()]).flatMap((channelId) => {
        const previousChannel = previousTelegramChannels.get(channelId) ?? null;
        const nextChannel = nextTelegramChannels.get(channelId) ?? null;

        if (areTelegramCoordinationChannelsEqual(previousChannel, nextChannel)) {
          return [];
        }

        return [...collectTelegramChannelAgentIds(previousChannel), ...collectTelegramChannelAgentIds(nextChannel)];
      })
    );
  });

  if (relevantAgentIds.length === 0) {
    return;
  }

  const snapshot = await measureTiming(timings, "telegram-coordination.snapshot", () =>
    getMissionControlSnapshot({ includeHidden: true })
  );
  await measureTiming(timings, "telegram-coordination.sync-agent-policies", () =>
    syncAgentPolicySkills(relevantAgentIds, {
      snapshot,
      channelRegistry: nextRegistry,
      timings
    })
  );
}

async function mutateChannelRegistry(
  mutate: (registry: ChannelRegistry) => void | Promise<void>,
  cleanup: ManagedTelegramRoutingCleanup = {},
  timings?: TimingCollector
) {
  const registry = cloneChannelRegistry(await measureTiming(timings, "channel-registry.read", () => readChannelRegistry()));
  const previousRegistry = cloneChannelRegistry(registry);
  await measureTiming(timings, "channel-registry.mutate", () => mutate(registry));
  await measureTiming(timings, "channel-registry.save", () => saveChannelRegistry(registry));
  await measureTiming(timings, "channel-registry.update-routing", () =>
    updateManagedSurfaceRouting(registry, cleanup, timings)
  );
  invalidateSnapshotCache();
  await measureTiming(timings, "channel-registry.sync-telegram-coordination", () =>
    syncTelegramCoordinationSkills(previousRegistry, registry, timings)
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeChannelId(value: string) {
  const normalized = normalizeOptionalValue(value);
  return normalized ?? "";
}

function isPlannerChannelTypeValue(value: unknown): value is PlannerChannelType {
  return value === "internal" || value === "slack" || value === "telegram" || value === "whatsapp" || value === "discord" || value === "googlechat";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
