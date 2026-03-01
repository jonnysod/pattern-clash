// Shared types and interfaces

export interface Pattern {
  name: string;
  cells: [number, number][]; // [row, col] offsets
  previewGridSize: number;
  previewGenerations: number;
}

export type Player = 1 | 2;

// State machine phases - replaces scattered boolean flags
export type GamePhase =
  | "placement" // Players take turns placing patterns
  | "live" // Simulation running, players can place during turns
  | "paused" // A player has paused the simulation
  | "pauseDecision" // Opponent deciding whether to counter-pause
  | "ended"; // Game over

// Rectangle descriptor for data-driven zone rendering
export interface ZoneRect {
  x: number; // column start
  y: number; // row start
  w: number; // width in columns
  h: number; // height in rows
  color: string;
}
