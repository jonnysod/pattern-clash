// Shared types and interfaces

export interface Pattern {
  name: string;
  cells: [number, number][]; // [row, col] offsets
}

export type Player = 1 | 2;
