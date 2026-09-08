import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PIKO_VIDEO_SOURCES,
  resolvePikoBrowserVideoPlatform,
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

test("Piko keeps macOS Chrome on WebM and reserves HEVC for Apple WebKit", () => {
  const chromeOnMac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const safariOnMac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/18.6 Safari/605.1.15";

  assert.equal(resolvePikoBrowserVideoPlatform({ userAgent: chromeOnMac, canPlayHevc: true }), "chromium");
  assert.equal(resolvePikoBrowserVideoPlatform({ userAgent: safariOnMac, canPlayHevc: true }), "macos");
  assert.equal(resolvePikoBrowserVideoPlatform({ userAgent: safariOnMac, canPlayHevc: false }), "other");
});

test("Piko falls back when the selected transparent video cannot play", () => {
  assert.equal(resolvePikoVideoSource("macos", () => "")?.src, PIKO_VIDEO_SOURCES.macos.src);
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

test("every Piko surface uses the generated macOS alpha asset", async () => {
  const { readFile, stat } = await import("node:fs/promises");
  const [source, loader, bootstrap] = await Promise.all([
    readFile("lib/ui/piko-video-source.ts", "utf8"),
    readFile("components/ui/piko-loader.tsx", "utf8"),
    readFile("apps/desktop/bootstrap/index.html", "utf8")
  ]);

  assert.match(source, /src: "\/assets\/pikoLoader\.hevc\.mov"/);
  assert.match(loader, /resolveRuntimePikoVideoSource/);
  assert.match(bootstrap, /\/assets\/pikoLoader\.hevc\.mov/);
  assert.ok((await stat("public/assets/pikoLoader.hevc.mov")).size > 0);
});

test("the macOS alpha generator preserves enclosed dark pixels through edge flood fill", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("scripts/desktop/generate-piko-hevc-alpha.mjs", "utf8");

  assert.match(source, /color 0,0 floodfill/);
  assert.match(source, /hevc_videotoolbox/);
  assert.match(source, /alpha_quality/);
  assert.match(source, /pikoLoader\.hevc\.mov/);
});
