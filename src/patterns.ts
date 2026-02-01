// Pattern definitions (relative coordinates)
export interface Pattern {
  name: string;
  cells: [number, number][]; // [row, col] offsets
}

export const PATTERNS: Pattern[] = [
  // Spaceships
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
    name: "LWSS",
    cells: [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [1, 0],
      [1, 4],
      [2, 4],
      [3, 0],
      [3, 3],
    ],
  },
  {
    name: "MWSS",
    cells: [
      [0, 2],
      [1, 0],
      [1, 4],
      [2, 5],
      [3, 0],
      [3, 5],
      [4, 1],
      [4, 2],
      [4, 3],
      [4, 4],
      [4, 5],
    ],
  },
  // Still Lifes
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
    name: "Beehive",
    cells: [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 3],
      [2, 1],
      [2, 2],
    ],
  },
  {
    name: "Boat",
    cells: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 2],
      [2, 1],
    ],
  },
  // Oscillators
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
