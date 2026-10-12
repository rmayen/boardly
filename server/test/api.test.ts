import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { createRealtime, type BoardEvent } from "../src/realtime.js";

type Agent = ReturnType<typeof request.agent>;
let app: ReturnType<typeof createApp>["app"];
let events: BoardEvent[];

beforeEach(() => {
  events = [];
  app = createApp({ db: openDb(":memory:"), broadcast: (e) => events.push(e) }).app;
});

async function signUp(email: string, name = "User", password = "correct horse battery") {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({ email, name, password });
  expect(res.status).toBe(201);
  return agent;
}

async function boardWith(agent: Agent) {
  const res = await agent.post("/api/boards").send({ name: "Launch" });
  expect(res.status).toBe(201);
  return res.body as { id: number; columns: { id: number; name: string }[] };
}

describe("auth", () => {
  it("registers, sets a session cookie, and reports the current user", async () => {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/register").send({ email: "Ana@Example.com", name: "Ana", password: "longenough1" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "ana@example.com", name: "Ana" });
    expect(res.body.password_hash).toBeUndefined();
    expect(res.headers["set-cookie"][0]).toMatch(/^sid=.*HttpOnly/);
    expect((await agent.get("/api/auth/me")).body.email).toBe("ana@example.com");
  });

  it("rejects weak input and duplicate emails", async () => {
    const bad = await request(app).post("/api/auth/register").send({ email: "nope", name: "", password: "short" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.details)).toEqual(expect.arrayContaining(["email", "name", "password"]));
    await signUp("dup@example.com");
    expect((await request(app).post("/api/auth/register").send({ email: "DUP@example.com", name: "x", password: "longenough1" })).status).toBe(409);
  });

  it("logs in with the right password only, and logs out", async () => {
    await signUp("ben@example.com", "Ben", "my-secret-pass");
    const wrong = await request(app).post("/api/auth/login").send({ email: "ben@example.com", password: "my-secret-nope" });
    expect(wrong.status).toBe(401);
    const unknown = await request(app).post("/api/auth/login").send({ email: "ghost@example.com", password: "my-secret-pass" });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error); // no account enumeration

    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ email: "ben@example.com", password: "my-secret-pass" })).status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("requires a session for board routes", async () => {
    expect((await request(app).get("/api/boards")).status).toBe(401);
    expect((await request(app).post("/api/boards").send({ name: "x" })).status).toBe(401);
  });
});

describe("boards and membership", () => {
  it("creates a board with default columns and lists it", async () => {
    const agent = await signUp("a@example.com");
    const board = await boardWith(agent);
    expect(board.columns.map((c) => c.name)).toEqual(["To do", "In progress", "Done"]);
    expect((await agent.get("/api/boards")).body.map((b: { id: number }) => b.id)).toEqual([board.id]);
  });

  it("hides boards from non-members until they are added", async () => {
    const owner = await signUp("owner@example.com");
    const guest = await signUp("guest@example.com");
    const board = await boardWith(owner);
    expect((await guest.get(`/api/boards/${board.id}`)).status).toBe(403);
    expect((await guest.post(`/api/columns/${board.columns[0].id}/cards`).send({ title: "sneak" })).status).toBe(403);

    expect((await owner.post(`/api/boards/${board.id}/members`).send({ email: "nobody@example.com" })).status).toBe(404);
    expect((await owner.post(`/api/boards/${board.id}/members`).send({ email: "guest@example.com" })).status).toBe(201);
    const view = await guest.get(`/api/boards/${board.id}`);
    expect(view.status).toBe(200);
    expect(view.body.members.map((m: { email: string }) => m.email).sort()).toEqual(["guest@example.com", "owner@example.com"]);
    expect(events.at(-1)).toMatchObject({ type: "member.added", boardId: board.id });
  });

  it("returns 404 for unknown boards", async () => {
    const agent = await signUp("a@example.com");
    expect((await agent.get("/api/boards/999")).status).toBe(404);
    expect((await agent.get("/api/boards/abc")).status).toBe(404);
  });
});

