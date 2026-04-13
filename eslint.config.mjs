import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: ["**/.next/**", "packages/agentos/bundle/**", "deliverables/**"]
  },
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off"
    }
  }
];

export default config;
