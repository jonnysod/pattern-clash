// Turn management for placement and live phases

import type { Player } from "./types.js";
import type { Game } from "./game.js";
import type { DOMRefs } from "./domRefs.js";
import { Timer } from "./timer.js";
import { CONFIG } from "./config.js";

export class TurnManager {
  private game: Game;
  private dom: DOMRefs;

  activePlayer: Player = 1;
  player1Ready: boolean = false;
  player2Ready: boolean = false;

  // Live phase turn timer
  private turnTimer: Timer | null = null;

  // Callbacks
  onTurnSwitch: (() => void) | null = null;
  onLivePhaseStart: (() => void) | null = null;

  constructor(game: Game, dom: DOMRefs) {
    this.game = game;
    this.dom = dom;
  }

  //#region Placement Phase Turns
  markReady(player: Player): void {
    if (player === 1) {
      this.player1Ready = true;
      this.dom.ready1Btn.disabled = true;
      this.dom.ready1Btn.style.opacity = "0.5";
    } else {
      this.player2Ready = true;
      this.dom.ready2Btn.disabled = true;
      this.dom.ready2Btn.style.opacity = "0.5";
    }
    this.switchTurnPlacement();
  }

  switchTurnPlacement(): void {
    if (this.activePlayer === 1) {
      if (this.game.canAffordAnyPattern(2) && !this.player2Ready) {
        this.activePlayer = 2;
      }
    } else {
      if (this.game.canAffordAnyPattern(1) && !this.player1Ready) {
        this.activePlayer = 1;
      }
    }

    this.onTurnSwitch?.();
    this.checkGameStart();
  }

  private checkGameStart(): void {
    const p1Done = this.player1Ready || !this.game.canAffordAnyPattern(1);
    const p2Done = this.player2Ready || !this.game.canAffordAnyPattern(2);

    if (p1Done && p2Done) {
      this.onLivePhaseStart?.();
    }
  }
  //#endregion

  //#region Live Phase Turns
  startLiveTurnCycle(): void {
    this.activePlayer = 1;
    this.startTurnTimer();
  }

  switchTurnLivePhase(): void {
    const canP1 = this.game.canAffordAnyPattern(1);
    const canP2 = this.game.canAffordAnyPattern(2);

    if (!canP1 && !canP2) {
      this.stopTimer();
      this.dom.turnTimerContainer.style.visibility = "hidden";
      return;
    }

    if (this.activePlayer === 1) {
      this.activePlayer = canP2 ? 2 : 1;
    } else {
      this.activePlayer = canP1 ? 1 : 2;
    }

    this.onTurnSwitch?.();
    this.startTurnTimer();
  }

  startTurnTimer(): void {
    this.stopTimer();

    this.turnTimer = new Timer(
      CONFIG.TURN_DURATION_MS,
      () => this.switchTurnLivePhase(),
      (remaining, total) => this.updateTimerBar(remaining, total),
    );

    this.turnTimer.start();
  }

  stopTimer(): void {
    if (this.turnTimer) {
      this.turnTimer.stop();
      this.turnTimer = null;
    }
  }

  private updateTimerBar(remaining: number, total: number): void {
    const pct = (remaining / total) * 100;
    this.dom.turnTimerBar.style.width = `${pct}%`;
    this.dom.turnTimerBar.style.backgroundColor =
      this.activePlayer === 1 ? CONFIG.COLOR_PLAYER1 : CONFIG.COLOR_PLAYER2;
  }
  //#endregion

  //#region Reset
  reset(): void {
    this.stopTimer();
    this.activePlayer = 1;
    this.player1Ready = false;
    this.player2Ready = false;
    this.dom.turnTimerContainer.style.visibility = "hidden";
  }
  //#endregion
}
