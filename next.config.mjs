import os from "node:os";

const defaultAllowedDevOrigins = [
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  ...readLocalNetworkHosts()
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: defaultAllowedDevOrigins,
  // OpenClaw's official Gateway client owns its Node WebSocket dependency and
  // resolves it from its package boundary. Keep that native client external
  // so Turbopack does not rewrite its runtime resolver into a build-machine
  // absolute path.
  serverExternalPackages: ["@openclaw/gateway-client"],
  output: "standalone",
  async headers() {
    return [
      {
        source: "/accounts/browser-live",
        headers: secureBrowserHeaders()
      },
      {
        source: "/novnc/:path*",
        headers: secureBrowserHeaders()
      },
      {
        source: "/secure-browser-client.:extension(html|js)",
        headers: secureBrowserHeaders()
      }
    ];
  },
  outputFileTracingExcludes: {
    "/*": [
      "./AGENTS.md",
      "./README.md",
      "./docs/**/*",
      "./deliverables/**/*",
      "./eslint.config.mjs",
      "./next-env.d.ts",
      "./next.config.mjs",
      "./pnpm-lock.yaml",
      "./pnpm-workspace.yaml",
      "./tailwind.config.ts",
      "./tests/**/*",
      "./tsconfig.json"
    ]
  }
};

export default nextConfig;

function secureBrowserHeaders() {
  return [
    { key: "Cache-Control", value: "no-store" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), clipboard-write=()"
    }
  ];
}

function readLocalNetworkHosts() {
  const hosts = [];

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4" || !entry.address) {
        continue;
      }

      hosts.push(entry.address);
    }
  }

  return Array.from(new Set(hosts));
}
