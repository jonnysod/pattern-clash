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
  | "placement" // Initial placement with chess clock
  | "simulation" // Fast simulation, no player interaction
  | "tactical" // Slow simulation with chess clock placement
  | "ended"; // Game over

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
