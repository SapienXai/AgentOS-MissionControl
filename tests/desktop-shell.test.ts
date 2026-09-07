import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

test("desktop capability grants only the native drag permission", async () => {
  const capability = JSON.parse(
    await readFile(
      join(repoRoot, "apps/desktop/src-tauri/capabilities/default.json"),
      "utf8"
    )
  ) as { windows: string[]; permissions: string[] };

  assert.deepEqual(capability.windows, ["main"]);
  assert.deepEqual(capability.permissions, ["core:window:allow-start-dragging"]);
});

test("desktop startup keeps the main window hidden until the splash gate is ready", async () => {
  const source = await readFile(join(repoRoot, "apps/desktop/src-tauri/src/main.rs"), "utf8");

  assert.match(source, /\.visible\(cfg!\(debug_assertions\)\)/);
  assert.match(source, /WebviewWindowBuilder::new\(app, "splash", WebviewUrl::App\("index\.html"\.into\(\)\)\)/);
  assert.match(source, /\.decorations\(false\)/);
  assert.match(source, /\.center\(\)/);
  assert.match(source, /\.prevent_overflow_with_margin\(LogicalSize::new\(24\.0, 24\.0\)\)/);
  assert.match(source, /reveal_main_window\(&window\)/);
  assert.match(source, /const MAIN_NAVIGATION_TIMEOUT: Duration = Duration::from_secs\(20\)/);
  assert.match(source, /watch_main_navigation\(app\.clone\(\), window\.clone\(\)\)/);
});

test("desktop shell uses native macOS overlay titlebar without replacing traffic lights", async () => {
  const source = await readFile(join(repoRoot, "apps/desktop/src-tauri/src/main.rs"), "utf8");
  const mainWindowSource = source.slice(
    source.indexOf("fn build_main_window"),
    source.indexOf("#[cfg(not(debug_assertions))]\nfn build_splash_window")
  );

  assert.match(mainWindowSource, /\.title_bar_style\(tauri::TitleBarStyle::Overlay\)/);
  assert.match(mainWindowSource, /\.hidden_title\(true\)/);
  assert.match(mainWindowSource, /\.traffic_light_position\(LogicalPosition::new\(16\.0, 12\.0\)\)/);
  assert.doesNotMatch(mainWindowSource, /\.decorations\(false\)/);
});

test("declared drag regions stay on shell surfaces instead of the sidebar controls", async () => {
  const [topbar, shell, onboarding, sidebar] = await Promise.all([
    readFile(join(repoRoot, "components/mission-control/mission-control-shell.topbar.tsx"), "utf8"),
    readFile(join(repoRoot, "components/mission-control/mission-control-shell.tsx"), "utf8"),
    readFile(join(repoRoot, "components/mission-control/openclaw-onboarding.tsx"), "utf8"),
    readFile(join(repoRoot, "components/mission-control/sidebar.tsx"), "utf8")
  ]);

  assert.match(topbar, /data-tauri-drag-region="deep"/);
  assert.match(shell, /data-tauri-drag-region="deep"/);
  assert.match(onboarding, /data-tauri-drag-region="deep"/);
  assert.match(sidebar, /agentos-sidebar-surface/);
  assert.match(onboarding, /agentos-titlebar-surface/);
  assert.doesNotMatch(sidebar, /data-tauri-drag-region/);
});
