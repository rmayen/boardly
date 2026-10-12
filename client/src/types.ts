export interface User { id: number; email: string; name: string }
export interface Board { id: number; name: string; owner_id: number; created_at: string }
export interface Card { id: number; column_id: number; title: string; description: string; position: number; updated_at: string }
export interface Column { id: number; board_id: number; name: string; position: number; cards: Card[] }
export interface BoardView extends Board { members: User[]; columns: Column[] }
export interface BoardEvent { type: string; boardId: number; actorId: number; payload: unknown }

/** Compute where a dragged card lands when dropped on a column at a given y offset. Pure, so it is unit tested. */
export function dropIndex(cardTops: number[], y: number): number {
  let i = 0;
  while (i < cardTops.length && y > cardTops[i]) i++;
  return i;
}

/** Apply a move locally so the UI updates before the server confirms it. */
export function applyMove(columns: Column[], cardId: number, toColumnId: number, toIndex: number): Column[] {
  let moving: Card | undefined;
  const stripped = columns.map((c) => {
    const found = c.cards.find((k) => k.id === cardId);
    if (found) moving = found;
    const cards = c.cards.filter((k) => k.id !== cardId);
    return { ...c, cards: found ? cards.map((k, i) => ({ ...k, position: i })) : cards };
  });
  if (!moving) return columns;
  return stripped.map((c) => {
    if (c.id !== toColumnId) return c;
    const cards = [...c.cards];
    cards.splice(Math.max(0, Math.min(toIndex, cards.length)), 0, { ...moving!, column_id: toColumnId });
    return { ...c, cards: cards.map((k, i) => ({ ...k, position: i })) };
  });
}
