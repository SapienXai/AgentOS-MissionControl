import type {
  ChannelAccountRecord,
  MissionControlSurfaceKind,
  MissionControlSurfaceProvider
} from "@/lib/openclaw/types";

export type SurfaceProvisionField = {
  key: string;
  label: string;
  placeholder?: string;
  inputType?: "text" | "password" | "url" | "number" | "textarea" | "checkbox" | "select";
  secret?: boolean;
  required?: boolean;
  defaultValue?: string | boolean;
  helpText?: string;
  section?: "basic" | "advanced";
  options?: Array<{
    label: string;
    value: string;
  }>;
};

export type SurfaceCatalogEntry = {
  provider: MissionControlSurfaceProvider;
  label: string;
  kind: MissionControlSurfaceKind;
  description: string;
  iconKey?: string;
  accentColor?: string;
  supportsProvisioning: boolean;
  provisionFields: SurfaceProvisionField[];
  supportsRouteDiscovery: boolean;
  providerManagedByOpenClaw: boolean;
};

export const OPENCLAW_SURFACE_CATALOG: SurfaceCatalogEntry[] = [
  {
    provider: "telegram",
    label: "Telegram",
    kind: "chat",
    description: "Bot accounts, public groups, and delegated community routing.",
    iconKey: "siTelegram",
    accentColor: "#26A5E4",
    supportsProvisioning: true,
    provisionFields: [
      {
        key: "token",
        label: "Bot token",
        placeholder: "123456:ABC...",
        inputType: "password",
        secret: true,
        required: true,
        section: "basic"
      }
    ],
    supportsRouteDiscovery: true,
    providerManagedByOpenClaw: true
  },
  {
    provider: "discord",
    label: "Discord",
    kind: "chat",
    description: "Servers, channels, DMs, and thread-aware team routing.",
    iconKey: "siDiscord",
    accentColor: "#5865F2",
    supportsProvisioning: true,
    provisionFields: [
      {
        key: "token",
        label: "Bot token",
        placeholder: "Discord bot token",
        inputType: "password",
        secret: true,
        required: true,
        section: "basic"
      }
    ],
    supportsRouteDiscovery: true,
    providerManagedByOpenClaw: true
  },
  {
    provider: "slack",
    label: "Slack",
    kind: "chat",
    description: "Workspace apps, channels, and internal team handoffs.",
    iconKey: "siSlack",
    accentColor: "#4A154B",
    supportsProvisioning: true,
    provisionFields: [
      {
        key: "botToken",
        label: "Bot token",
        placeholder: "xoxb-...",
        inputType: "password",
        secret: true,
        required: true,
        section: "basic"
      }
    ],
    supportsRouteDiscovery: false,
    providerManagedByOpenClaw: true
  },
  {
    provider: "googlechat",
    label: "Google Chat",
    kind: "chat",
    description: "Spaces and enterprise chat surfaces backed by OpenClaw.",
    iconKey: "siGooglechat",
    accentColor: "#34A853",
    supportsProvisioning: true,
    provisionFields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://chat.googleapis.com/...",
        inputType: "url",
        secret: true,
        required: true,
        section: "basic"
      }
    ],
    supportsRouteDiscovery: false,
    providerManagedByOpenClaw: true
  },
  {
    provider: "gmail",
    label: "Gmail",
    kind: "inbox",
    description: "Inbox ownership, draft/send workflows, and Gmail-triggered automations.",
    iconKey: "siGmail",
    accentColor: "#EA4335",
    supportsProvisioning: true,
    provisionFields: [
      {
        key: "account",
        label: "Account email",
        placeholder: "agent@example.com",
        inputType: "text",
        required: true,
        section: "basic"
      },
      {
        key: "project",
        label: "Project ID",
        placeholder: "openclaw-project",
        section: "basic"
      },
      {
        key: "label",
        label: "Label",
        placeholder: "inbox",
        section: "basic"
      },
      {
        key: "hookToken",
        label: "Hook token",
        placeholder: "shared-secret",
        inputType: "password",
        secret: true,
        section: "basic"
      },
      {
        key: "hookUrl",
        label: "Hook URL",
        placeholder: "https://your-host.example/gmail-pubsub",
        inputType: "url",
        section: "advanced"
      },
      {
        key: "topic",
        label: "Topic",
        placeholder: "gmail-topic",
        section: "advanced"
      },
      {
        key: "subscription",
        label: "Subscription",
        placeholder: "gmail-subscription",
        section: "advanced"
      },
      {
        key: "pushToken",
        label: "Push token",
        placeholder: "push-secret",
        inputType: "password",
        secret: true,
        section: "advanced"
      },
      {
        label: "Serve port",
        placeholder: "8788",
        key: "serve.port",
        inputType: "number",
        section: "advanced"
      },
      {
        key: "serve.bind",
        label: "Serve bind",
        placeholder: "127.0.0.1",
        section: "advanced"
      },
      {
        key: "serve.path",
        label: "Serve path",
        placeholder: "/",
        section: "advanced"
      },
      {
        key: "includeBody",
        label: "Include body",
        inputType: "checkbox",
        defaultValue: true,
        section: "advanced"
      },
      {
        key: "maxBytes",
        label: "Max bytes",
        placeholder: "20000",
        inputType: "number",
        section: "advanced"
      },
      {
        key: "renewEveryMinutes",
        label: "Renew interval (minutes)",
        placeholder: "720",
        inputType: "number",
        section: "advanced"
      },
      {
        key: "tailscale.mode",
        label: "Tailscale mode",
        placeholder: "funnel",
        defaultValue: "funnel",
        inputType: "select",
        options: [
          { label: "Off", value: "off" },
          { label: "Serve", value: "serve" },
          { label: "Funnel", value: "funnel" }
        ],
        helpText: "One of funnel, serve, or off.",
        section: "advanced"
      },
      {
        key: "tailscale.path",
        label: "Tailscale path",
        placeholder: "/gmail-pubsub",
        section: "advanced"
      },
      {
        key: "tailscale.target",
        label: "Tailscale target",
        placeholder: "http://127.0.0.1:8788/gmail-pubsub",
        inputType: "url",
        section: "advanced"
      },
      {
        key: "pushEndpoint",
        label: "Push endpoint",
        placeholder: "https://public.example/gmail-push",
        inputType: "url",
        section: "advanced"
      },
      {
        key: "model",
        label: "Model",
        placeholder: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
        section: "advanced"
      },
      {
        key: "thinking",
        label: "Thinking",
        placeholder: "off",
        section: "advanced"
      }
    ],
    supportsRouteDiscovery: false,
    providerManagedByOpenClaw: true
  },
  {
    provider: "email",
    label: "Email",
    kind: "inbox",
    description: "Generic email inboxes and send/read workflows exposed through OpenClaw.",
    iconKey: "siMaildotru",
    accentColor: "#0F172A",
    supportsProvisioning: true,
    provisionFields: [
      {
        key: "address",
        label: "Address",
        placeholder: "inbox@example.com",
        inputType: "text",
        required: true,
        section: "basic"
      },
      {
        key: "oauth",
        label: "OAuth config",
        placeholder: '{"clientId":"...","clientSecret":"..."}',
        inputType: "textarea",
        helpText: "Paste JSON or a provider-specific OAuth configuration blob.",
        section: "basic"
      },
      {
        key: "watch",
        label: "Watch",
        inputType: "checkbox",
        defaultValue: true,
        section: "basic"
      },
      {
        key: "pubsub",
        label: "Pub/Sub",
        placeholder: "projects/project-id/topics/email-events",
        section: "basic"
      },
      {
        key: "imap.host",
        label: "IMAP host",
        placeholder: "imap.example.com",
        inputType: "text",
        section: "advanced"
      },
      {
        key: "imap.port",
        label: "IMAP port",
        placeholder: "993",
        inputType: "number",
        section: "advanced"
      },
      {
        key: "smtp.host",
        label: "SMTP host",
        placeholder: "smtp.example.com",
        inputType: "text",
        section: "advanced"
      },
      {
        key: "smtp.port",
        label: "SMTP port",
        placeholder: "587",
        inputType: "number",
        section: "advanced"
      },
      {
        key: "username",
        label: "Username",
        placeholder: "mailbox-user",
        inputType: "text",
        section: "advanced"
      },
      {
        key: "password",
        label: "Password",
        placeholder: "app password",
        inputType: "password",
        secret: true,
        section: "advanced"
      }
    ],
    supportsRouteDiscovery: false,
    providerManagedByOpenClaw: true
  },
  {
    provider: "webhook",
    label: "Webhook",
    kind: "trigger",
    description: "External event triggers delivered into OpenClaw automations.",
    iconKey: "siWebhook",
    accentColor: "#0EA5E9",
    supportsProvisioning: true,
    provisionFields: [
      {
        key: "token",
        label: "Hook token",
        placeholder: "shared-secret",
        inputType: "password",
        secret: true,
        required: true,
        section: "basic"
      },
      {
        key: "path",
        label: "Path",
        placeholder: "/hooks",
        section: "basic"
      }
    ],
    supportsRouteDiscovery: false,
    providerManagedByOpenClaw: true
  },
  {
    provider: "cron",
    label: "Cron",
    kind: "trigger",
    description: "Scheduled tasks and recurring automation entry points.",
    iconKey: "siClockify",
    accentColor: "#F59E0B",
    supportsProvisioning: true,
    provisionFields: [
      {
        key: "webhookToken",
        label: "Webhook token",
        placeholder: "replace-with-dedicated-webhook-token",
        inputType: "password",
        secret: true,
        required: true,
        section: "basic"
      },
      {
        key: "sessionRetention",
        label: "Session retention",
        placeholder: "24h",
        section: "basic"
      },
      {
        key: "maxConcurrentRuns",
        label: "Max concurrent runs",
        placeholder: "1",
        inputType: "number",
        section: "basic"
      },
      {
        key: "store",
        label: "Store path",
        placeholder: "~/.openclaw/cron/jobs.json",
        section: "advanced"
      },
      {
        key: "runLog.maxBytes",
        label: "Run log max bytes",
        placeholder: "2mb",
        section: "advanced"
      },
      {
        key: "runLog.keepLines",
        label: "Run log keep lines",
        placeholder: "2000",
        inputType: "number",
        section: "advanced"
      }
    ],
    supportsRouteDiscovery: false,
    providerManagedByOpenClaw: true
  }
];

