/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      "./AGENTS.md",
      "./README.md",
      "./docs/**/*",
      "./eslint.config.mjs",
      "./next-env.d.ts",
      "./next.config.mjs",
      "./package-lock.json",
      "./pnpm-lock.yaml",
      "./pnpm-workspace.yaml",
      "./tailwind.config.ts",
      "./tests/**/*",
      "./tsconfig.json"
    ]
  }
};

export default nextConfig;
