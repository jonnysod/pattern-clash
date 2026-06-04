// Puzzle definitions.
//
// Each puzzle is verified by the engine (see tests/puzzle.verify.test.ts).
// Add new puzzles here — the selection screen lists them automatically.

import type { PuzzleDefinition } from "./types.js";

// Pattern indices (from patterns.ts)
const LWSS_INDEX = 0;
const MWSS_INDEX = 1;
const BLOCK_INDEX = 2;
const BLINKER_INDEX = 5;
const GLIDER_DOWN_INDEX = 8;
const GLIDER_UP_INDEX = 9;

// Puzzle grid: 50 cols × 30 rows
// Zone layout (endzoneWidth=3, no-L): P1 zone cols 3–16, neutral 17–32,
// P2 zone 33–46, scoreColumnRight=47 (P1 scores), scoreColumnLeft=2 (P2 scores).
const PUZZLE_ROWS = 30;
const PUZZLE_COLS = 50;

// Shared zone configs used by puzzles.
export const PUZZLE_ZONE_CONFIG = {
  endzoneWidth: 3,
  lShapes: "none" as const,
};

// L-shaped score zones for P5/P6 — mirrors the main game layout.
// scoreColumnRight=47, top L arm: row 2, cols 36–47; bottom L arm: row 27, cols 36–47.
// scoreColumnLeft=2, top L arm: row 2, cols 2–14;  bottom L arm: row 27, cols 2–14.
export const PUZZLE_ZONE_CONFIG_L = {
  endzoneWidth: 3,
  lShapes: "both" as const,
};

// ---------------------------------------------------------------------------
// P1 — Stop the Spaceship (defensive, no-L, binary)
// Verified: Block anywhere in P1 zone on the MWSS row (cols 3–16, rows 11–12)
// stops the spaceship completely (P2 = 0).
// ---------------------------------------------------------------------------
const P1: PuzzleDefinition = {
  id: "stop-the-mwss",
  title: "Stop the Spaceship",
  objective: "Stop the spaceship before it reaches your endzone.",
  hint: "A stable pattern in its path stops it.",
  gridRows: PUZZLE_ROWS,
  gridCols: PUZZLE_COLS,
  playerSide: 1,

  // Mirrored MWSS in the opponent's zone, flying left toward P1's endzone.
  initialPlacements: [
    { patternIndex: MWSS_INDEX, row: 12, col: 38, mirror: true },
  ],

  // Timeline:
  //   1. Watch the spaceship approach for 20 generations.
  //   2. Place one card from the hand to block its path.
  //   3. Simulate 80 more generations to see the result.
  //
  // MWSS reaches P1 zone around gen 50 — plenty of time after placement.
  timeline: [
    { kind: "simulate", generations: 20 },
    {
      kind: "place",
      pool: [BLOCK_INDEX, BLINKER_INDEX, GLIDER_UP_INDEX, GLIDER_DOWN_INDEX],
      maxCards: 1,
    },
    { kind: "simulate", generations: 80 },
  ],

  criteria: { maxOpponentScore: 0 },

  // Player may only place within their own zone (cols 3–16, all rows).
  placementRegion: { x: 3, y: 0, w: 14, h: PUZZLE_ROWS, color: "" },
};

