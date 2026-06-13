// Central configuration constants

export const CONFIG = {
  // Grid
  CELL_SIZE: 7,
  CANVAS_WIDTH: 700,
  CANVAS_HEIGHT: 700,

  // Game structure
  PHASE_COUNT: 6, // Number of tactical phases in a full game
  SIM_GENERATIONS: 150, // Generations per simulation phase
  ADDITIONAL_INITIAL_BUDGET: 40, // Budget for phase 1
  BUDGET_PER_PHASE: 25, // Points added to each player's budget at the start of each tactical phase
  SCORE_POINTS: 1, // Points per cell reaching the opponent's endzone
  MAX_SLOTS: 10, // Max total pattern slots per buy phase
  MAX_COPIES_PER_TYPE: 3, // Max copies of any single pattern type per buy phase

  // Animation (will be used by simulation in Checkpoint C)
  FPS_FAST: 12,

  // Colors
  COLOR_PLAYER1: "#44dddd",
  COLOR_PLAYER2: "#dd44dd",
  COLOR_CELL: "#00ff00",
  COLOR_ZONE_PLAYER1: "#003333",
  COLOR_ZONE_PLAYER2: "#330033",
  COLOR_ZONE_NEUTRAL: "#000000",
  COLOR_ZONE_ENDZONE: "#1a1a1a",
  COLOR_ZONE_SCORE: "#443300",
  COLOR_GRID_LINE: "#222",
  COLOR_ZONE_BORDER: "#666",

  // Score bucket aggregation (delays score crediting so the displayed
  // "+N" floating text matches the actual point award)
  SCORE_BUCKET_REGION_SIZE: 5, // Cells grouped into one score region
  SCORE_BUCKET_SILENCE_LIMIT: 3, // Generations without new hits in a region → flush
  SCORE_BUCKET_AGE_LIMIT: 15, // Max generations a bucket can grow → force flush
} as const;
