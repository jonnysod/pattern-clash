// Pause system management

import type { Player } from "./types.js";
import type { Game } from "./game.js";
import type { DOMRefs } from "./domRefs.js";
import { Timer } from "./timer.js";
import { CONFIG } from "./config.js";

export class PauseManager {
  private game: Game;
  private dom: DOMRefs;

  private pauseTimer: Timer | null = null;
  private decisionTimer: Timer | null = null;
  private decisionAbort: AbortController | null = null;
  isDecisionVisible: boolean = false;

  // Callbacks (set by UIController)
  onPauseStart: ((player: Player) => void) | null = null;
  onPauseEnd: ((nextPlayer: Player) => void) | null = null;

  constructor(game: Game, dom: DOMRefs) {
    this.game = game;
    this.dom = dom;
  }

  //#region Start Pause
  startPause(player: Player): void {
    const pausesLeft = this.game.getPauses(player);
    if (pausesLeft <= 0 || this.game.isPaused) return;

    this.game.deductPause(player);
    this.game.pausingPlayer = player;
    this.game.setPhase("paused");

    this.onPauseStart?.(player);

    // Start pause countdown
    this.pauseTimer = new Timer(
      CONFIG.PAUSE_DURATION_MS,
      () => this.onPauseTimerEnd(),
      (remaining, total) => {
        const pct = (remaining / total) * 100;
        this.dom.turnTimerBar.style.width = `${pct}%`;
        this.dom.turnTimerBar.style.backgroundColor = CONFIG.COLOR_PAUSE;
      },
    );
    this.pauseTimer.start();
  }
  //#endregion

  //#region Pause Timer End
  private onPauseTimerEnd(): void {
    const pausingPlayer = this.game.pausingPlayer;
    const opponent: Player = pausingPlayer === 1 ? 2 : 1;
    const opponentPauses = this.game.getPauses(opponent);

    if (opponentPauses > 0) {
      // Show counter-pause decision
      this.game.pausingPlayer = null; // Nobody can place during decision
      this.game.setPhase("pauseDecision");
      this.showDecisionDialog(opponent);
    } else {
      // Resume directly
      this.game.pausingPlayer = null;
      this.game.setPhase("live");
      this.onPauseEnd?.(opponent);
    }
  }
  //#endregion

  //#region Decision Dialog
  private showDecisionDialog(player: Player): void {
    this.isDecisionVisible = true;

    const playerColor =
      player === 1 ? CONFIG.COLOR_PLAYER1 : CONFIG.COLOR_PLAYER2;
    this.dom.pauseDecisionTitle.textContent = `Spieler ${player}: Auch pausieren?`;
    this.dom.pauseDecisionTitle.style.color = playerColor;
    this.dom.pauseDecisionTimerBar.style.backgroundColor = playerColor;
    this.dom.pauseDecisionOverlay.style.display = "flex";

    // Start decision timer
    this.decisionTimer = new Timer(
      CONFIG.PAUSE_DECISION_DURATION_MS,
      () => this.resolveDecision(player, false),
      (remaining, total) => {
        const pct = (remaining / total) * 100;
        this.dom.pauseDecisionTimerBar.style.width = `${pct}%`;
      },
    );
    this.decisionTimer.start();

    // Setup button listeners with AbortController (clean removal)
    this.decisionAbort?.abort();
    this.decisionAbort = new AbortController();
    const signal = this.decisionAbort.signal;

    this.dom.pauseDecisionYes.addEventListener(
      "click",
      () => this.resolveDecision(player, true),
      { signal },
    );
    this.dom.pauseDecisionNo.addEventListener(
      "click",
      () => this.resolveDecision(player, false),
      { signal },
    );
  }

  private resolveDecision(player: Player, accepted: boolean): void {
    if (!this.isDecisionVisible) return;
    this.isDecisionVisible = false;

    // Clean up
    if (this.decisionTimer) {
      this.decisionTimer.stop();
      this.decisionTimer = null;
    }
    this.decisionAbort?.abort();
    this.decisionAbort = null;
    this.dom.pauseDecisionOverlay.style.display = "none";

    if (accepted) {
      // Counter-pause: transition back to paused
      this.game.setPhase("live"); // Need to go through live to get back to paused
      this.startPause(player);
    } else {
      // Decline: resume normal play
      this.game.setPhase("live");
      this.onPauseEnd?.(player);
    }
  }
  //#endregion

  //#region Cleanup
  stopAll(): void {
    this.pauseTimer?.stop();
    this.pauseTimer = null;
    this.decisionTimer?.stop();
    this.decisionTimer = null;
    this.decisionAbort?.abort();
    this.decisionAbort = null;
    this.isDecisionVisible = false;
  }

  reset(): void {
    this.stopAll();
    this.dom.pauseDecisionOverlay.style.display = "none";
  }
  //#endregion
}
