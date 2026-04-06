// Central configuration constants

export const CONFIG = {
  // Grid
  CELL_SIZE: 7,
  CANVAS_WIDTH: 700,
  CANVAS_HEIGHT: 700,

  // Game
  INITIAL_BUDGET: 80,
  MAX_GENERATIONS: 800,
  SCORE_POINTS: 2,

  // Animation
  FPS_FAST: 12,
  FPS_SLOW: 2,

  // Chess Clock
  CHESS_CLOCK_PLACEMENT_SEC: 20, // Seconds per player, placement phase
  CHESS_CLOCK_TACTICAL_SEC: 10, // Seconds per player, tactical phase

  // Tactical Phases
  TACTICAL_INTERVAL: 100, // Every N generations a tactical phase triggers

  // Colors
  COLOR_PLAYER1: "#44dddd",
  COLOR_PLAYER2: "#dd44dd",
  COLOR_TACTICAL: "#ffaa00",
  COLOR_CELL: "#00ff00",
  COLOR_ZONE_PLAYER1: "#003333",
  COLOR_ZONE_PLAYER2: "#330033",
  COLOR_ZONE_NEUTRAL: "#000000",
  COLOR_ZONE_ENDZONE: "#1a1a1a",
  COLOR_ZONE_SCORE: "#443300",
  COLOR_GRID_LINE: "#222",
  COLOR_ZONE_BORDER: "#666",
} as const;
