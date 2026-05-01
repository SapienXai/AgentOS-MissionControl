import "server-only";

import net from "node:net";

import type { GatewayStatusPayload } from "@/lib/openclaw/client/gateway-client";

export async function probeLocalGatewayStatus(port = 18789): Promise<GatewayStatusPayload | null> {
  const reachable = await probeTcpPort("127.0.0.1", port, 750);

  if (!reachable) {
    return null;
  }

  return {
    service: {
      label: "Local port probe",
      loaded: true
    },
    gateway: {
      bindMode: "loopback",
      port,
      probeUrl: `ws://127.0.0.1:${port}`
    },
    rpc: {
      ok: true
    }
  };
}

async function probeTcpPort(host: string, port: number, timeoutMs: number) {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}
