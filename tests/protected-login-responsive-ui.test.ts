import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const rootDir = process.cwd();

test("protected login keeps mobile status quiet and content comfortably inset", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/protected-login.tsx"), "utf8");

  assert.match(source, /hidden items-center gap-2[^\n]+sm:flex[\s\S]*?Instance locked/);
  assert.equal(source.match(/px-5 py-5 sm:px-8/g)?.length, 1);
  assert.match(source, /min-h-\[calc\(100dvh-80px\)\]/);
});

test("protected login title scales down fluidly on small screens", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/protected-login.tsx"), "utf8");

  assert.match(source, /text-\[clamp\(1\.8rem,8\.5vw,2\.2rem\)\]/);
  assert.match(source, /sm:text-\[2\.5rem\]/);
  assert.match(source, /lg:text-\[2\.7rem\]/);
});

test("protected login uses Piko while checking instance protection", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/protected-login.tsx"), "utf8");

  assert.match(source, /function AuthSplash\(\)[\s\S]*?<PikoLoader\s+open\s+title="Checking protection"/);
  assert.match(source, /description="Confirming this session can access AgentOS\."/);
  assert.match(source, /aria-busy="true" aria-label="Checking protection"/);
});

test("protected login composes a theme-aware glass access card", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/protected-login.tsx"), "utf8");
  const styles = await readFile(path.join(rootDir, "app/globals.css"), "utf8");

  assert.match(source, /<Card className="lock-glass-card/);
  assert.match(source, /<CardHeader[^>]+lock-glass-divider/);
  assert.match(source, /<CardContent/);
  assert.match(source, /<CardFooter/);
  assert.equal(source.match(/className="lock-glass-input/g)?.length, 2);
  assert.match(source, /data-lock-sky-tone=\{skyTone\}/);
  assert.match(styles, /\.lock-screen\[data-lock-sky-tone="day"\]/);
  assert.match(styles, /--lock-glass-surface-alpha: 0\.56/);
  assert.match(styles, /--lock-glass-foreground: 31 38 43/);
  assert.match(styles, /--lock-glass-foreground: 244 248 248/);
  assert.match(styles, /backdrop-filter: blur\(12px\) saturate\(1\.12\)/);
  assert.match(styles, /\.lock-glass-input:focus-visible/);
  assert.match(source, /className="lock-glass-chip/);
  assert.match(styles, /\.lock-glass-chip \{/);
  assert.match(source, /className="lock-avatar-frame/);
  assert.match(source, /className="lock-orbit/);
});

test("celestial moon renders as a complete luminous sphere", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/celestial-lock-background.tsx"), "utf8");

  assert.match(source, /data-celestial-body="moon"/);
  assert.match(source, /#ffffff_0%,#f4f7f8_30%,#dbe4e8_65%,#aebfc8_100%/);
  assert.doesNotMatch(source, /after:bg-\[#101b38\]/);
});

test("celestial stars twinkle in independent reduced-motion-aware layers", async () => {
  const source = await readFile(path.join(rootDir, "components/auth/celestial-lock-background.tsx"), "utf8");

  assert.match(source, /BRIGHT_STAR_FIELD/);
  assert.match(source, /SOFT_STAR_FIELD/);
  assert.ok((source.match(/animate=\{reduceMotion \|\| !sky \? undefined/g) ?? []).length >= 3);
  assert.match(source, /duration: 10/);
  assert.match(source, /duration: 14/);
  assert.doesNotMatch(source, /FINE_STAR_FIELD|FINE_STAR_SIZES|FINE_STAR_POSITIONS/);
});