// ---------------------------------------------------------------------------
// P2 — Limit the Damage (defensive, no-L, threshold)
// MWSS starts closer (col 18) so the crash happens around gen 36 instead of
// ~76, cutting 40 gens of uneventful approach. The debris constellation at
// the action point is identical to the original col-38 / 100-gen setup.
//
// Verified (col 18, 60+60 gens):
//   Without intervention: P2 = 211 (first score gen 45).
//   Best Block position (exhaustive search): (row 12, col 3) → P2 = 64.
//   22 positions in P1 zone achieve ≤ 100. Threshold 100 confirmed valid.
// ---------------------------------------------------------------------------
const P2: PuzzleDefinition = {
  id: "stop-scoring-spaceship",
  title: "Limit the Damage",
  objective: "The spaceship has already crashed. Limit the damage: the opponent may score at most 100.",
  hint: "The spaceship will crash into your wall and create debris that keeps scoring. Intervene in the debris field, not at the ship itself.",
  gridRows: PUZZLE_ROWS,
  gridCols: PUZZLE_COLS,
  playerSide: 1,

  initialPlacements: [
    { patternIndex: MWSS_INDEX, row: 12, col: 18, mirror: true },
  ],

  // Timeline:
  //   1. Watch the spaceship crash and start scoring (60 gens; crash ~gen 36).
  //   2. Place one card to disrupt the ongoing debris.
  //   3. Simulate 60 more generations.
  timeline: [
    { kind: "simulate", generations: 60 },
    {
      kind: "place",
      pool: [BLOCK_INDEX, BLINKER_INDEX, GLIDER_UP_INDEX, GLIDER_DOWN_INDEX],
      maxCards: 1,
    },
    { kind: "simulate", generations: 60 },
  ],

  criteria: { maxOpponentScore: 100 },

  placementRegion: { x: 3, y: 0, w: 14, h: PUZZLE_ROWS, color: "" },
};

// ---------------------------------------------------------------------------
// P3 — Send a Spaceship (offensive, no-L)
// Empty board. Player picks one card and tries to score at least 1 point.
//
// Verified results (100 gens, no-L config):
//   LWSS from any P1 position: P1 = 16 (moves right at c/2, reaches col 47).
//   GliderDown from P1 zone:   P1 = 0  (diagonal, falls off grid before col 47).
//   GliderUp from P1 zone:     P1 = 0  (diagonal, falls off grid before col 47).
//
// Note: in a 50×30 grid a diagonal glider needs 31+ grid-diagonal steps to reach
// the right endzone, which exceeds the grid height before reaching col 47.
// The lesson — "direction counts" — still holds: only the straight-right LWSS
// actually reaches the endzone.
// ---------------------------------------------------------------------------
const P3: PuzzleDefinition = {
  id: "send-a-spaceship",
  title: "Send a Spaceship",
  objective: "Score at least 1 point. You may place 1 card.",
  hint: "Not every pattern moves. And not every moving pattern goes the right way.",
  gridRows: PUZZLE_ROWS,
  gridCols: PUZZLE_COLS,
  playerSide: 1,

  initialPlacements: [],

  timeline: [
    {
      kind: "place",
      pool: [LWSS_INDEX, GLIDER_DOWN_INDEX, GLIDER_UP_INDEX, BLINKER_INDEX],
      maxCards: 1,
    },
    { kind: "simulate", generations: 100 },
  ],

  criteria: { minOwnScore: 1 },

  placementRegion: { x: 3, y: 0, w: 14, h: PUZZLE_ROWS, color: "" },
};

// ---------------------------------------------------------------------------
// P4 — Launch the Fleet (offensive, no-L, multi-card)
// Empty board. Player places up to 3 cards and must score ≥ 25 points.
//
// Verified results (100 gens, no-L config):
//   1× LWSS: P1 = 16   → fails (< 25)
//   1× MWSS: P1 = 17   → fails (< 25)
//   2× LWSS (separated by ≥ 5 rows): P1 = 32 → passes
//   3× LWSS: P1 = 48   → passes comfortably
//   1× MWSS + 1× LWSS: P1 = 33 → passes
//   GliderDown/Up, Block, Blinker: P1 = 0 in all positions.
//
// Threshold 25 requires at least two spaceships. Single-spaceship runs (16–17)
// fall short; all-decoy runs (0) fail. Headroom: 3× LWSS = 48 (92% above threshold).
// ---------------------------------------------------------------------------
const P4: PuzzleDefinition = {
  id: "launch-the-fleet",
  title: "Launch the Fleet",
  objective: "Score at least 25 points. You may place up to 3 cards.",
  hint: "Multiple attacks add up — but only the right patterns actually move forward.",
  gridRows: PUZZLE_ROWS,
  gridCols: PUZZLE_COLS,
  playerSide: 1,

  initialPlacements: [],

  timeline: [
    {
      kind: "place",
      pool: [LWSS_INDEX, MWSS_INDEX, GLIDER_DOWN_INDEX, GLIDER_UP_INDEX, BLOCK_INDEX, BLINKER_INDEX],
      maxCards: 3,
    },
    { kind: "simulate", generations: 100 },
  ],

  criteria: { minOwnScore: 25 },

  placementRegion: { x: 3, y: 0, w: 14, h: PUZZLE_ROWS, color: "" },
};

