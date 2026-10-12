import { describe, it, expect } from "vitest";
import { FrameHistory } from "../src/frameHistory.js";

// A 1×1 grid whose single cell encodes the generation's parity — enough to
// tell frames apart.
function gridFor(gen: number): boolean[][] {
  return [[gen % 2 === 1]];
}

function recordGens(history: FrameHistory, from: number, to: number): void {
  for (let g = from; g <= to; g++) history.record(g, gridFor(g), g * 10, g);
}

describe("FrameHistory", () => {
  it("starts live and cannot go back without frames", () => {
    const h = new FrameHistory(20);
    expect(h.isViewingHistory).toBe(false);
    expect(h.canGoBack).toBe(false);
    expect(h.back()).toBe(false);
    expect(h.current()).toBeNull();
  });

  it("back and forward move through recorded frames, current follows", () => {
    const h = new FrameHistory(20);
    recordGens(h, 0, 5);
    expect(h.current()!.generation).toBe(5);
    h.back();
    h.back();
    expect(h.stepsBack).toBe(2);
    expect(h.current()).toEqual({ generation: 3, grid: [[true]], score1: 30, score2: 3 });
    expect(h.forward()).toBe(true);
    expect(h.current()!.generation).toBe(4);
    h.forward();
    expect(h.isViewingHistory).toBe(false);
    expect(h.forward()).toBe(false); // already live
  });

  it("keeps at most maxStepsBack frames behind live", () => {
    const h = new FrameHistory(20);
    recordGens(h, 0, 100);
    let steps = 0;
    while (h.back()) steps++;
    expect(steps).toBe(20);
    expect(h.current()!.generation).toBe(80);
  });

  it("stores a copy, not the live grid reference", () => {
    const h = new FrameHistory(20);
    const live = [[true]];
    h.record(0, live, 0, 0);
    live[0]![0] = false;
    expect(h.current()!.grid[0]![0]).toBe(true);
  });

  it("toLive, record and clear all return the view to live", () => {
    const h = new FrameHistory(20);
    recordGens(h, 0, 5);
    h.back();
    h.toLive();
    expect(h.isViewingHistory).toBe(false);

    h.back();
    h.record(6, gridFor(6), 0, 0);
    expect(h.isViewingHistory).toBe(false);
    expect(h.current()!.generation).toBe(6);

    h.back();
    h.clear();
    expect(h.isViewingHistory).toBe(false);
    expect(h.current()).toBeNull();
  });
});
