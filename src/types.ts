// Shared types and interfaces

// How a pattern moves once the simulation runs, as seen in P1's base
// orientation (travelling towards P2, i.e. to the right). Mirroring for P2
// flips the column direction only — the vertical component is unchanged, so
// one profile per pattern covers both players.
//
// These are measured, not assumed: an orthogonal spaceship holds its row
// exactly and advances one column per two generations; a glider advances one
// row per column travelled, at one column per four generations. A gun does
// not move itself but emits a diagonal stream, so it is described by the
// stream's geometry and flagged as a continuous source.
export interface PatternMovement {
  // "static"     — still lifes and oscillators; no threat, never intercepted
  // "orthogonal" — spaceships; row is preserved exactly
  // "diagonal"   — gliders; row drifts by rowPerCol per column travelled
  // "emitter"    — glider guns; stationary, but a continuous diagonal stream
  kind: "static" | "orthogonal" | "diagonal" | "emitter";
  // Columns advanced per generation (0 for static). c/2 ships = 0.5,
  // c/4 gliders and gun streams = 0.25.
  colsPerGen: number;
  // Rows drifted per column advanced. 0 for orthogonal, -1 travelling up,
  // +1 travelling down.
  rowPerCol: number;
}

export interface Pattern {
  name: string;
  cells: [number, number][]; // [row, col] offsets
  previewGridSize: number;
  previewGenerations: number;
  movement: PatternMovement;
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
// Used in the place phase. patternIndex < 0 means "placeholder"
// (used online for the remote player's hand — resolved on placement).
export interface Card {
  id: string; // Unique id for UI tracking
  patternIndex: number;
}

// Synced game actions. These are the only state mutations that need
// to cross the network. Everything else (UI selections, hover state,
// buy-overlay open/close) is local-only.
//
// Note: buyConfirm carries only `cardCount`, not the full inventory.
// The remote client builds placeholder cards from this count; their
// patternIndex is filled in when the corresponding placement action
// arrives. This prevents leaking the opponent's full hand at confirm
// time.
// ---------------------------------------------------------------------------
// Puzzle types
// ---------------------------------------------------------------------------

export interface PuzzleInitialPlacement {
  patternIndex: number;
  row: number;
  col: number;
  mirror?: boolean; // apply mirrorPatternHorizontal before stamping
}

export interface PuzzleSimulateEntry {
  kind: "simulate";
  generations: number;
}

export interface PuzzlePlaceEntry {
  kind: "place";
  pool: number[]; // pattern indices; each entry becomes one Card in hand
  maxCards?: number; // max cards the player may commit; default = pool.length
}

export type PuzzleTimelineEntry = PuzzleSimulateEntry | PuzzlePlaceEntry;

export interface PuzzleCriteria {
  maxOpponentScore?: number;
  minOwnScore?: number;
}

export interface PuzzleDefinition {
  id: string;
  title: string;
  objective: string;
  hint?: string;
  gridRows: number;
  gridCols: number;
  playerSide: Player;
  zoneConfig?: "l-shapes"; // omit for no-L; "l-shapes" for L-shaped score zones
  initialPlacements: PuzzleInitialPlacement[];
  timeline: PuzzleTimelineEntry[];
  criteria: PuzzleCriteria;
  placementRegion?: ZoneRect; // where the player may place; default = whole grid
}

export type SyncAction =
  | {
      type: "buyConfirm";
      player: Player;
      cardCount: number;
      remainingBudget: number;
    }
  | {
      type: "placement";
      player: Player;
      cardId: string;
      patternIndex: number;
      row: number;
      col: number;
    }
  | { type: "surrender"; player: Player };
