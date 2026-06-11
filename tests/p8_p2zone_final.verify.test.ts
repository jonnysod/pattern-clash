// P8 finale Suche: Blocks in P2-Zone col 39–41, weit gespreizte Zeilen.

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { describe, it, expect } from "vitest";

const ROWS = 36, COLS = 60;
const zones = new Zones(COLS, ROWS, { endzoneWidth: 3, lShapes: "none" });

function p1(stamps: { r: number; c: number; cells: [number,number][] }[], gens: number): number {
  const eng = new Engine(ROWS, COLS, zones, 9999);
  for (const s of stamps) eng.stampCells(s.r, s.c, s.cells);
  let total = 0;
  for (let i = 0; i < gens; i++)
    for (const e of eng.computeNextGeneration()) if (e.scorer === 1) total += e.points;
  for (const e of eng.forceFlushBuckets()) if (e.scorer === 1) total += e.points;
  return total;
}

const mwss  = PATTERNS[1]!.cells;
const block = PATTERNS[2]!.cells;

describe("P8 P2-Zone Hindernisse – finale Suche", () => {
  it("MWSS-Baseline ohne Hindernisse (alle Zeilen, 140 Gens)", () => {
    console.log("\n=== Baseline: MWSS ohne Hindernisse ===");
    for (let r = 0; r < 36; r += 3) {
      const s = p1([{ r, c: 5, cells: mwss }], 140);
      if (s > 0) console.log(`  Zeile ${String(r).padStart(2)}: P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("4 Blocks bei col 39 – weit gespreizt (Zeilen 2, 12, 22, 31)", () => {
    console.log("\n=== 4 Blocks bei col 39, Zeilen 2/12/22/31 ===");
    const obs = [2,12,22,31].map(r => ({ r, c: 39, cells: block }));
    for (let r = 0; r < 36; r++) {
      const s = p1([{ r, c: 5, cells: mwss }, ...obs], 140);
      if (s > 0) console.log(`  MWSS Zeile ${String(r).padStart(2)}: P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("4 Blocks bei col 39 – 3×MWSS in den freien Lücken", () => {
    console.log("\n=== 3×MWSS in Lücken (col 39, Blocks 2/12/22/31) ===");
    const obs = [2,12,22,31].map(r => ({ r, c: 39, cells: block }));
    for (const [r1,r2,r3] of [
      [6,16,26],[7,17,27],[6,17,27],[7,16,26],[5,16,26],[6,16,27],
    ] as [number,number,number][]) {
      const s = p1([
        { r: r1, c: 5, cells: mwss },
        { r: r2, c: 5, cells: mwss },
        { r: r3, c: 5, cells: mwss },
        ...obs,
      ], 140);
      console.log(`  3×MWSS(${r1},${r2},${r3}): P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("5 Blocks bei col 39 – engmaschiger (Zeilen 1, 8, 15, 22, 29)", () => {
    console.log("\n=== 5 Blocks col 39, Zeilen 1/8/15/22/29 ===");
    const obs = [1,8,15,22,29].map(r => ({ r, c: 39, cells: block }));
    for (let r = 0; r < 36; r++) {
      const s = p1([{ r, c: 5, cells: mwss }, ...obs], 140);
      if (s > 0) console.log(`  MWSS Zeile ${String(r).padStart(2)}: P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("5 Blocks col 39 – 3×MWSS in Lücken", () => {
    console.log("\n=== 3×MWSS Lücken-Suche bei 5 Blocks (col 39, 1/8/15/22/29) ===");
    const obs = [1,8,15,22,29].map(r => ({ r, c: 39, cells: block }));
    const freeRows: number[] = [];
    for (let r = 0; r < 36; r++) {
      const s = p1([{ r, c: 5, cells: mwss }, ...obs], 140);
      if (s >= 20) freeRows.push(r);
    }
    console.log("  Freie Zeilen (≥20 Punkte):", freeRows.join(", "));
    // Versuche kombinationen
    for (let i = 0; i < freeRows.length; i++) {
      for (let j = i+1; j < freeRows.length; j++) {
        for (let k = j+1; k < freeRows.length; k++) {
          const [r1,r2,r3] = [freeRows[i]!,freeRows[j]!,freeRows[k]!];
          const s = p1([
            { r: r1, c: 5, cells: mwss },
            { r: r2, c: 5, cells: mwss },
            { r: r3, c: 5, cells: mwss },
            ...obs,
          ], 140);
          if (s >= 60) console.log(`  ✅ 3×MWSS(${r1},${r2},${r3}): P1=${s}`);
        }
      }
    }
    expect(true).toBe(true);
  });
});
