import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: ["**/.next/**", "packages/agentos/bundle/**", "deliverables/**"]
  },
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["lib/openclaw/service.ts", "tests/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/openclaw/service",
              message:
                "Use the OpenClaw application service, adapter, client, or domain module directly. service.ts is a legacy compatibility entrypoint."
            }
          ],
          patterns: [
            {
              group: [
                "./service",
                "../service",
                "./**/openclaw/service",
                "../**/openclaw/service",
                "./**/lib/openclaw/service",
                "../**/lib/openclaw/service"
              ],
              message:
                "Use the OpenClaw application service, adapter, client, or domain module directly. service.ts is a legacy compatibility entrypoint."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off"
    }
  }
];

export default config;
