import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PIKO_VIDEO_SOURCES,
  resolvePikoVideoPlatform,
  resolvePikoVideoSource
} from "@/lib/ui/piko-video-source";

test("Piko selects the macOS alpha asset and Chromium selects WebM alpha", () => {
  assert.equal(resolvePikoVideoPlatform({ platform: "MacIntel" }), "macos");
  assert.equal(resolvePikoVideoPlatform({ userAgentDataPlatform: "macOS" }), "macos");
  assert.equal(resolvePikoVideoPlatform({ platform: "Win32" }), "chromium");
  assert.equal(resolvePikoVideoPlatform({ platform: "Linux x86_64" }), "chromium");
  assert.equal(resolvePikoVideoSource("macos")?.src, PIKO_VIDEO_SOURCES.macos.src);
  assert.equal(resolvePikoVideoSource("chromium")?.src, PIKO_VIDEO_SOURCES.chromium.src);
});

test("Piko falls back when the selected transparent video cannot play", () => {
  assert.equal(resolvePikoVideoSource("macos", () => ""), null);
  assert.equal(resolvePikoVideoSource("chromium", () => ""), null);
  assert.equal(resolvePikoVideoSource("other"), null);
});

test("Piko renders the static spinner after a transparent-video error", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("components/ui/piko-loader.tsx", "utf8");

  assert.match(source, /onError=\{\(\) => setVideoFailedSource\(videoSource\.src\)\}/);
  assert.match(source, /videoSource && !videoFailed/);
  assert.match(source, /<LoaderCircle className=.*animate-spin/);
});

test("desktop bootstrap keeps the Piko startup surface asset-backed", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("apps/desktop/bootstrap/index.html", "utf8");

  assert.match(source, /pikoLoader\.hevc\.mov/);
  assert.match(source, /pikoLoader\.webm/);
  assert.match(source, /showFallback/);
});
