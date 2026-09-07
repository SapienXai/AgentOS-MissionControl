import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseSha256Manifest,
  sha256File,
  verifySha256File
} from "../scripts/desktop/runtime.mjs";

const archiveName = "node-v24.15.0-darwin-arm64.tar.gz";

test("accepts a valid official checksum manifest entry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-desktop-integrity-"));
  const archivePath = path.join(root, archiveName);
  await writeFile(archivePath, "verified node archive");

  try {
    const checksum = await sha256File(archivePath);
    const manifest = `${checksum}  ${archiveName}\n`;
    assert.equal(parseSha256Manifest(manifest, archiveName), checksum);
    await verifySha256File(archivePath, checksum);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an invalid checksum", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-desktop-integrity-"));
  const archivePath = path.join(root, archiveName);
  await writeFile(archivePath, "corrupted node archive");

  try {
    await assert.rejects(
      verifySha256File(archivePath, "0".repeat(64)),
      /SHA-256 checksum mismatch/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a missing checksum manifest entry", () => {
  assert.equal(
    parseSha256Manifest(`${"a".repeat(64)}  node-v24.15.0-linux-x64.tar.gz\n`, archiveName),
    null
  );
});

test("rejects a malformed checksum entry for the selected archive", () => {
  assert.throws(
    () => parseSha256Manifest(`not-a-checksum  ${archiveName}\n`, archiveName),
    /Malformed SHA-256 checksum entry/
  );
});

test("detects a corrupted cached archive before reuse", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-desktop-cache-"));
  const archivePath = path.join(root, archiveName);
  await writeFile(archivePath, "trusted cached archive");

  try {
    const checksum = await sha256File(archivePath);
    await writeFile(archivePath, "tampered cached archive");
    await assert.rejects(verifySha256File(archivePath, checksum), /SHA-256 checksum mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
