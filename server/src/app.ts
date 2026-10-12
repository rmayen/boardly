import express, { type NextFunction, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import { authRepo, readCookie, type User } from "./auth.js";
import { boardRepo } from "./boards.js";
import type { Db } from "./db.js";
import { HttpError, notFound, unauthorized } from "./errors.js";
import type { BoardEvent } from "./realtime.js";

const email = z.string().trim().toLowerCase().email().max(120);
const name = z.string().trim().min(1).max(60);
const password = z.string().min(8).max(200);
const title = z.string().trim().min(1).max(200);

export interface AppDeps {
  db: Db;
  broadcast?: (e: BoardEvent) => void;
  secureCookies?: boolean;
}

function id(req: Request, key = "id"): number {
  const n = Number(req.params[key]);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
}

export function createApp({ db, broadcast = () => {}, secureCookies = false }: AppDeps) {
  const app = express();
  const auth = authRepo(db);
  const boards = boardRepo(db);
  app.use(express.json({ limit: "100kb" }));

  const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: secureCookies, path: "/", maxAge: 14 * 86400_000 };
  const currentUser = (req: Request): User | undefined => auth.userForSession(readCookie(req.headers.cookie, "sid"));
  const requireUser = (req: Request): User => {
    const u = currentUser(req);
    if (!u) throw unauthorized();
    return u;
  };
  const emit = (type: BoardEvent["type"], boardId: number, actorId: number, payload: unknown) => broadcast({ type, boardId, actorId, payload });

  // ---- auth
  app.post("/api/auth/register", (req, res) => {
    const body = z.object({ email, name, password }).parse(req.body);
    const user = auth.register(body.email, body.name, body.password);
    res.cookie("sid", auth.createSession(user.id), cookieOpts).status(201).json(user);
  });
  app.post("/api/auth/login", (req, res) => {
    const body = z.object({ email, password: z.string() }).parse(req.body);
    const user = auth.login(body.email, body.password);
    res.cookie("sid", auth.createSession(user.id), cookieOpts).json(user);
  });
  app.post("/api/auth/logout", (req, res) => {
    auth.destroySession(readCookie(req.headers.cookie, "sid"));
    res.clearCookie("sid", { path: "/" }).status(204).end();
  });
  app.get("/api/auth/me", (req, res) => res.json(requireUser(req)));

  // ---- boards
  app.get("/api/boards", (req, res) => res.json(boards.listForUser(requireUser(req).id)));
  app.post("/api/boards", (req, res) => {
    const user = requireUser(req);
    const body = z.object({ name: title }).parse(req.body);
    res.status(201).json(boards.create(user.id, body.name));
  });
  app.get("/api/boards/:id", (req, res) => res.json(boards.view(id(req), requireUser(req).id)));
  app.post("/api/boards/:id/members", (req, res) => {
    const user = requireUser(req);
    const body = z.object({ email }).parse(req.body);
    const member = auth.userByEmail(body.email);
    if (!member) throw notFound("No user with that email");
    boards.addMember(id(req), user.id, member.id);
    emit("member.added", id(req), user.id, { userId: member.id });
    res.status(201).json(member);
  });
  app.post("/api/boards/:id/columns", (req, res) => {
    const user = requireUser(req);
    const body = z.object({ name: title }).parse(req.body);
    const col = boards.addColumn(id(req), user.id, body.name);
    emit("column.created", col.board_id, user.id, col);
    res.status(201).json(col);
  });

  // ---- columns
  app.patch("/api/columns/:id", (req, res) => {
    const user = requireUser(req);
    const body = z.object({ name: title }).parse(req.body);
    const col = boards.renameColumn(id(req), user.id, body.name);
    emit("column.updated", col.board_id, user.id, col);
    res.json(col);
  });
  app.delete("/api/columns/:id", (req, res) => {
    const user = requireUser(req);
    const boardId = boards.deleteColumn(id(req), user.id);
    emit("column.deleted", boardId, user.id, { id: id(req) });
    res.status(204).end();
  });
  app.post("/api/columns/:id/cards", (req, res) => {
    const user = requireUser(req);
    const body = z.object({ title, description: z.string().trim().max(5000).default("") }).parse(req.body);
    const card = boards.addCard(id(req), user.id, body.title, body.description);
    emit("card.created", boards.boardIdForColumn(card.column_id), user.id, card);
    res.status(201).json(card);
  });

  // ---- cards
  app.patch("/api/cards/:id", (req, res) => {
    const user = requireUser(req);
    const body = z
      .object({ title, description: z.string().trim().max(5000), column_id: z.number().int().positive(), position: z.number().int().min(0) })
      .partial()
      .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" })
      .parse(req.body);
    let card = boards.updateCard(id(req), user.id, { title: body.title, description: body.description });
    let type: BoardEvent["type"] = "card.updated";
    if (body.column_id !== undefined || body.position !== undefined) {
      card = boards.moveCard(id(req), user.id, body.column_id ?? card.column_id, body.position ?? card.position);
      type = "card.moved";
    }
    emit(type, boards.boardIdForCard(card.id), user.id, card);
    res.json(card);
  });
  app.delete("/api/cards/:id", (req, res) => {
    const user = requireUser(req);
    const boardId = boards.deleteCard(id(req), user.id);
    emit("card.deleted", boardId, user.id, { id: id(req) });
    res.status(204).end();
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: "Validation failed", details: err.flatten().fieldErrors });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof SyntaxError && "body" in err) return res.status(400).json({ error: "Malformed JSON body" });
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  });

  return { app, auth, boards };
}
