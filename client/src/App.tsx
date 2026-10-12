import { useEffect, useState } from "react";
import { api } from "./api";
import { AuthForm } from "./components/AuthForm";
import { Board } from "./components/Board";
import { BoardList } from "./components/BoardList";
import type { User } from "./types";

export default function App() {
  const [me, setMe] = useState<User | null | undefined>(undefined);
  const [boardId, setBoardId] = useState<number | null>(() => {
    const m = location.hash.match(/^#\/boards\/(\d+)$/);
    return m ? Number(m[1]) : null;
  });

  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { api.me().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { location.hash = boardId ? `#/boards/${boardId}` : ""; }, [boardId]);

  if (me === undefined) return <p className="muted center">Loading…</p>;
  if (me === null) return <AuthForm onAuth={setMe} />;

  return (
    <div className="app">
      <nav className="topbar">
        <strong onClick={() => setBoardId(null)} className="brand">boardly</strong>
        <span className="muted">{me.name}</span>
        <button className="ghost" onClick={() => { void api.logout().then(() => { setMe(null); setBoardId(null); }); }}>Sign out</button>
      </nav>
      {boardId ? <Board boardId={boardId} me={me} onBack={() => setBoardId(null)} /> : <BoardList onOpen={setBoardId} />}
    </div>
  );
}
