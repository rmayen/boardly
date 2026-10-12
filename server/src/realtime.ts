import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { readCookie, type authRepo } from "./auth.js";
import type { boardRepo } from "./boards.js";

export interface BoardEvent {
  type: "card.created" | "card.updated" | "card.moved" | "card.deleted" | "column.created" | "column.updated" | "column.deleted" | "member.added";
  boardId: number;
  actorId: number;
  payload: unknown;
}

/**
 * One WebSocket per open board tab. The server pushes a small event after every mutation; clients that
 * receive one refetch the board. That keeps the protocol tiny and the client logic obviously correct.
 */
export function createRealtime(server: Server, auth: ReturnType<typeof authRepo>, boards: ReturnType<typeof boardRepo>) {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<number, Set<WebSocket>>();

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") return socket.destroy();
    const user = auth.userForSession(readCookie(req.headers.cookie, "sid"));
    const boardId = Number(url.searchParams.get("board"));
    if (!user || !Number.isInteger(boardId)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    try {
      boards.assertMember(boardId, user.id);
    } catch {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let room = rooms.get(boardId);
      if (!room) rooms.set(boardId, (room = new Set()));
      room.add(ws);
      ws.send(JSON.stringify({ type: "hello", boardId, userId: user.id, viewers: room.size }));
      ws.on("close", () => {
        room!.delete(ws);
        if (room!.size === 0) rooms.delete(boardId);
      });
    });
  });

  function broadcast(event: BoardEvent): void {
    const room = rooms.get(event.boardId);
    if (!room) return;
    const msg = JSON.stringify(event);
    for (const ws of room) if (ws.readyState === ws.OPEN) ws.send(msg);
  }

  return { broadcast, viewers: (boardId: number) => rooms.get(boardId)?.size ?? 0, close: () => wss.close() };
}
