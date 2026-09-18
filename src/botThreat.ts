// Threat model (Fix 3b) — what is coming for the bot, and where to meet it.
//
// The interception row is a *function of the interception column*, not a
// fixed row. For an orthogonal spaceship the function is constant — it holds
// its row, so blocking anywhere in that row works. For a glider it has slope
// ±1: a glider placed at row 10 / col 20 enters P2's zone (col 66) at row 56.
// A band around the *placement* row would miss it by 46 rows, which is why
// this projects per candidate column instead of scattering around a row.
//
// A pattern is only worth intercepting if it can arrive at all. A glider
// whose diagonal leaves the grid before reaching the defended zone dies at
// the edge and is no threat — checking the row at the zone's near edge is
// enough, since the drift is monotonic in the column.
//
// Deliberately *not* filtered by time: "cannot arrive within this phase's
// generations" is not the same as harmless, because the board carries over
// and a slow glider simply lands next phase. Only leaving the grid is a real
// all-clear.

import type { Pattern } from "./types.js";
import { PATTERNS } from "./patterns.js";
import type { BotView } from "./botView.js";

// Upper bound on how many pieces in the opponent's freshly bought hand could
// possibly reach us, from the two public numbers: card count and total spend.
//
// Every card costs at least the cheapest pattern in the game, and anything
// that can actually travel the board costs at least the cheapest of *those*.
// So for k travellers among c cards costing s in total:
//
//     cheapTravel*k + cheapAny*(c-k) <= s   =>   k <= (s - cheapAny*c) / delta
//
// With today's prices (Blinker 3, LWSS 9) that is k <= (s - 3c) / 6. Five
// cards for 15 points proves *zero* travellers; three cards for 33 allows
// three. The zero case is the valuable one — it is a certainty, not a guess,
// and it says defence bought this phase would have nothing to catch.
//
// Diagonal patterns are excluded from "can travel": a glider moves at c/4 and
// does not cross the board inside a phase (see the movement notes above), so
// counting it would only make the bound needlessly pessimistic. Being wrong
// in that direction is safe — the bound overstates the threat, never hides it.
//
// Prices are read from PATTERNS rather than written down, so the bound cannot
// drift when a pattern is added or repriced.
export function maxIncomingShips(view: BotView): number {
  const spent = view.opponentSpentThisPhase;
  const cards = view.opponentCardCount;
  // No reference point, or nothing bought: assume the worst rather than
  // claiming a safety that was never observed.
  if (spent === null) return cards;
  if (cards <= 0) return 0;

  let cheapAny = Infinity;
  let cheapTravel = Infinity;
  for (const pattern of PATTERNS) {
    const price = pattern.cells.length;
    if (price < cheapAny) cheapAny = price;
    const kind = pattern.movement.kind;
    if (kind === "orthogonal" || kind === "emitter") {
      if (price < cheapTravel) cheapTravel = price;
    }
  }

  const delta = cheapTravel - cheapAny;
  if (delta <= 0) return cards; // no price separation to reason from
  const bound = Math.floor((spent - cheapAny * cards) / delta);
  return Math.max(0, Math.min(cards, bound));
}

const THREAT_WEIGHT: Record<string, number> = {
  static: 0, // still lifes and oscillators never travel — ignore
  orthogonal: 1,
  diagonal: 1,
  emitter: 2, // a gun keeps producing; one block never retires the threat
};

// Vertical reference point of a placed pattern, used as the origin of its
// trajectory. The bounding-box centre tracks the measured centroid closely
// for ships and gliders, and lands within a couple of rows of a gun's muzzle
// (a 36-row gun placed at row 30 emits from ~row 48). Residual offset is
// absorbed by INTERCEPT_ROW_BAND (see botPolicy.ts).
function patternSourceRow(pattern: Pattern, placedRow: number): number {
  let maxRowOffset = 0;
  for (const [rowOffset] of pattern.cells) {
    if (rowOffset > maxRowOffset) maxRowOffset = rowOffset;
  }
  return placedRow + Math.floor((maxRowOffset + 1) / 2);
}

// Project where each witnessed opponent placement crosses the given column,
// most dangerous first. Returns intercept rows, not threat positions.
//
// Skipped: static pieces (weight 0 — an opponent's own block is not coming
// for anyone) and any trajectory that has left the grid by the time it
// reaches this column, which is a glider that dies against the top or
// bottom edge on the way over.
function projectInterceptRows(
  atCol: number,
  view: BotView,
  rows: number,
): number[] {
  const scored: { row: number; weight: number }[] = [];

  for (const placement of view.opponentPlacements) {
    const pattern = PATTERNS[placement.patternIndex];
    if (!pattern) continue;

    const { kind, rowPerCol } = pattern.movement;
    const weight = THREAT_WEIGHT[kind] ?? 0;
    if (weight === 0) continue;

    // The opponent is P1, travelling towards increasing columns. A column
    // already behind the threat is not on its path.
    const colsToTravel = atCol - placement.col;
    if (colsToTravel <= 0) continue;

    const interceptRow =
      patternSourceRow(pattern, placement.row) + rowPerCol * colsToTravel;
    if (interceptRow < 0 || interceptRow >= rows) continue;

    scored.push({ row: interceptRow, weight });
  }

  scored.sort((a, b) => b.weight - a.weight);
  return scored.map((s) => s.row);
}

// Where each observed mover crosses the given column, using the velocity
// measured from the frame diff rather than a table lookup. Same geometry as
// projectInterceptRows, but it needs no idea of *what* the thing is — which
// is the point, since some movers (a gun's glider stream) were never placed
// as a unit and have no pattern to look up.
function projectMotionRows(
  atCol: number,
  view: BotView,
  rows: number,
): number[] {
  const out: number[] = [];

  for (const mover of view.observedMotion) {
    // Travelling away from us, or not really travelling: not a threat.
    if (mover.colsPerGen <= 0) continue;
    const colsToTravel = atCol - mover.col;
    if (colsToTravel <= 0) continue;

    const interceptRow = Math.round(
      mover.row + (mover.rowsPerGen / mover.colsPerGen) * colsToTravel,
    );
    // Leaves the board before it gets here — it dies against an edge.
    if (interceptRow < 0 || interceptRow >= rows) continue;

    out.push(interceptRow);
  }
  return out;
}

// Rows worth defending at this column: observed first, projected second.
//
// Observed leads because it is the stronger signal for the threats nothing
// else can see — stationary wall debris keeps scoring in the same rows phase
// after phase, so where it scored last time is where it will score next.
//
// Projection covers what observation structurally cannot: a piece placed
// this phase, which has never scored and therefore appears nowhere in the
// previous phase's events.
export function defensiveRowsFor(
  atCol: number,
  view: BotView,
  rows: number,
): number[] {
  return [
    ...view.observedScoreRows,
    ...projectMotionRows(atCol, view, rows),
    ...projectInterceptRows(atCol, view, rows),
  ];
}
