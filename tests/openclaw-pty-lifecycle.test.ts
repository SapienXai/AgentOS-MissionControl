import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { assertOAuthCallbackAvailable } from "@/lib/openclaw/application/oauth-callback-availability";

test("occupied callback port blocks a new OAuth attempt until released", async () => {
  const server = createServer((socket) => socket.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(assertOAuthCallbackAvailable(address.port), /Another sign-in/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await assertOAuthCallbackAvailable(address.port);
});

for (const termination of ["SIGTERM", "owner-pipe-closed"] as const) {
  test(`PTY ${termination} releases a real descendant callback listener`, {
    skip: process.platform !== "darwin",
    timeout: 10_000
  }, async () => {
    // The listener ignores TERM to exercise escalation, not just cooperative exit.
    const listener = "import signal,socket,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); print(s.getsockname()[1],flush=True); time.sleep(60)";
    const wrapper = `import signal,subprocess; signal.signal(signal.SIGTERM,signal.SIG_IGN); subprocess.run(['/usr/bin/python3','-c',${JSON.stringify(listener)}])`;
    const child = spawn("/usr/bin/python3", ["scripts/openclaw-pty-runner.py", "/usr/bin/python3", "-c", wrapper], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const closed = once(child, "close");
    try {
      const [chunk] = await once(child.stdout, "data");
      const port = Number(String(chunk).trim());
      assert.ok(port > 0);
      await assert.rejects(assertOAuthCallbackAvailable(port), /Another sign-in/);
      if (termination === "SIGTERM") child.kill("SIGTERM");
      else child.stdin.end();
      await closed;
      await assertOAuthCallbackAvailable(port);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await closed;
    }
  });
}
