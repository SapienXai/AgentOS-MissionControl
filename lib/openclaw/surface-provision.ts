import type { MissionControlSurfaceProvider } from "@/lib/openclaw/types";
import type { SurfaceCatalogEntry, SurfaceProvisionField } from "@/lib/openclaw/surface-catalog";

export function getProvisionDraftText(draft: Record<string, string | boolean>, key: string) {
  const value = draft[key];
  return typeof value === "string" ? value : "";
}

export function buildEmptyProvisionDraft(entry: SurfaceCatalogEntry) {
  const draft: Record<string, string | boolean> = {
    name: ""
  };

  for (const field of entry.provisionFields) {
    if (typeof field.defaultValue === "boolean") {
      draft[field.key] = field.defaultValue;
      continue;
    }

    if (typeof field.defaultValue === "string") {
      draft[field.key] = field.defaultValue;
      continue;
    }

    draft[field.key] = field.inputType === "checkbox" ? false : "";
  }

  return draft;
}

export function isProvisionFieldSatisfied(field: SurfaceProvisionField, draft: Record<string, string | boolean>) {
  if (!field.required) {
    return true;
  }

  const value = draft[field.key];

  if (field.inputType === "checkbox") {
    return value === true;
  }

  if (field.inputType === "number") {
    return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value.trim()));
  }

  return typeof value === "string" && value.trim().length > 0;
}

export function buildProvisionConfig(fields: SurfaceProvisionField[], draft: Record<string, string | boolean>) {
  const config: Record<string, unknown> = {};

  for (const field of fields) {
    const value = draft[field.key];
    let nextValue: unknown;

    if (field.inputType === "checkbox") {
      nextValue = Boolean(value);
    } else if (field.inputType === "number") {
      const parsed = typeof value === "string" ? Number(value.trim()) : Number(value);
      if (!Number.isFinite(parsed)) {
        continue;
      }
      nextValue = parsed;
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        continue;
      }
      nextValue = parseProvisionTextValue(trimmed);
    } else {
      continue;
    }

    setConfigValue(config, field.key, nextValue);
  }

  return config;
}

export function getProvisionConfigPath(provider: MissionControlSurfaceProvider) {
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
      return provider;
  }
}

function setConfigValue(config: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split(".").filter(Boolean);
  if (parts.length <= 1) {
    config[key] = value;
    return;
  }

  let target = config;
  for (const part of parts.slice(0, -1)) {
    const current = target[part];
    if (!isPlainRecord(current)) {
      target[part] = {};
    }
    target = target[part] as Record<string, unknown>;
  }

  target[parts[parts.length - 1]!] = value;
}

function parseProvisionTextValue(value: string) {
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
