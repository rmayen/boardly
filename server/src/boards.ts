import type { Db } from "./db.js";
import { row, rows } from "./db.js";
import { forbidden, notFound } from "./errors.js";

export interface Board { id: number; name: string; owner_id: number; created_at: string }
export interface Column { id: number; board_id: number; name: string; position: number }
export interface Card { id: number; column_id: number; title: string; description: string; position: number; created_at: string; updated_at: string }
export interface BoardView extends Board {
  members: { id: number; name: string; email: string }[];
  columns: (Column & { cards: Card[] })[];
}

const DEFAULT_COLUMNS = ["To do", "In progress", "Done"];

export function boardRepo(db: Db) {
  const touch = "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

  function assertMember(boardId: number, userId: number): void {
    if (!row(db.prepare("SELECT 1 FROM boards WHERE id = ?").get(boardId))) throw notFound("Board not found");
    if (!row(db.prepare("SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?").get(boardId, userId))) throw forbidden();
  }

  function boardIdForColumn(columnId: number): number {
    const r = row<{ board_id: number }>(db.prepare("SELECT board_id FROM columns WHERE id = ?").get(columnId));
    if (!r) throw notFound("Column not found");
    return r.board_id;
  }

  function boardIdForCard(cardId: number): number {
    const r = row<{ board_id: number }>(db.prepare("SELECT c.board_id FROM cards k JOIN columns c ON c.id = k.column_id WHERE k.id = ?").get(cardId));
    if (!r) throw notFound("Card not found");
    return r.board_id;
  }

  function listForUser(userId: number): Board[] {
    return rows<Board>(db.prepare("SELECT b.* FROM boards b JOIN board_members m ON m.board_id = b.id WHERE m.user_id = ? ORDER BY b.created_at DESC").all(userId));
  }

  function create(userId: number, name: string): BoardView {
    const res = db.prepare("INSERT INTO boards (name, owner_id) VALUES (?, ?)").run(name, userId);
    const id = Number(res.lastInsertRowid);
    db.prepare("INSERT INTO board_members (board_id, user_id) VALUES (?, ?)").run(id, userId);
    DEFAULT_COLUMNS.forEach((n, i) => db.prepare("INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)").run(id, n, i));
    return view(id, userId);
  }

  function view(boardId: number, userId: number): BoardView {
    assertMember(boardId, userId);
    const board = row<Board>(db.prepare("SELECT * FROM boards WHERE id = ?").get(boardId))!;
    const members = rows<{ id: number; name: string; email: string }>(
      db.prepare("SELECT u.id, u.name, u.email FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? ORDER BY u.name").all(boardId),
    );
    const columns = rows<Column>(db.prepare("SELECT * FROM columns WHERE board_id = ? ORDER BY position").all(boardId));
    const cards = rows<Card>(db.prepare("SELECT k.* FROM cards k JOIN columns c ON c.id = k.column_id WHERE c.board_id = ? ORDER BY k.position").all(boardId));
    return { ...board, members, columns: columns.map((c) => ({ ...c, cards: cards.filter((k) => k.column_id === c.id) })) };
  }

  function addMember(boardId: number, actorId: number, memberId: number): void {
    assertMember(boardId, actorId);
    db.prepare("INSERT OR IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)").run(boardId, memberId);
  }

  function addColumn(boardId: number, userId: number, name: string): Column {
    assertMember(boardId, userId);
    const next = row<{ n: number }>(db.prepare("SELECT COALESCE(MAX(position) + 1, 0) AS n FROM columns WHERE board_id = ?").get(boardId))!.n;
    const res = db.prepare("INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)").run(boardId, name, next);
    return row<Column>(db.prepare("SELECT * FROM columns WHERE id = ?").get(Number(res.lastInsertRowid)))!;
  }

  function renameColumn(columnId: number, userId: number, name: string): Column {
    assertMember(boardIdForColumn(columnId), userId);
    db.prepare("UPDATE columns SET name = ? WHERE id = ?").run(name, columnId);
    return row<Column>(db.prepare("SELECT * FROM columns WHERE id = ?").get(columnId))!;
  }

  function deleteColumn(columnId: number, userId: number): number {
    const boardId = boardIdForColumn(columnId);
    assertMember(boardId, userId);
    db.prepare("DELETE FROM columns WHERE id = ?").run(columnId);
    return boardId;
  }

  function addCard(columnId: number, userId: number, title: string, description: string): Card {
    assertMember(boardIdForColumn(columnId), userId);
    const next = row<{ n: number }>(db.prepare("SELECT COALESCE(MAX(position) + 1, 0) AS n FROM cards WHERE column_id = ?").get(columnId))!.n;
    const res = db.prepare("INSERT INTO cards (column_id, title, description, position) VALUES (?, ?, ?, ?)").run(columnId, title, description, next);
    return row<Card>(db.prepare("SELECT * FROM cards WHERE id = ?").get(Number(res.lastInsertRowid)))!;
  }

  function updateCard(cardId: number, userId: number, patch: { title?: string; description?: string }): Card {
    assertMember(boardIdForCard(cardId), userId);
    const sets: string[] = [];
    const params: string[] = [];
    if (patch.title !== undefined) { sets.push("title = ?"); params.push(patch.title); }
    if (patch.description !== undefined) { sets.push("description = ?"); params.push(patch.description); }
    if (sets.length) db.prepare(`UPDATE cards SET ${sets.join(", ")}, ${touch} WHERE id = ?`).run(...params, cardId);
    return row<Card>(db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId))!;
  }

  /** Move a card to a column at an index, renumbering both columns so positions stay dense and ordered. */
  function moveCard(cardId: number, userId: number, toColumnId: number, toIndex: number): Card {
    const boardId = boardIdForCard(cardId);
    assertMember(boardId, userId);
    if (boardIdForColumn(toColumnId) !== boardId) throw forbidden("Cannot move a card to another board");
    const card = row<Card>(db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId))!;
    db.exec("BEGIN");
    try {
      const target = rows<{ id: number }>(db.prepare("SELECT id FROM cards WHERE column_id = ? AND id != ? ORDER BY position").all(toColumnId, cardId)).map((r) => r.id);
      const idx = Math.max(0, Math.min(toIndex, target.length));
      target.splice(idx, 0, cardId);
      target.forEach((id, pos) => db.prepare(`UPDATE cards SET column_id = ?, position = ?${id === cardId ? `, ${touch}` : ""} WHERE id = ?`).run(toColumnId, pos, id));
      if (card.column_id !== toColumnId) {
        rows<{ id: number }>(db.prepare("SELECT id FROM cards WHERE column_id = ? ORDER BY position").all(card.column_id))
          .forEach((r, pos) => db.prepare("UPDATE cards SET position = ? WHERE id = ?").run(pos, r.id));
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return row<Card>(db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId))!;
  }

  function deleteCard(cardId: number, userId: number): number {
    const boardId = boardIdForCard(cardId);
    assertMember(boardId, userId);
    db.prepare("DELETE FROM cards WHERE id = ?").run(cardId);
    return boardId;
  }

  return { listForUser, create, view, addMember, addColumn, renameColumn, deleteColumn, addCard, updateCard, moveCard, deleteCard, boardIdForColumn, boardIdForCard, assertMember };
}
