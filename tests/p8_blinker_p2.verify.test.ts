// 3 Blinker in P2-Zone (col 44), gleichmäßig verteilt — wie im User-Screenshot.

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { describe, it, expect } from "vitest";

const ROWS = 36, COLS = 60;
const zones = new Zones(COLS, ROWS, { endzoneWidth: 3, lShapes: "none" });
// P2-Zone: cols 39–56, scoreColumn = 57

function run(stamps: { r: number; c: number; cells: [number,number][] }[], gens: number): number {
  const eng = new Engine(ROWS, COLS, zones, 9999);
  for (const s of stamps) eng.stampCells(s.r, s.c, s.cells);
  let total = 0;
  for (let i = 0; i < gens; i++)
    for (const e of eng.computeNextGeneration()) if (e.scorer === 1) total += e.points;
  for (const e of eng.forceFlushBuckets()) if (e.scorer === 1) total += e.points;
  return total;
}

const mwss    = PATTERNS[1]!.cells;
const lwss    = PATTERNS[0]!.cells;
const blinker = PATTERNS[5]!.cells;

// 3 Blinker wie im Screenshot: oben, mitte, unten — col 44 (mitten in P2-Zone)
const BLINKERS_COL44 = [4, 16, 28].map(r => ({ r, c: 44, cells: blinker }));
// Auch col 40 (P2-Zone-Einstieg) testen
const BLINKERS_COL40 = [4, 16, 28].map(r => ({ r, c: 40, cells: blinker }));
// Col 48 (tiefer in P2)
const BLINKERS_COL48 = [4, 16, 28].map(r => ({ r, c: 48, cells: blinker }));

describe("P8 Blinker in P2-Zone – Kollisions-Scoring", () => {
  it("MWSS alle Zeilen vs 3 Blinker bei col 44", () => {
    console.log("\n=== MWSS + 3 Blinker bei col 44, Zeilen 4/16/28 ===");
    for (let r = 0; r < 36; r++) {
      const s = run([{ r, c: 5, cells: mwss }, ...BLINKERS_COL44], 160);
      if (s > 0) console.log(`  MWSS Zeile ${String(r).padStart(2)}: P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("MWSS alle Zeilen vs 3 Blinker bei col 40", () => {
    console.log("\n=== MWSS + 3 Blinker bei col 40, Zeilen 4/16/28 ===");
    for (let r = 0; r < 36; r++) {
      const s = run([{ r, c: 5, cells: mwss }, ...BLINKERS_COL40], 160);
      if (s > 0) console.log(`  MWSS Zeile ${String(r).padStart(2)}: P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("MWSS alle Zeilen vs 3 Blinker bei col 48", () => {
    console.log("\n=== MWSS + 3 Blinker bei col 48, Zeilen 4/16/28 ===");
    for (let r = 0; r < 36; r++) {
      const s = run([{ r, c: 5, cells: mwss }, ...BLINKERS_COL48], 160);
      if (s > 0) console.log(`  MWSS Zeile ${String(r).padStart(2)}: P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("LWSS alle Zeilen vs 3 Blinker bei col 44", () => {
    console.log("\n=== LWSS + 3 Blinker bei col 44 ===");
    for (let r = 0; r < 36; r++) {
      const s = run([{ r, c: 5, cells: lwss }, ...BLINKERS_COL44], 160);
      if (s > 0) console.log(`  LWSS Zeile ${String(r).padStart(2)}: P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("3 MWSS kombiniert vs 3 Blinker col 44", () => {
    console.log("\n=== 3×MWSS verschiedene Zeilen + 3 Blinker col 44 ===");
    // Zeilen mit besten Einzelergebnissen kombinieren
    const bestRows: number[] = [];
    for (let r = 0; r < 36; r++) {
      const s = run([{ r, c: 5, cells: mwss }, ...BLINKERS_COL44], 160);
      if (s > 0) bestRows.push(r);
    }
    console.log(`  Zeilen mit P1>0: ${bestRows.slice(0,10).join(", ")}`);
    // Top-3 kombinieren
    for (let i = 0; i < Math.min(3, bestRows.length - 2); i++) {
      const [r1, r2, r3] = [bestRows[i]!, bestRows[i+1]!, bestRows[i+2]!];
      const s = run([
        { r: r1, c: 5, cells: mwss },
        { r: r2, c: 5, cells: mwss },
        { r: r3, c: 5, cells: mwss },
        ...BLINKERS_COL44,
      ], 160);
      console.log(`  3×MWSS(${r1},${r2},${r3}): P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("Feinere Blinker-Verteilung: 5 Blinker col 44 (alle 7 Zeilen)", () => {
    console.log("\n=== 5 Blinker col 44, Zeilen 2/9/16/23/30 ===");
    const obs5 = [2, 9, 16, 23, 30].map(r => ({ r, c: 44, cells: blinker }));
    for (let r = 0; r < 36; r++) {
      const s = run([{ r, c: 5, cells: mwss }, ...obs5], 160);
      if (s > 0) console.log(`  MWSS Zeile ${String(r).padStart(2)}: P1=${s}`);
    }
    expect(true).toBe(true);
  });
});

describe("P8 Blinker col 44 – Pair-Scoring", () => {
  const OBS = [4, 16, 28].map(r => ({ r, c: 44, cells: blinker }));

  it("MWSS-Paare die einzeln gut scoren — interferieren sie zusammen?", () => {
    console.log("\n=== Paare: MWSS Zeile 7 + Zeile 19 (einzeln je 149) ===");
    const pairs: [number,number][] = [
      [7,19],[7,26],[14,19],[7,14],[14,26],[19,26],
    ];
    for (const [r1,r2] of pairs) {
      const s = run([
        { r: r1, c: 5, cells: mwss },
        { r: r2, c: 5, cells: mwss },
        ...OBS,
      ], 160);
      console.log(`  MWSS(${r1})+MWSS(${r2}): P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("MWSS + LWSS Kombinationen", () => {
    console.log("\n=== MWSS + LWSS ===");
    for (const [mr, lr] of [[7,6],[19,18],[7,18],[19,6]] as [number,number][]) {
      const s = run([
        { r: mr, c: 5, cells: mwss },
        { r: lr, c: 5, cells: lwss },
        ...OBS,
      ], 160);
      console.log(`  MWSS(${mr})+LWSS(${lr}): P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("Col 44 mit staggered Start-Cols (zeitlicher Versatz)", () => {
    console.log("\n=== MWSS(7,c5)+MWSS(19,c15) – zeitlicher Versatz ===");
    for (const c2 of [10, 15, 18]) {
      const s = run([
        { r: 7,  c: 5,  cells: mwss },
        { r: 19, c: c2, cells: mwss },
        ...OBS,
      ], 160);
      console.log(`  MWSS(7,5)+MWSS(19,${c2}): P1=${s}`);
    }
    expect(true).toBe(true);
  });
});
