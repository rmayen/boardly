import type { Board, BoardView, Card, Column, User } from "./types";

export class ApiError extends Error {
  status: number;
  details?: Record<string, string[]>;
  constructor(status: number, message: string, details?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, credentials: "same-origin", ...init });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText, body.details);
  return body as T;
}
const post = (body?: unknown) => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  me: () => call<User>("/api/auth/me"),
  register: (b: { email: string; name: string; password: string }) => call<User>("/api/auth/register", post(b)),
  login: (b: { email: string; password: string }) => call<User>("/api/auth/login", post(b)),
  logout: () => call<void>("/api/auth/logout", post()),
  boards: () => call<Board[]>("/api/boards"),
  createBoard: (name: string) => call<BoardView>("/api/boards", post({ name })),
  board: (id: number) => call<BoardView>(`/api/boards/${id}`),
  addMember: (boardId: number, email: string) => call<User>(`/api/boards/${boardId}/members`, post({ email })),
  addColumn: (boardId: number, name: string) => call<Column>(`/api/boards/${boardId}/columns`, post({ name })),
  renameColumn: (id: number, name: string) => call<Column>(`/api/columns/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteColumn: (id: number) => call<void>(`/api/columns/${id}`, { method: "DELETE" }),
  addCard: (columnId: number, title: string) => call<Card>(`/api/columns/${columnId}/cards`, post({ title })),
  updateCard: (id: number, patch: Partial<Pick<Card, "title" | "description" | "column_id" | "position">>) =>
    call<Card>(`/api/cards/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCard: (id: number) => call<void>(`/api/cards/${id}`, { method: "DELETE" }),
};
