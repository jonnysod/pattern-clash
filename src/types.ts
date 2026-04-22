// Shared types and interfaces

export interface Pattern {
  name: string;
  cells: [number, number][]; // [row, col] offsets
  previewGridSize: number;
  previewGenerations: number;
}

export type Player = 1 | 2;

// State machine phases
export type GamePhase =
  | "tactical-buy" // Players simultaneously buy patterns (hotseat: sequentially)
  | "tactical-place" // Players alternate placing purchased patterns
  | "simulation" // Conway simulation for SIM_GENERATIONS
  | "ended"; // All phases complete

// Rectangle descriptor for data-driven zone rendering
export interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

// Score event emitted by game logic each generation
export interface ScoreEvent {
  row: number;
  col: number;
  scorer: Player;
  points: number;
}

// Buy inventory entry: pattern type + count purchased.
// Rotation is chosen at placement time (not at buy time), so copy
// limits are tracked per patternIndex.
export interface BuyInventoryEntry {
  patternIndex: number; // Index into PATTERNS
  count: number; // 1..MAX_COPIES_PER_TYPE
}

// Single card in hand (expanded from inventory at confirmBuy).
// Used in the place phase.
export interface Card {
  id: string; // Unique id for UI tracking
  patternIndex: number;
}
