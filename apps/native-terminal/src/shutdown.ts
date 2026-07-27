import type { Server } from "node:http";
import type { Socket } from "node:net";

export type NativeServerSupervisor = {
  readonly activeConnections: number;
  close(graceMs?: number): Promise<void>;
};

export function superviseNativeServer(server: Server): NativeServerSupervisor {
  const sockets = new Set<Socket>();
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let onSocketClosed: () => void = () => undefined;
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      onSocketClosed();
    });
    if (closing) {
      socket.destroy();
    }
  };
  server.on("connection", track);

  return {
    get activeConnections() {
      return sockets.size;
    },
    close(graceMs = 5_000) {
      closing = true;
      closePromise ??= closeTrackedServer(
        server,
        sockets,
        graceMs,
        (listener) => {
          onSocketClosed = listener;
        }
      );
      return closePromise;
    }
  };
}

function closeTrackedServer(
  server: Server,
  sockets: Set<Socket>,
  graceMs: number,
  onSocketClose: (listener: () => void) => void
): Promise<void> {
  if (!Number.isSafeInteger(graceMs) || graceMs <= 0) {
    throw new Error("Shutdown grace period must be a positive safe integer.");
  }

  return new Promise<void>((resolve, reject) => {
    let forced = false;
    let closeError: Error | undefined;
    let settled = false;
    const finishIfClosed = () => {
      if (settled || !forced || sockets.size > 0) {
        return;
      }
      setImmediate(() => {
        if (settled || sockets.size > 0) {
          return;
        }
        settled = true;
        if (closeError) {
          reject(closeError);
        } else {
          resolve();
        }
      });
    };
    onSocketClose(finishIfClosed);
    setTimeout(() => {
      forced = true;
      for (const socket of sockets) {
        socket.destroy();
      }
      server.closeAllConnections();
      finishIfClosed();
    }, graceMs);

    server.close((error) => {
      closeError = error;
    });
    server.closeIdleConnections();
  });
}
