// Bot policy interface, V1 dummy implementation, and Stufe-2a rule-based policy.
//
// BotPolicy is the single extension point for bot intelligence.
// Stufe 2/3 swap the implementation here — the BotController integration
// stays unchanged.
//
// BotView is a deliberately redacted projection of game state.
// It exposes only what a human player could see on screen:
// own hand (full), opponent card count (never contents), public grid.

import type { Card } from "./types.js";
import type { Game } from "./game.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer } from "./patternUtils.js";

export interface BotView {
  grid: boolean[][];
  phase: number;
  ownBudget: number;
  ownHand: Card[];
  opponentCardCount: number; // count only — contents are never exposed
  ownScore: number;
  opponentScore: number;
}

export interface BuyBundle {
  patternIndex: number;
  count: number;
}

export interface BotPolicy {
  chooseBuy(view: BotView): BuyBundle[];
  choosePlacement(view: BotView, card: Card): { row: number; col: number };
}

// Fixed bundle bought every phase regardless of budget leftovers.
// Stufe 2 will replace this with budget-aware selection.
const DUMMY_BUNDLE: BuyBundle[] = [{ patternIndex: 0, count: 3 }]; // 3x LWSS

// ---------------------------------------------------------------------------
// Stufe 2a — rule-based offensive placement + soft self-score avoidance
// ---------------------------------------------------------------------------
//
// Candidate scoring (lower = better):
//   +1000  self-score penalty   — footprint overlaps own score zone (P1 scores)
//   +500   footprint-overlap    — pattern cells land on already-live grid cells
//   +N     path obstruction     — live cells in the row band the pattern spans
//                                 (min_dr−1 to max_dr+1), counting all cols
//   +0.1×  row tie-breaker      — slight preference for rows near vertical centre
//
// Penalty hierarchy ensures:
//   self-score (1000) > footprint-overlap (500) > path (≤ rows×band ≈ 1000 worst-case)
// In practice path scores are small, so the ordering holds for normal grids.
// All penalties are soft: the best available candidate is always chosen.

const SELF_SCORE_PENALTY = 1000;
const FOOTPRINT_OVERLAP_PENALTY = 500;
const ROW_TIEBREAKER_WEIGHT = 0.1;

export class RuleBasedBotPolicy implements BotPolicy {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  chooseBuy(_view: BotView): BuyBundle[] {
    return DUMMY_BUNDLE;
  }

  choosePlacement(view: BotView, card: Card): { row: number; col: number } {
    const basePattern = PATTERNS[card.patternIndex];
    if (!basePattern) return { row: 0, col: this.game.zones.rightStart };

    const pattern = getPatternForPlayer(basePattern, 2);
    const zones = this.game.zones;
    const grid = view.grid;
    const midRow = this.game.rows / 2;

    // Row band extents of the pattern (relative offsets).
    const rowOffsets = pattern.cells.map(([dr]) => dr);
    const minDr = Math.min(...rowOffsets);
    const maxDr = Math.max(...rowOffsets);

    // Pre-compute per-row live-cell counts (used for path-obstruction score).
    const rowLiveCount = new Array<number>(this.game.rows).fill(0);
    for (let r = 0; r < this.game.rows; r++) {
      let count = 0;
      for (let c = 0; c < this.game.cols; c++) {
        if (grid[r]?.[c]) count++;
      }
      rowLiveCount[r] = count;
    }

    let bestRow = 0;
    let bestCol = zones.rightStart;
    let bestScore = Infinity;

    for (let row = 0; row < this.game.rows; row++) {
      for (let col = 0; col < this.game.cols; col++) {
        if (!zones.isValidPatternPlacement(pattern, col, 2)) continue;

        // Self-score penalty: footprint cell would give P1 a point.
        let selfScore = false;
        for (const [dr, dc] of pattern.cells) {
          const { scores, scorer } = zones.isScoreCell(row + dr, col + dc);
          if (scores && scorer === 1) {
            selfScore = true;
            break;
          }
        }

        // Footprint-overlap penalty: any pattern cell lands on a live grid cell.
        let footprintOverlap = false;
        for (const [dr, dc] of pattern.cells) {
          if (grid[row + dr]?.[col + dc]) {
            footprintOverlap = true;
            break;
          }
        }

        // Path-obstruction score: sum live cells in the full row band the
        // pattern spans (minDr−1 buffer … maxDr+1 buffer), across all cols.
        // Counts pre-existing cells that could interfere with the pattern's
        // forward trajectory, including cells in adjacent rows.
        let pathScore = 0;
        const bandTop = Math.max(0, row + minDr - 2);
        const bandBot = Math.min(this.game.rows - 1, row + maxDr + 2);
        for (let r = bandTop; r <= bandBot; r++) {
          pathScore += rowLiveCount[r] ?? 0;
        }

        const score =
          (selfScore ? SELF_SCORE_PENALTY : 0) +
          (footprintOverlap ? FOOTPRINT_OVERLAP_PENALTY : 0) +
          pathScore +
          Math.abs(row - midRow) * ROW_TIEBREAKER_WEIGHT;

        if (score < bestScore) {
          bestScore = score;
          bestRow = row;
          bestCol = col;
        }
      }
    }

    return { row: bestRow, col: bestCol };
  }
}

// ---------------------------------------------------------------------------
// V1 dummy policy — kept for tests and as a reference baseline
// ---------------------------------------------------------------------------

export class DummyBotPolicy implements BotPolicy {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  chooseBuy(_view: BotView): BuyBundle[] {
    return DUMMY_BUNDLE;
  }

  choosePlacement(_view: BotView, card: Card): { row: number; col: number } {
    const basePattern = PATTERNS[card.patternIndex];
    if (!basePattern) return { row: 0, col: this.game.zones.rightStart };

    const pattern = getPatternForPlayer(basePattern, 2);
    const zones = this.game.zones;

    // Try up to 50 random positions.
    for (let attempt = 0; attempt < 50; attempt++) {
      const row = Math.floor(Math.random() * this.game.rows);
      const col = Math.floor(Math.random() * this.game.cols);
      if (zones.isValidPatternPlacement(pattern, col, 2)) {
        return { row, col };
      }
    }

    // Zone-scan fallback — guaranteed to find a legal position.
    for (let row = 0; row < this.game.rows; row++) {
      for (let col = 0; col < this.game.cols; col++) {
        if (zones.isValidPatternPlacement(pattern, col, 2)) {
          return { row, col };
        }
      }
    }

    return { row: 0, col: zones.rightStart };
  }
}
