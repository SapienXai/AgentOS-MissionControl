"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { AgentCapabilityEditorColumn } from "@/components/mission-control/agent-capability-editor-column";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { formatAgentPresetLabel, getAgentPresetMeta } from "@/lib/openclaw/agent-presets";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import {
  type CapabilityCatalogResponse,
  type CapabilityKind,
  areCapabilityListsEqual,
  buildCapabilityOptions,
  filterCapabilityOptions,
  formatSkillSourceLabel,
  formatToolSourceLabel,
  normalizeCapabilityValues,
  updateSnapshotAgentCapabilities
} from "@/lib/openclaw/capability-editor";
import { OPENCLAW_BUILTIN_TOOL_CATALOG, OPENCLAW_TOOL_GROUP_CATALOG } from "@/lib/openclaw/tool-catalog";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

type AgentCapabilityEditorDialogProps = {
  open: boolean;
  agentId: string | null;
  initialFocus?: CapabilityKind;
  snapshot: MissionControlSnapshot;
  onOpenChange: (open: boolean) => void;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void>;
};

export function AgentCapabilityEditorDialog({
  open,
  agentId,
  initialFocus = "skills",
  snapshot,
  onOpenChange,
  onSnapshotChange,
  onRefresh
}: AgentCapabilityEditorDialogProps) {
  const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) ?? null : null;
  const workspace = snapshot.workspaces.find((entry) => entry.id === agent?.workspaceId);
  const [capabilityCatalog, setCapabilityCatalog] = useState<CapabilityCatalogResponse | null>(null);
  const [capabilityCatalogError, setCapabilityCatalogError] = useState<string | null>(null);
  const [capabilityCatalogLoading, setCapabilityCatalogLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillInput, setSkillInput] = useState("");
  const [toolInput, setToolInput] = useState("");
  const [draftSkills, setDraftSkills] = useState<string[]>([]);
  const [draftTools, setDraftTools] = useState<string[]>([]);
  const skillInputRef = useRef<HTMLInputElement | null>(null);
  const toolInputRef = useRef<HTMLInputElement | null>(null);
  const snapshotRef = useRef(snapshot);
  const editorKind = initialFocus === "tools" ? "tools" : "skills";
  const isSkillsEditor = editorKind === "skills";
  const isToolsEditor = editorKind === "tools";
  const presetMeta = agent ? getAgentPresetMeta(agent.policy.preset) : null;

  const declaredSkills = normalizeCapabilityValues(agent?.skills ?? []);
  const declaredTools = normalizeCapabilityValues((agent?.tools ?? []).filter((tool) => tool !== "fs.workspaceOnly"));
  const effectiveSkills =
    declaredSkills.length > 0 ? declaredSkills : normalizeCapabilityValues(presetMeta?.skillIds ?? []);
  const effectiveTools =
    declaredTools.length > 0 ? declaredTools : normalizeCapabilityValues(presetMeta?.tools ?? []);
  const lockedTools = agent?.tools.includes("fs.workspaceOnly") ? ["fs.workspaceOnly"] : [];
  const observedTools = normalizeCapabilityValues(agent?.observedTools ?? []);
  const workspaceSkillIds = normalizeCapabilityValues(workspace?.bootstrap.localSkillIds ?? []);
  const fallbackToolEntries = useMemo(
    () => [...OPENCLAW_BUILTIN_TOOL_CATALOG, ...OPENCLAW_TOOL_GROUP_CATALOG],
    []
  );

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!open || !agentId) {
      return;
    }

    const currentAgent = snapshotRef.current.agents.find((entry) => entry.id === agentId) ?? null;

    if (!currentAgent) {
      return;
    }

    const currentPresetMeta = getAgentPresetMeta(currentAgent.policy.preset);
    const nextSkills = normalizeCapabilityValues(
      currentAgent.skills.length > 0 ? currentAgent.skills : currentPresetMeta.skillIds
    );
    const nextTools = normalizeCapabilityValues(
      currentAgent.tools.filter((tool) => tool !== "fs.workspaceOnly").length > 0
        ? currentAgent.tools.filter((tool) => tool !== "fs.workspaceOnly")
        : currentPresetMeta.tools
    );

    setDraftSkills(nextSkills);
    setDraftTools(nextTools);
    setSkillInput("");
    setToolInput("");
    setError(null);
  }, [agentId, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    setCapabilityCatalogLoading(true);

    fetch("/api/openclaw/capabilities", { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as CapabilityCatalogResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load OpenClaw capability catalog.");
        }

        setCapabilityCatalog(payload);
        setCapabilityCatalogError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }

        setCapabilityCatalog(null);
        setCapabilityCatalogError(err instanceof Error ? err.message : "Unable to load OpenClaw capability catalog.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setCapabilityCatalogLoading(false);
        }
      });

    return () => controller.abort();
  }, [open]);

  const skillOptions = useMemo(
    () =>
      buildCapabilityOptions(
        [
          ...(capabilityCatalog?.skills ?? []).map((entry) => ({
            value: entry.name,
            label: entry.name,
            description: entry.description,
            sourceLabel: formatSkillSourceLabel(entry.source),
            sourceRank: entry.source === "openclaw-bundled" ? 0 : 1,
            kind: "skill" as const
          })),
          ...workspaceSkillIds.map((skillId) => ({
            value: skillId,
            label: skillId,
            description: "Workspace-local SKILL.md scaffold.",
            sourceLabel: "Workspace",
            sourceRank: 0,
            kind: "skill" as const,
            category: "workspace" as const
          })),
          ...draftSkills
            .filter((skillId) => !(capabilityCatalog?.skills ?? []).some((entry) => entry.name === skillId))
            .map((skillId) => ({
              value: skillId,
              label: skillId,
              description: "Already configured on this agent.",
              sourceLabel: "Current agent",
              sourceRank: 2,
              kind: "skill" as const,
              category: "custom" as const
            }))
        ],
        "skill"
      ),
    [capabilityCatalog?.skills, draftSkills, workspaceSkillIds]
  );

  const toolOptions = useMemo(
    () =>
      buildCapabilityOptions(
        [
          ...fallbackToolEntries.map((entry) => ({
            value: entry.name,
            label: entry.name,
            description: entry.description,
            sourceLabel: formatToolSourceLabel(entry),
            sourceRank: entry.category === "builtin" ? 0 : entry.category === "plugin" ? 1 : 2,
            kind: "tool" as const,
            category: entry.category
          })),
          ...draftTools
            .filter((toolId) => toolId !== "fs.workspaceOnly" && !(capabilityCatalog?.tools ?? []).some((entry) => entry.name === toolId))
            .map((toolId) => ({
              value: toolId,
              label: toolId,
              description: "Already configured on this agent.",
              sourceLabel: "Current agent",
              sourceRank: 3,
              kind: "tool" as const,
              category: "custom" as const
            })),
          ...observedTools
            .filter(
              (toolId) =>
                toolId !== "fs.workspaceOnly" &&
                !(capabilityCatalog?.tools ?? []).some((entry) => entry.name === toolId) &&
                !declaredTools.includes(toolId)
            )
            .map((toolId) => ({
              value: toolId,
              label: toolId,
              description: "Recovered from runtime transcripts.",
              sourceLabel: "Observed",
              sourceRank: 4,
              kind: "tool" as const,
              category: "custom" as const
            }))
        ],
        "tool"
      ),
    [capabilityCatalog?.tools, declaredTools, draftTools, fallbackToolEntries, observedTools]
  );

  const skillSuggestions = useMemo(
    () => filterCapabilityOptions(skillOptions, skillInput, draftSkills, Number.POSITIVE_INFINITY),
    [draftSkills, skillInput, skillOptions]
  );
  const toolSuggestions = useMemo(
    () => filterCapabilityOptions(toolOptions, toolInput, draftTools, Number.POSITIVE_INFINITY),
    [draftTools, toolInput, toolOptions]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    if (initialFocus === "skills") {
      skillInputRef.current?.focus();
      return;
    }

    toolInputRef.current?.focus();
  }, [initialFocus, open]);

  if (!agent) {
    return null;
  }

  const baselineSkills = isSkillsEditor ? effectiveSkills : declaredSkills;
  const baselineTools = isToolsEditor ? effectiveTools : declaredTools;
  const nextSkills = isSkillsEditor ? normalizeCapabilityValues(draftSkills) : declaredSkills;
  const nextTools = isToolsEditor ? normalizeCapabilityValues(draftTools) : declaredTools;
  const hasChanges =
    !areCapabilityListsEqual(nextSkills, baselineSkills) || !areCapabilityListsEqual(nextTools, baselineTools);
  const headerBadgeClassName =
    "h-5 border-white/[0.08] px-2 py-0 text-[10px] font-normal tracking-[0.06em] normal-case";

  const saveCapabilities = async () => {
    if (areCapabilityListsEqual(nextSkills, baselineSkills) && areCapabilityListsEqual(nextTools, baselineTools)) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body: {
        id: string;
        skills?: string[];
        tools?: string[];
      } = {
        id: agent.id
      };

      if (isSkillsEditor) {
        body.skills = nextSkills;
      } else {
        body.tools = nextTools;
      }

      const response = await fetch("/api/agents", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to update agent capabilities.");
      }

      onSnapshotChange?.((current) => updateSnapshotAgentCapabilities(current, agent.id, nextSkills, nextTools));
      toast.success("Agent capabilities updated.");
      onOpenChange(false);

      const refreshPromise = onRefresh?.();
      if (refreshPromise) {
        void refreshPromise.catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update agent capabilities.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(680px,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[24px] border-white/10 bg-[linear-gradient(180deg,rgba(7,10,18,0.98),rgba(4,7,14,0.98))] p-0">
        <div className="flex max-h-[calc(100dvh-1.5rem)] min-h-0 flex-col">
          <DialogHeader className="border-b border-white/[0.08] px-4 py-2.5">
            <DialogTitle className="text-[0.95rem]">{`Edit ${isSkillsEditor ? "skills" : "tools"} · ${formatAgentDisplayName(agent)}`}</DialogTitle>
            <div className="flex flex-wrap gap-1 pt-0.5">
              <Badge variant="muted" className={headerBadgeClassName}>
                {formatAgentPresetLabel(agent.policy.preset)}
              </Badge>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-4 py-4">
              <AgentCapabilityEditorColumn
                title={isSkillsEditor ? "Skills" : "Tools"}
                selectedValues={isSkillsEditor ? draftSkills : draftTools}
                selectedTone={isSkillsEditor ? "cyan" : "amber"}
                selectedEmptyLabel={isSkillsEditor ? "No explicit skills" : "No explicit tools configured"}
                lockedValues={isToolsEditor ? lockedTools : []}
                observedValues={isToolsEditor ? observedTools : []}
                inputRef={isSkillsEditor ? skillInputRef : toolInputRef}
                inputValue={isSkillsEditor ? skillInput : toolInput}
                onInputValueChange={isSkillsEditor ? setSkillInput : setToolInput}
                onRemove={(value) => {
                  if (isSkillsEditor) {
                    setDraftSkills((current) => current.filter((entry) => entry !== value));
                  } else {
                    setDraftTools((current) => current.filter((entry) => entry !== value));
                  }
                }}
                onPick={(value) => {
                  if (isSkillsEditor) {
                    setDraftSkills((current) => normalizeCapabilityValues([...current, value]));
                    setSkillInput("");
                  } else {
                    setDraftTools((current) => normalizeCapabilityValues([...current, value]));
                    setToolInput("");
                  }
                }}
                suggestions={isSkillsEditor ? skillSuggestions : toolSuggestions}
                emptySuggestionLabel={
                  capabilityCatalogLoading && (isSkillsEditor ? skillSuggestions.length : toolSuggestions.length) === 0
                    ? isSkillsEditor
                      ? "Loading OpenClaw skill catalog..."
                      : "Loading OpenClaw tool catalog..."
                    : isSkillsEditor
                      ? "No matching skills found."
                      : "No matching tools found."
                }
                loading={capabilityCatalogLoading}
                catalogError={capabilityCatalogError}
                helperLabel={
                  isSkillsEditor
                    ? "Workspace skills and OpenClaw skills are shown first in Available to add."
                    : "Built-ins, plugins, and groups are shown first in Available to add. Observed tools are read-only."
                }
                currentHintLabel={
                  isSkillsEditor
                    ? "Click × on a current skill to remove it."
                    : "Click × on a current tool to remove it."
                }
                highlight={true}
              />
            </div>

            {error ? (
              <div className="border-t border-white/[0.08] px-4 py-3">
                <p className="text-[12px] leading-5 text-rose-300">{error}</p>
              </div>
            ) : null}
          </div>

          <DialogFooter className="border-t border-white/[0.08] px-4 py-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="h-8 rounded-full px-2.5 text-[10px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void saveCapabilities();
              }}
              disabled={saving || !hasChanges}
              className="h-8 rounded-full px-2.5 text-[10px]"
            >
              {saving ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
