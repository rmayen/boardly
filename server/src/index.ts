import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { createRealtime } from "./realtime.js";

const port = Number(process.env.PORT ?? 3001);
const db = openDb();
let broadcastRef: ((e: Parameters<ReturnType<typeof createRealtime>["broadcast"]>[0]) => void) = () => {};
const { app, auth, boards } = createApp({ db, broadcast: (e) => broadcastRef(e), secureCookies: process.env.NODE_ENV === "production" });
// In production the built client is served by this same process (see Dockerfile).
const clientDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(join(clientDist, "index.html")));
}
const server = createServer(app);
const realtime = createRealtime(server, auth, boards);
broadcastRef = realtime.broadcast;

server.listen(port, () => console.log(`boardly API + WebSocket listening on http://localhost:${port}`));
