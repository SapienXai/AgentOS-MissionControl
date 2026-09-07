import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  isTauriDesktopRuntime,
  openExternalAuthUrl
} from "@/lib/desktop/open-external-auth-url";

const authorizationUrl = "https://auth.openai.com/oauth/authorize?client_id=test&state=state-123";

test("automatic ChatGPT browser opening rejects arbitrary URLs before any opener", async () => {
  await assert.rejects(
    () => openExternalAuthUrl("https://example.com/oauth/authorize?state=state-123"),
    /invalid OpenAI authorization URL/
  );
  await assert.rejects(
    () => openExternalAuthUrl("javascript:alert(1)"),
    /invalid OpenAI authorization URL/
  );
});
test("browser builds keep a safe window.open fallback", async () => {
  const originalWindow = globalThis.window;
  const opened: string[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      open: (url: string) => {
        opened.push(url);
        return {};
      }
    }
  });

  try {
    assert.equal(isTauriDesktopRuntime(), false);
    assert.equal(await openExternalAuthUrl(authorizationUrl), "browser");
    assert.deepEqual(opened, [authorizationUrl]);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow
      });
    }
  }
});

test("packaged desktop builds route the validated URL through the narrow Tauri command", async () => {
  const originalWindow = globalThis.window;
  const calls: Array<{ command: string; args: unknown }> = [];
  const tauriAuthorizationUrl = "https://auth.openai.com/oauth/authorize?client_id=tauri&state=state-123";

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: unknown) => {
          calls.push({ command, args });
        }
      }
    }
  });

  try {
    assert.equal(isTauriDesktopRuntime(), true);
    assert.equal(await openExternalAuthUrl(tauriAuthorizationUrl), "tauri");
    assert.deepEqual(calls, [
      {
        command: "open_external_auth_url",
        args: { url: tauriAuthorizationUrl }
      }
    ]);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow
      });
    }
  }
});

test("duplicate attempts for one authorization URL share one browser open", async () => {
  const originalWindow = globalThis.window;
  const calls: string[] = [];
  const deduplicatedAuthorizationUrl = "https://auth.openai.com/oauth/authorize?client_id=dedupe&state=state-123";

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (_command: string, args: { url: string }) => {
          calls.push(args.url);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
    }
  });

  try {
    assert.deepEqual(
      await Promise.all([
        openExternalAuthUrl(deduplicatedAuthorizationUrl),
        openExternalAuthUrl(deduplicatedAuthorizationUrl)
      ]),
      ["tauri", "tauri"]
    );
    assert.deepEqual(calls, [deduplicatedAuthorizationUrl]);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow
      });
    }
  }
});

test("Tauri navigation keeps the general external opener separate from the auth command", async () => {
  const source = await readFile(join(process.cwd(), "apps/desktop/src-tauri/src/main.rs"), "utf8");

  assert.match(source, /generate_handler!\[open_external_auth_url\]/);
  assert.match(source, /app\.opener\(\)\.open_url\(parsed\.as_str\(\), None::<&str>\)/);
  assert.match(source, /Only the OpenAI authorization endpoint may be opened automatically/);
  assert.match(source, /fn is_external_web_url\(url: &tauri::Url\)/);
});
