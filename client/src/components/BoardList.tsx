import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { Board } from "../types";

export function BoardList({ onOpen }: { onOpen: (id: number) => void }) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    api.boards().then(setBoards).catch(() => setBoards([]));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const b = await api.createBoard(name.trim());
    setName("");
    onOpen(b.id);
  }

  return (
    <div className="boards">
      <form className="row" onSubmit={create}>
        <input placeholder="New board name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Create</button>
      </form>
      {boards === null ? <p className="muted">Loading…</p> : boards.length === 0 ? <p className="muted">No boards yet. Create one above.</p> : (
        <ul className="board-grid">
          {boards.map((b) => (
            <li key={b.id}><button className="board-tile" onClick={() => onOpen(b.id)}>{b.name}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
