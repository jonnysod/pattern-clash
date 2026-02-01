// Pattern definitions (relative coordinates)
export interface Pattern {
  name: string;
  cells: [number, number][]; // [row, col] offsets
}

export const PATTERNS: Pattern[] = [
  {
    name: "Glider",
    cells: [
      [0, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ],
  },
  {
    name: "Block",
    cells: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
  },
  {
    name: "Blinker",
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
  },
  {
    name: "Toad",
    cells: [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  },
  {
    name: "Beacon",
    cells: [
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 3],
      [3, 2],
      [3, 3],
    ],
  },
];
