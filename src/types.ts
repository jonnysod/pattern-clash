// Shared types and interfaces

export interface Pattern {
  name: string;
  cells: [number, number][]; // [row, col] offsets
  previewGridSize: number;
  previewGenerations: number;
}

export type Player = 1 | 2;
