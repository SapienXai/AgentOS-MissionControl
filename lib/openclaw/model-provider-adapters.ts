"use client";

import {
  getModelProviderDescriptor,
  modelProviderRegistry,
  type ModelProviderDescriptor
} from "@/lib/openclaw/model-provider-registry";
import type {
  AddModelsProviderActionRequest,
  AddModelsProviderActionResult,
  AddModelsProviderId
} from "@/lib/openclaw/types";

export type ModelProviderAdapter = {
  id: AddModelsProviderId;
  descriptor: ModelProviderDescriptor;
  getConnectionStatus: () => Promise<AddModelsProviderActionResult>;
  connect: (input?: { apiKey?: string; endpoint?: string }) => Promise<AddModelsProviderActionResult>;
  discoverModels: () => Promise<AddModelsProviderActionResult>;
  addModels: (modelIds: string[]) => Promise<AddModelsProviderActionResult>;
};

async function runProviderAction(
  request: AddModelsProviderActionRequest
): Promise<AddModelsProviderActionResult> {
  const response = await fetch("/api/models/providers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });

  const result = (await response.json().catch(() => null)) as
    | (AddModelsProviderActionResult & { error?: string })
    | null;

  if (!response.ok || !result) {
    throw new Error(result?.error || result?.message || "Model provider request failed.");
  }

  if (!result.ok && result.message) {
    throw new Error(result.message);
  }

  return result;
}

function createModelProviderAdapter(providerId: AddModelsProviderId): ModelProviderAdapter {
  return {
    id: providerId,
    descriptor: getModelProviderDescriptor(providerId),
    getConnectionStatus: () =>
      runProviderAction({
        action: "status",
        provider: providerId
      }),
    connect: (input) =>
      runProviderAction({
        action: "connect",
        provider: providerId,
        apiKey: input?.apiKey?.trim() ? input.apiKey.trim() : undefined,
        endpoint: input?.endpoint?.trim() ? input.endpoint.trim() : undefined
      }),
    discoverModels: () =>
      runProviderAction({
        action: "discover",
        provider: providerId
      }),
    addModels: (modelIds) =>
      runProviderAction({
        action: "add-models",
        provider: providerId,
        modelIds
      })
  };
}

export const modelProviderAdapters = Object.fromEntries(
  modelProviderRegistry.map((provider) => [provider.id, createModelProviderAdapter(provider.id)])
) as Record<AddModelsProviderId, ModelProviderAdapter>;

export function getModelProviderAdapter(providerId: AddModelsProviderId) {
  return modelProviderAdapters[providerId];
}
