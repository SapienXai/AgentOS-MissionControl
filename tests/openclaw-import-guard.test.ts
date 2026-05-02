import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { ESLint } from "eslint";

async function lintServiceImport(filePath: string) {
  const eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: path.join(process.cwd(), "eslint.config.mjs")
  });
  const [result] = await eslint.lintText(
    `import { submitMission } from "@/lib/openclaw/service";

submitMission({ mission: "ship it" });
`,
    { filePath: path.join(process.cwd(), filePath) }
  );

  return result.messages.filter((message) => message.ruleId === "no-restricted-imports");
}

test("OpenClaw service import guard blocks production imports without duplicate noise", async () => {
  const messages = await lintServiceImport("lib/example-production-import.ts");

  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /legacy compatibility entrypoint/);
});

test("OpenClaw service import guard allows compatibility tests", async () => {
  const messages = await lintServiceImport("tests/example-compatibility-import.ts");

  assert.deepEqual(messages, []);
});
