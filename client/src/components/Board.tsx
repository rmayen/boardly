import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { api } from "../api";
import { applyMove, dropIndex, type BoardEvent, type BoardView, type Card, type Column, type User } from "../types";

interface Props { boardId: number; me: User; onBack: () => void }

export function Board({ boardId, me, onBack }: Props) {
  const [board, setBoard] = useState<BoardView | null>(null);
  const [viewers, setViewers] = useState(1);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [newColumn, setNewColumn] = useState("");

  const refresh = useCallback(() => api.board(boardId).then(setBoard).catch((e) => setError(e.message)), [boardId]);
  useEffect(() => { void refresh(); }, [refresh]);

  // One socket per open board. Any event from another member triggers a refetch; our own events are
  // already reflected optimistically, but we refetch anyway so positions stay authoritative.
  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?board=${boardId}`);
    ws.onopen = () => setLive(true);
    ws.onclose = () => setLive(false);
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data) as BoardEvent & { viewers?: number };
      if (ev.type === "hello") { setViewers(ev.viewers ?? 1); return; }
      void refresh();
    };
    return () => ws.close();
  }, [boardId, refresh]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); await refresh(); }
  }

  const columnRefs = useRef(new Map<number, HTMLElement>());

  function onDrop(e: DragEvent, col: Column) {
    e.preventDefault();
    const cardId = Number(e.dataTransfer.getData("text/card-id"));
    if (!cardId || !board) return;
    const el = columnRefs.current.get(col.id);
    const tops = el ? [...el.querySelectorAll<HTMLElement>(".kcard")].filter((n) => Number(n.dataset.id) !== cardId).map((n) => n.getBoundingClientRect().top + n.offsetHeight / 2) : [];
    const index = dropIndex(tops, e.clientY);
    setBoard({ ...board, columns: applyMove(board.columns, cardId, col.id, index) });
    setDragging(null);
    void run(() => api.updateCard(cardId, { column_id: col.id, position: index }));
  }

  async function addCard(e: FormEvent, col: Column) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem("title") as HTMLInputElement;
    const title = input.value.trim();
    if (!title) return;
    input.value = "";
    await run(async () => { await api.addCard(col.id, title); await refresh(); });
  }

  if (!board) return <p className="muted">{error ?? "Loading board…"}</p>;

  return (
    <div className="board">
      <header className="board-head">
        <button className="ghost" onClick={onBack}>← Boards</button>
        <h2>{board.name}</h2>
        <span className={`live ${live ? "on" : ""}`} title={live ? "Live updates connected" : "Reconnecting…"}>
          ● {viewers} viewing
        </span>
        <span className="muted members" title={board.members.map((m) => m.email).join(", ")}>
          {board.members.map((m) => m.name).join(", ")}
        </span>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (inviteEmail) void run(async () => { await api.addMember(boardId, inviteEmail); setInviteEmail(""); await refresh(); }); }}>
          <input placeholder="Invite by email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          <button type="submit" className="ghost">Invite</button>
        </form>
      </header>
      {error && <p className="err banner">{error}</p>}

      <div className="columns">
        {board.columns.map((col) => (
          <section
            key={col.id}
            className={`column ${dragging !== null ? "droppable" : ""}`}
            ref={(el) => { if (el) columnRefs.current.set(col.id, el); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, col)}
          >
            <header className="col-head">
              <input
                className="col-name"
                defaultValue={col.name}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== col.name) void run(() => api.renameColumn(col.id, v)); }}
              />
              <span className="muted">{col.cards.length}</span>
              <button className="icon" title="Delete column" onClick={() => { if (confirm(`Delete "${col.name}" and its ${col.cards.length} cards?`)) void run(async () => { await api.deleteColumn(col.id); await refresh(); }); }}>×</button>
            </header>
            <ul className="cards">
              {col.cards.map((card) => (
                <CardItem key={card.id} card={card} mine={me.id > 0} onDragStart={() => setDragging(card.id)} onDragEnd={() => setDragging(null)}
                  onSave={(patch) => run(async () => { await api.updateCard(card.id, patch); await refresh(); })}
                  onDelete={() => run(async () => { await api.deleteCard(card.id); await refresh(); })} />
              ))}
            </ul>
            <form className="add-card" onSubmit={(e) => void addCard(e, col)}>
              <input name="title" placeholder="+ Add a card" autoComplete="off" />
            </form>
          </section>
        ))}
        <form className="column new-col" onSubmit={(e) => { e.preventDefault(); if (newColumn.trim()) void run(async () => { await api.addColumn(boardId, newColumn.trim()); setNewColumn(""); await refresh(); }); }}>
          <input placeholder="+ Add column" value={newColumn} onChange={(e) => setNewColumn(e.target.value)} />
        </form>
      </div>
    </div>
  );
}

function CardItem({ card, onDragStart, onDragEnd, onSave, onDelete }: {
  card: Card; mine: boolean; onDragStart: () => void; onDragEnd: () => void;
  onSave: (p: { title?: string; description?: string }) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);

  if (editing) {
    return (
      <li className="kcard editing" data-id={card.id}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
        <div className="row">
          <button type="button" className="ghost" onClick={() => { setEditing(false); setTitle(card.title); setDescription(card.description); }}>Cancel</button>
          <button type="button" onClick={() => { setEditing(false); onSave({ title: title.trim() || card.title, description }); }}>Save</button>
          <button type="button" className="icon danger" onClick={onDelete} title="Delete card">Delete</button>
        </div>
      </li>
    );
  }
  return (
    <li
      className="kcard"
      data-id={card.id}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/card-id", String(card.id)); e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      onDoubleClick={() => setEditing(true)}
      title="Drag to move · double-click to edit"
    >
      <span className="kcard-title">{card.title}</span>
      {card.description && <span className="kcard-desc">{card.description}</span>}
    </li>
  );
}
