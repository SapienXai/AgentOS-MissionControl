import { createConnection } from "node:net";

// OpenClaw 2026.9.3 falls back to manual input on bind failure but still opens
// the browser. A stale listener would then receive the new session's callback.
// Probe both loopback families without sending any HTTP or OAuth data.
export async function assertOAuthCallbackAvailable(port = 1455) {
  await Promise.all(["127.0.0.1", "::1"].map((host) => new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port });
    const fail = () => {
      socket.destroy();
      reject(new Error("Another sign-in is using the local callback port. Close the previous sign-in process, then retry."));
    };
    socket.once("connect", fail);
    socket.setTimeout(1_000, () => {
      socket.destroy();
      reject(new Error("The local sign-in callback port could not be checked. Retry sign-in."));
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (["ECONNREFUSED", "EAFNOSUPPORT", "EADDRNOTAVAIL", "ENETUNREACH"].includes(error.code ?? "")) {
        resolve();
      } else {
        reject(new Error("The local sign-in callback port could not be checked. Retry sign-in."));
      }
    });
  })));
}
