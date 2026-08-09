// Central configuration constants

export const CONFIG = {
  // Grid
  CELL_SIZE: 7,
  CANVAS_WIDTH: 700,
  CANVAS_HEIGHT: 700,

  // Game structure
  PHASE_COUNT: 6, // Number of tactical phases in a full game
  SIM_GENERATIONS_PHASE_1: 150, // Generations in the first simulation phase
  SIM_GENERATIONS_PHASE_STEP: 20, // Added per following phase (phase 6 → 250)
  ADDITIONAL_INITIAL_BUDGET: 40, // Budget for phase 1
  BUDGET_PER_PHASE: 25, // Points added to each player's budget at the start of each tactical phase
  SCORE_POINTS: 1, // Points per cell reaching the opponent's goal zone
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
  COLOR_ZONE_GOALZONE: "#1a1a1a",
  COLOR_ZONE_SCORE: "#443300",
  COLOR_GRID_LINE: "#222",
  COLOR_ZONE_BORDER: "#666",

  // Score bucket aggregation (delays score crediting so the displayed
  // "+N" floating text matches the actual point award)
  SCORE_BUCKET_REGION_SIZE: 5, // Cells grouped into one score region
  SCORE_BUCKET_SILENCE_LIMIT: 3, // Generations without new hits in a region → flush
  SCORE_BUCKET_AGE_LIMIT: 15, // Max generations a bucket can grow → force flush
} as const;

// Generations the simulation runs in a given tactical phase (1-based).
//
// Why a ramp instead of a flat 150: an orthogonal spaceship travels at c/2
// (one cell per two generations). On the 100-column board, the rear of a
// player's own zone (col 95) is 92 cells from the opposing score column
// (col 3) — 184 generations of travel. At a flat 150 only the front 13 of
// the zone's 30 columns can ever land a hit; the rear is structurally dead
// for offense, which is exactly where a ship would have to start if the
// ships ahead of it are meant to clear the corridor first. The ramp opens
// the full zone by the late phases, which is also when accumulated debris
// makes clearing that corridor worth doing.
//
// Real-time cost is far below the nominal +100 generations: the stability
// skip early-terminates the phase once the board is periodic, and a
// travelling ship keeps the grid non-periodic, so the extra generations are
// only ever spent while something is actually moving.
//
// Must stay a pure function of the phase number — online play relies on both
// clients deriving the same value without syncing it.
export function simGenerationsForPhase(phaseNumber: number): number {
  const phasesElapsed = Math.max(0, phaseNumber - 1);
  return (
    CONFIG.SIM_GENERATIONS_PHASE_1 +
    phasesElapsed * CONFIG.SIM_GENERATIONS_PHASE_STEP
  );
}