describe("columns and cards", () => {
  it("adds, renames, and deletes columns, broadcasting each change", async () => {
    const agent = await signUp("a@example.com");
    const board = await boardWith(agent);
    const col = (await agent.post(`/api/boards/${board.id}/columns`).send({ name: "Blocked" })).body;
    expect(col.position).toBe(3);
    expect((await agent.patch(`/api/columns/${col.id}`).send({ name: "Waiting" })).body.name).toBe("Waiting");
    expect((await agent.delete(`/api/columns/${col.id}`)).status).toBe(204);
    expect(events.map((e) => e.type)).toEqual(["column.created", "column.updated", "column.deleted"]);
    expect((await agent.get(`/api/boards/${board.id}`)).body.columns).toHaveLength(3);
  });

  it("creates cards with dense positions and edits them", async () => {
    const agent = await signUp("a@example.com");
    const board = await boardWith(agent);
    const todo = board.columns[0].id;
    const c1 = (await agent.post(`/api/columns/${todo}/cards`).send({ title: "Write spec" })).body;
    const c2 = (await agent.post(`/api/columns/${todo}/cards`).send({ title: "Review", description: "with Sam" })).body;
    expect([c1.position, c2.position]).toEqual([0, 1]);
    const edited = await agent.patch(`/api/cards/${c1.id}`).send({ title: "Write the spec", description: "v2" });
    expect(edited.body).toMatchObject({ title: "Write the spec", description: "v2", position: 0 });
    expect((await agent.patch(`/api/cards/${c1.id}`).send({})).status).toBe(400);
    expect((await agent.post(`/api/columns/${todo}/cards`).send({ title: "" })).status).toBe(400);
  });

  it("moves cards between columns and keeps both columns densely ordered", async () => {
    const agent = await signUp("a@example.com");
    const board = await boardWith(agent);
    const [todo, doing] = board.columns.map((c) => c.id);
    const ids: number[] = [];
    for (const t of ["a", "b", "c"]) ids.push((await agent.post(`/api/columns/${todo}/cards`).send({ title: t })).body.id);
    const x = (await agent.post(`/api/columns/${doing}/cards`).send({ title: "x" })).body.id;

    // move "b" to the top of Doing
    const moved = await agent.patch(`/api/cards/${ids[1]}`).send({ column_id: doing, position: 0 });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ column_id: doing, position: 0 });
    expect(events.at(-1)?.type).toBe("card.moved");

    const view = (await agent.get(`/api/boards/${board.id}`)).body;
    const titles = (cid: number) => view.columns.find((c: { id: number }) => c.id === cid).cards.map((k: { title: string; position: number }) => `${k.title}:${k.position}`);
    expect(titles(todo)).toEqual(["a:0", "c:1"]);
    expect(titles(doing)).toEqual(["b:0", "x:1"]);

    // reorder within a column: move "a" below "c"
    await agent.patch(`/api/cards/${ids[0]}`).send({ position: 5 }); // index past the end clamps to last
    const after = (await agent.get(`/api/boards/${board.id}`)).body;
    expect(after.columns[0].cards.map((k: { title: string }) => k.title)).toEqual(["c", "a"]);
    void x;
  });

  it("refuses to move a card to a column on another board", async () => {
    const agent = await signUp("a@example.com");
    const b1 = await boardWith(agent);
    const b2 = await boardWith(agent);
    const card = (await agent.post(`/api/columns/${b1.columns[0].id}/cards`).send({ title: "stay" })).body;
    expect((await agent.patch(`/api/cards/${card.id}`).send({ column_id: b2.columns[0].id })).status).toBe(403);
  });

  it("deletes cards and cascades when a column is deleted", async () => {
    const agent = await signUp("a@example.com");
    const board = await boardWith(agent);
    const col = board.columns[0].id;
    const card = (await agent.post(`/api/columns/${col}/cards`).send({ title: "gone" })).body;
    expect((await agent.delete(`/api/cards/${card.id}`)).status).toBe(204);
    expect((await agent.delete(`/api/cards/${card.id}`)).status).toBe(404);
    const other = (await agent.post(`/api/columns/${col}/cards`).send({ title: "also gone" })).body;
    await agent.delete(`/api/columns/${col}`);
    expect((await agent.patch(`/api/cards/${other.id}`).send({ title: "x" })).status).toBe(404);
  });
});

describe("realtime", () => {
  let server: Server;
  let port: number;
  let realtime: ReturnType<typeof createRealtime>;
  let wsApp: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const db = openDb(":memory:");
    let bc: (e: BoardEvent) => void = () => {};
    wsApp = createApp({ db, broadcast: (e) => bc(e) });
    server = createServer(wsApp.app);
    realtime = createRealtime(server, wsApp.auth, wsApp.boards);
    bc = realtime.broadcast;
    await new Promise<void>((r) => server.listen(0, r));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    realtime.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const base = () => `http://localhost:${port}`;

  async function session(email: string) {
    const res = await request(base()).post("/api/auth/register").send({ email, name: "U", password: "longenough1" });
    const cookie = String(res.headers["set-cookie"][0]).split(";")[0];
    return cookie;
  }

  function connect(boardId: number, cookie?: string) {
    return new Promise<{ ws: WebSocket; messages: unknown[] } | { status: number }>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws?board=${boardId}`, { headers: cookie ? { cookie } : {} });
      const messages: unknown[] = [];
      ws.on("message", (m) => messages.push(JSON.parse(String(m))));
      ws.on("open", () => resolve({ ws, messages }));
      ws.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode ?? 0 }));
      ws.on("error", () => {});
    });
  }

  it("rejects sockets without a session or membership", async () => {
    const cookie = await session("owner@example.com");
    const board = (await request(base()).post("/api/boards").set("cookie", cookie).send({ name: "B" })).body;
    expect(await connect(board.id)).toEqual({ status: 401 });
    const stranger = await session("stranger@example.com");
    expect(await connect(board.id, stranger)).toEqual({ status: 403 });
  });

  it("pushes a card.moved event to every member watching the board", async () => {
    const owner = await session("owner@example.com");
    const board = (await request(base()).post("/api/boards").set("cookie", owner).send({ name: "B" })).body;
    const [todo, doing] = board.columns.map((c: { id: number }) => c.id);
    const card = (await request(base()).post(`/api/columns/${todo}/cards`).set("cookie", owner).send({ title: "ship it" })).body;

    const a = await connect(board.id, owner);
    const b = await connect(board.id, owner);
    if (!("ws" in a) || !("ws" in b)) throw new Error("expected sockets to open");
    expect(realtime.viewers(board.id)).toBe(2);
    expect(a.messages[0]).toMatchObject({ type: "hello", boardId: board.id });

    await request(base()).patch(`/api/cards/${card.id}`).set("cookie", owner).send({ column_id: doing, position: 0 });
    await new Promise((r) => setTimeout(r, 50));
    for (const sock of [a, b]) {
      expect(sock.messages.at(-1)).toMatchObject({ type: "card.moved", boardId: board.id, payload: { id: card.id, column_id: doing } });
    }
    a.ws.close();
    b.ws.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(realtime.viewers(board.id)).toBe(0);
  });
});