const surfaceCatalogByProvider = new Map(
  OPENCLAW_SURFACE_CATALOG.map((entry) => [entry.provider, entry] as const)
);

export function getSurfaceCatalogEntry(provider: MissionControlSurfaceProvider) {
  return (
    surfaceCatalogByProvider.get(provider) ?? {
      provider,
      label: formatSurfaceProviderLabel(provider),
      kind: "chat",
      description: "OpenClaw-managed integration surface.",
      supportsProvisioning: false,
      provisionFields: [],
      supportsRouteDiscovery: false,
      providerManagedByOpenClaw: true
    }
  );
}

export function formatSurfaceProviderLabel(provider: MissionControlSurfaceProvider) {
  const known = surfaceCatalogByProvider.get(provider);
  if (known) {
    return known.label;
  }

  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getSurfaceKind(provider: MissionControlSurfaceProvider): MissionControlSurfaceKind {
  return getSurfaceCatalogEntry(provider).kind;
}

export function sortSurfaceAccounts(accounts: ChannelAccountRecord[]) {
  return [...accounts].sort((left, right) => {
    const leftEntry = getSurfaceCatalogEntry(left.type);
    const rightEntry = getSurfaceCatalogEntry(right.type);

    if (leftEntry.kind !== rightEntry.kind) {
      return leftEntry.kind.localeCompare(rightEntry.kind);
    }

    if (left.type !== right.type) {
      return formatSurfaceProviderLabel(left.type).localeCompare(formatSurfaceProviderLabel(right.type));
    }

    return left.name.localeCompare(right.name);
  });
}
