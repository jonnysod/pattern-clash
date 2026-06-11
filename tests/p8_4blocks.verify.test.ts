// 4 Blocks bei col 24 – clearing + free rows.

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

const mwss = PATTERNS[1]!.cells;
const gliderDown = PATTERNS[8]!.cells;
const block = PATTERNS[2]!.cells;

// 4 Blocks col 24, Zeilen 4/12/20/28 → freie Zeilen 8-9, 15-16, 23
const OBS = [4, 12, 20, 28].map(r => ({ r, c: 24, cells: block }));

describe("P8 – 4 Blocks col 24", () => {
  it("alle MWSS-Zeilen – was ist geblockt, was frei?", () => {
    console.log("\n=== MWSS solo + 4 Blocks col 24 ===");
    for (let r = 0; r < 36; r++) {
      const s = p1([{ r, c: 5, cells: mwss }, ...OBS], 140);
      if (s > 0) console.log(`  Zeile ${String(r).padStart(2)}: P1=${s} ${s >= 80 ? "✅" : "⚡"}`);
    }
    expect(true).toBe(true);
  });

  it("GliderDown räumt Block(4,24), MWSS(1,5) fährt durch", () => {
    console.log("\n=== Clearing Block(4,24) ===");
    // Formel: c = 24-4+r = 20+r → r=0: c=20 ✓
    for (const [gr, gc] of [[0,20],[0,19],[0,18]] as [number,number][]) {
      const cleared = p1([
        { r: gr, c: gc, cells: gliderDown },
        { r: 1, c: 5, cells: mwss },
        ...OBS,
      ], 140);
      const blocked = p1([{ r: 1, c: 5, cells: mwss }, ...OBS], 140);
      console.log(`  GliderDown(${gr},${gc})+MWSS(1,5): ${blocked}→${cleared} ${cleared > blocked ? "✅" : "❌"}`);
    }
    expect(true).toBe(true);
  });

  it("Bestes 3-Karten-Combo: Clearer + 2×MWSS", () => {
    console.log("\n=== 3-Karten Combos ===");
    // Clearer für Block(4,24): GliderDown(0,20)
    for (const [r2, r3] of [
      [9,17],[9,16],[9,15],[8,16],[8,15],[9,23],[16,23],
    ] as [number,number][]) {
      const s = p1([
        { r: 0, c: 20, cells: gliderDown }, // Clearer
        { r: 1, c: 5, cells: mwss },         // durch geclearte obere Bahn
        { r: r2, c: 5, cells: mwss },        // 2. MWSS durch freie Zone
        ...OBS,
      ], 140);
      console.log(`  GliderDown(0,20)+MWSS(1)+MWSS(${r2}): P1=${s}${s >= 100 ? " ✅" : ""}`);
    }
    // Auch ohne Clearing: 3 MWSS in freie Zeilen
    for (const [r1,r2,r3] of [[9,17,25],[9,16,24]] as [number,number,number][]) {
      const s = p1([
        { r: r1, c: 5, cells: mwss },
        { r: r2, c: 5, cells: mwss },
        { r: r3, c: 5, cells: mwss },
        ...OBS,
      ], 140);
      console.log(`  3×MWSS(${r1},${r2},${r3}) ohne Clearing: P1=${s}`);
    }
    expect(true).toBe(true);
  });
});
