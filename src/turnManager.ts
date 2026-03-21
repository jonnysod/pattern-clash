// Turn management using chess clock for placement and tactical phases

import type { Player } from "./types.js";
import type { Game } from "./game.js";
import type { DOMRefs } from "./domRefs.js";
import { ChessClock } from "./chessClock.js";
import { CONFIG } from "./config.js";

export class TurnManager {
  private game: Game;
  private dom: DOMRefs;
  private clock: ChessClock | null = null;

  activePlayer: Player = 1;

  // Per-phase state
  private player1Done: boolean = false;
  private player2Done: boolean = false;
  private hasPlacedThisActivation: boolean = false;

  // Callbacks
  onTurnSwitch: (() => void) | null = null;
  onPhaseEnd: (() => void) | null = null;

  constructor(game: Game, dom: DOMRefs) {
    this.game = game;
    this.dom = dom;
  }

  //#region Start/Stop Clock
  startClock(secondsPerPlayer: number): void {
    this.player1Done = false;
    this.player2Done = false;
    this.hasPlacedThisActivation = false;
    this.activePlayer = 1;

    this.clock = new ChessClock(secondsPerPlayer, secondsPerPlayer);

    this.clock.onTick = (player, remaining, total) => {
      this.updateTimerBar(player, remaining, total);
    };

    this.clock.onTimeout = (player) => {
      this.markDone(player);
    };

    this.dom.turnTimerContainer.style.visibility = "visible";
    this.clock.start(1);
    this.onTurnSwitch?.();
  }

  stopClock(): void {
    if (this.clock) {
      this.clock.stop();
      this.clock = null;
    }
    this.dom.turnTimerContainer.style.visibility = "hidden";
  }
  //#endregion

  //#region Player Actions
  // Called when a player successfully places a pattern
  notifyPlacement(): void {
    this.hasPlacedThisActivation = true;
    this.updateButtonText();
  }

  // Expose whether current activation has placed something
  hasPlaced(): boolean {
    return this.hasPlacedThisActivation;
  }

  // Called when the active player presses the action button
  onActionButton(): void {
    if (!this.clock?.isRunning()) return;

    if (this.hasPlacedThisActivation) {
      // Placed something → pass turn to opponent
      this.switchToOpponent();
    } else {
      // Placed nothing → done for this phase
      this.markDone(this.activePlayer);
    }
  }

  // Check if the given player has already finished this phase
  isPlayerDone(player: Player): boolean {
    return player === 1 ? this.player1Done : this.player2Done;
  }
  //#endregion

  //#region Turn Switching
  private switchToOpponent(): void {
    const opponent: Player = this.activePlayer === 1 ? 2 : 1;

    // If opponent is done or can't afford, stay with current player
    if (this.isPlayerDone(opponent) || !this.game.canAffordAnyPattern(opponent)) {
      // Current player keeps going, just reset activation state
      this.hasPlacedThisActivation = false;
      this.updateButtonText();
      return;
    }

    this.activePlayer = opponent;
    this.hasPlacedThisActivation = false;
    this.clock?.switchTo(opponent);
    this.onTurnSwitch?.();
  }

  private markDone(player: Player): void {
    if (player === 1) {
      this.player1Done = true;
    } else {
      this.player2Done = true;
    }

    // Check if phase should end
    if (this.shouldEndPhase()) {
      this.stopClock();
      this.onPhaseEnd?.();
      return;
    }

    // Switch to the other player if they're still active
    const opponent: Player = player === 1 ? 2 : 1;
    if (!this.isPlayerDone(opponent) && this.game.canAffordAnyPattern(opponent)) {
      this.activePlayer = opponent;
      this.hasPlacedThisActivation = false;
      this.clock?.switchTo(opponent);
      this.onTurnSwitch?.();
    } else {
      // Both done
      this.stopClock();
      this.onPhaseEnd?.();
    }
  }

  private shouldEndPhase(): boolean {
    const p1Active = !this.player1Done && this.game.canAffordAnyPattern(1);
    const p2Active = !this.player2Done && this.game.canAffordAnyPattern(2);
    return !p1Active && !p2Active;
  }
  //#endregion

  //#region UI Updates
  private updateTimerBar(player: Player, remaining: number, total: number): void {
    const pct = (remaining / total) * 100;
    this.dom.turnTimerBar.style.width = `${pct}%`;
    this.dom.turnTimerBar.style.backgroundColor =
      player === 1 ? CONFIG.COLOR_PLAYER1 : CONFIG.COLOR_PLAYER2;
  }

  updateButtonText(): void {
    const btn1 = this.dom.ready1Btn;
    const btn2 = this.dom.ready2Btn;

    if (this.activePlayer === 1) {
      btn1.textContent = this.hasPlacedThisActivation ? "Pass" : "Done";
      btn1.disabled = false;
      btn1.style.opacity = "1";
      btn2.disabled = true;
      btn2.style.opacity = "0.3";
      btn2.textContent = this.player2Done ? "Done ✓" : "—";
    } else {
      btn2.textContent = this.hasPlacedThisActivation ? "Pass" : "Done";
      btn2.disabled = false;
      btn2.style.opacity = "1";
      btn1.disabled = true;
      btn1.style.opacity = "0.3";
      btn1.textContent = this.player1Done ? "Done ✓" : "—";
    }
  }
  //#endregion

  //#region Reset
  reset(): void {
    this.stopClock();
    this.activePlayer = 1;
    this.player1Done = false;
    this.player2Done = false;
    this.hasPlacedThisActivation = false;
  }
  //#endregion
}
