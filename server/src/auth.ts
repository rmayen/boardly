import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.js";
import { row } from "./db.js";
import { conflict, unauthorized } from "./errors.js";

export interface User {
  id: number;
  email: string;
  name: string;
  created_at: string;
}

const SESSION_DAYS = 14;

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): { hash: string; salt: string } {
  return { hash: scryptSync(password, salt, 64).toString("hex"), salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = Buffer.from(hashPassword(password, salt).hash, "hex");
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function authRepo(db: Db) {
  const publicUser = (r: { id: number; email: string; name: string; created_at: string }): User => ({
    id: r.id, email: r.email, name: r.name, created_at: r.created_at,
  });

  function register(email: string, name: string, password: string): User {
    const { hash, salt } = hashPassword(password);
    try {
      const res = db.prepare("INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)").run(email, name, hash, salt);
      return userById(Number(res.lastInsertRowid))!;
    } catch (e) {
      if (String(e).includes("UNIQUE")) throw conflict("An account with that email already exists");
      throw e;
    }
  }

  function login(email: string, password: string): User {
    const r = row<{ id: number; email: string; name: string; created_at: string; password_hash: string; password_salt: string }>(
      db.prepare("SELECT * FROM users WHERE email = ?").get(email),
    );
    // Same error for unknown email and wrong password, so the response does not reveal which accounts exist.
    if (!r || !verifyPassword(password, r.password_hash, r.password_salt)) throw unauthorized("Invalid email or password");
    return publicUser(r);
  }

  function userById(id: number): User | undefined {
    const r = row<{ id: number; email: string; name: string; created_at: string }>(db.prepare("SELECT id, email, name, created_at FROM users WHERE id = ?").get(id));
    return r && publicUser(r);
  }

  function userByEmail(email: string): User | undefined {
    const r = row<{ id: number; email: string; name: string; created_at: string }>(db.prepare("SELECT id, email, name, created_at FROM users WHERE email = ?").get(email));
    return r && publicUser(r);
  }

  function createSession(userId: number): string {
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expires);
    return token;
  }

  function userForSession(token: string | undefined): User | undefined {
    if (!token) return undefined;
    const r = row<{ user_id: number; expires_at: string }>(db.prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?").get(token));
    if (!r) return undefined;
    if (r.expires_at < new Date().toISOString()) {
      db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
      return undefined;
    }
    return userById(r.user_id);
  }

  function destroySession(token: string | undefined): void {
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }

  return { register, login, userById, userByEmail, createSession, userForSession, destroySession };
}

/** Minimal cookie parser; the only cookie we read is the session id. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
