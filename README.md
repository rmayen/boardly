# boardly

A real-time kanban board for small teams. Accounts and sessions, boards with members, columns, drag-and-drop
cards, and live updates: when one member moves a card, everyone else looking at that board sees it move.

React + TypeScript on the front, Express + TypeScript and WebSockets on the back, SQLite underneath, one Docker image to run it.

## What it does

- **Accounts and sessions.** Register and sign in with email and password. Passwords are hashed with scrypt
  and a per-user salt; sessions are random 256-bit tokens in an `HttpOnly` cookie. Login returns the same error
  for a wrong password and an unknown email, so the API does not reveal which accounts exist.
- **Boards with members.** Every board starts with To do, In progress, and Done. Invite members by email.
  Non-members get a `403` on every board route and on the WebSocket.
- **Columns and cards.** Add, rename, and delete columns. Add cards, edit title and description inline, drag cards
  between columns or reorder within one. Positions are renumbered server-side in a transaction so they stay dense.
- **Live updates.** One WebSocket per open board. After every mutation the server pushes a small event
  (`card.moved`, `column.created`, ...) to every member watching that board, and their client refetches. The
  header shows how many people are viewing and whether the live connection is up.
- **Optimistic drag.** The card lands where you drop it immediately; the server's answer is authoritative and
  the board refetches on any error.

## Run it

Requires Node 22.13 or newer.

```bash
npm install
npm run dev        # API + WebSocket on :3001, client on :5173
```

Open two browser windows, sign in as two users, invite one to the other's board, and drag a card.

With Docker:

```bash
docker compose up --build    # http://localhost:3001, data persisted in a named volume
```

Other commands:

```bash
npm test           # 14 API + WebSocket tests (server), 4 unit tests (client)
npm run lint       # typecheck server, lint client
npm run build      # server -> server/dist, client -> client/dist
```

## API

| Method | Path                           | Notes                                                |
| ------ | ------------------------------ | ---------------------------------------------------- |
| POST   | `/api/auth/register`           | `email`, `name`, `password` (8+); sets `sid` cookie  |
| POST   | `/api/auth/login`              |                                                      |
| POST   | `/api/auth/logout`             |                                                      |
| GET    | `/api/auth/me`                 |                                                      |
| GET    | `/api/boards`                  | boards the user belongs to                           |
| POST   | `/api/boards`                  | `name`; creates default columns                      |
| GET    | `/api/boards/:id`              | full board: members, columns, cards                  |
| POST   | `/api/boards/:id/members`      | `email` of an existing user                          |
| POST   | `/api/boards/:id/columns`      | `name`                                               |
| PATCH  | `/api/columns/:id`             | `name`                                               |
| DELETE | `/api/columns/:id`             | cascades to its cards                                |
| POST   | `/api/columns/:id/cards`       | `title`, `description`                               |
| PATCH  | `/api/cards/:id`               | `title`, `description`, or `column_id` + `position`  |
| DELETE | `/api/cards/:id`               |                                                      |
| WS     | `/ws?board=:id`                | cookie-authenticated; member-only                    |

Errors: `400` validation (field errors in `details`), `401` not signed in, `403` not a member, `404`, `409` duplicate email.

## Tests

Server tests run the real Express app against an in-memory SQLite database with a cookie-aware supertest agent:
registration and login rules, account-enumeration resistance, session logout, membership checks, column and card
CRUD, cross-column moves with dense renumbering, index clamping, cross-board move refusal, cascade deletes.
The WebSocket tests start a real HTTP server on a random port, verify that sockets without a session or membership
are rejected with `401`/`403`, and that a card move is pushed to every connected member.

Client unit tests cover the two pure helpers behind drag-and-drop: where a drop lands, and how a move is applied
locally before the server confirms it.

## Layout

```
server/src/   app.ts (routes) · auth.ts (scrypt, sessions, cookie) · boards.ts (repository) · realtime.ts (WebSocket rooms) · db.ts · index.ts
server/test/  api.test.ts
client/src/   App.tsx · api.ts · types.ts (+ tested helpers) · components/{AuthForm,BoardList,Board}.tsx
Dockerfile · docker-compose.yml · .github/workflows/ci.yml
```

## Limitations

- Single SQLite file and a single process, so WebSocket rooms live in memory. Scaling out would need a shared
  pub/sub (Redis) for fan-out.
- Drag-and-drop uses the native HTML5 API, which works on desktop browsers but not touch screens.
- No password reset or email verification.
