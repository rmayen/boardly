import { describe, expect, it } from "vitest";
import { applyMove, dropIndex, type Column } from "./types";

const card = (id: number, column_id: number, position: number) => ({ id, column_id, position, title: `c${id}`, description: "", updated_at: "" });
const cols: Column[] = [
  { id: 1, board_id: 1, name: "A", position: 0, cards: [card(10, 1, 0), card(11, 1, 1), card(12, 1, 2)] },
  { id: 2, board_id: 1, name: "B", position: 1, cards: [card(20, 2, 0)] },
];

describe("dropIndex", () => {
  it("places before the first card whose top is below the pointer", () => {
    expect(dropIndex([100, 200, 300], 50)).toBe(0);
    expect(dropIndex([100, 200, 300], 150)).toBe(1);
    expect(dropIndex([100, 200, 300], 999)).toBe(3);
    expect(dropIndex([], 10)).toBe(0);
  });
});

describe("applyMove", () => {
  it("moves across columns and renumbers both", () => {
    const out = applyMove(cols, 11, 2, 0);
    expect(out[0].cards.map((c) => [c.id, c.position])).toEqual([[10, 0], [12, 1]]);
    expect(out[1].cards.map((c) => [c.id, c.column_id, c.position])).toEqual([[11, 2, 0], [20, 2, 1]]);
  });
  it("reorders within a column and clamps the index", () => {
    const out = applyMove(cols, 10, 1, 99);
    expect(out[0].cards.map((c) => c.id)).toEqual([11, 12, 10]);
  });
  it("is a no-op for an unknown card and never mutates the input", () => {
    const snapshot = JSON.stringify(cols);
    expect(applyMove(cols, 999, 2, 0)).toBe(cols);
    applyMove(cols, 10, 2, 0);
    expect(JSON.stringify(cols)).toBe(snapshot);
  });
});