// ---------------------------------------------------------------------------
// P5 — Stop the Glider (defensive, L-zones)
// A mirrored GliderDown (SW-moving) starts in P2 zone and heads for P1's
// bottom L-arm score zone. Without a Block in the right area it scores 5.
//
// Verified (L-zones, timeline: sim 20, place block, sim 80):
//   No block: P2 = 5 (first score at gen ~94 via bottom L arm row 27, col ~13).
//   Block at any of 23 positions in (rows 20–25, cols 13–16): P2 = 0.
//
// Solution area: place Block anywhere in roughly (rows 20–25, cols 13–16).
// The pool includes Blinker, GliderDown, GliderUp as decoys — none stop
// the incoming glider reliably.
// ---------------------------------------------------------------------------
const P5: PuzzleDefinition = {
  id: "stop-the-glider",
  title: "Stop the Glider",
  zoneConfig: "l-shapes" as const,
  objective: "A diagonal glider is approaching your endzone. Stop it before it scores.",
  hint: "A glider is fragile. A well-placed obstacle ends its trip.",
  gridRows: PUZZLE_ROWS,
  gridCols: PUZZLE_COLS,
  playerSide: 1,

  // Mirrored GliderDown in P2 zone, moves SW (left+down).
  initialPlacements: [
    { patternIndex: GLIDER_DOWN_INDEX, row: 5, col: 35, mirror: true },
  ],

  // Timeline:
  //   1. Watch the glider approach for 20 gens.
  //   2. Place one card in P1 zone to intercept.
  //   3. Simulate 80 more gens to see if it was stopped.
  timeline: [
    { kind: "simulate", generations: 20 },
    {
      kind: "place",
      pool: [BLOCK_INDEX, BLINKER_INDEX, GLIDER_DOWN_INDEX, GLIDER_UP_INDEX],
      maxCards: 1,
    },
    { kind: "simulate", generations: 80 },
  ],

  criteria: { maxOpponentScore: 0 },

  placementRegion: { x: 3, y: 0, w: 14, h: PUZZLE_ROWS, color: "" },
};

// ---------------------------------------------------------------------------
// P6 — Hit the L-Shape (offensive, L-zones)
// Empty board with L-shaped score zones. Player places 1 diagonal glider.
//
// Verified (L-zones, 120 gens):
//   GliderDown from (rows 0–9, cols 8–16): P1 = 2–8 (hits bottom L arm).
//   GliderUp from (rows 18–27, cols 8–16): P1 = 2–8 (hits top L arm).
//   Both from (any row, cols 3–7): P1 = 0 (misses the L arms).
//   Block / Blinker: P1 = 0.
//
// The L arms extend inward to col 36 — diagonal patterns can reach them from
// the right part of P1 zone (cols 8–16). Placing too far left (cols 3–7) misses.
// ---------------------------------------------------------------------------
const P6: PuzzleDefinition = {
  id: "hit-the-l",
  title: "Hit the L-Shape",
  zoneConfig: "l-shapes" as const,
  objective: "Score by hitting the L-shaped score zone. You may place 1 card.",
  hint: "The L-shaped zone extends inward. A diagonal pattern aimed correctly can reach it.",
  gridRows: PUZZLE_ROWS,
  gridCols: PUZZLE_COLS,
  playerSide: 1,

  initialPlacements: [],

  timeline: [
    {
      kind: "place",
      pool: [GLIDER_DOWN_INDEX, GLIDER_UP_INDEX, BLOCK_INDEX, BLINKER_INDEX],
      maxCards: 1,
    },
    { kind: "simulate", generations: 120 },
  ],

  criteria: { minOwnScore: 1 },

  placementRegion: { x: 3, y: 0, w: 14, h: PUZZLE_ROWS, color: "" },
};

// ---------------------------------------------------------------------------
// Exported list — order defines selection screen order (easiest first).
// ---------------------------------------------------------------------------
export const PUZZLES: PuzzleDefinition[] = [P1, P2, P3, P4, P5, P6];
