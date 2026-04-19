// Chess clock: two independent timers, one active at a time
// On timeout: fires callback but does NOT auto-switch.
// Caller must call switchTo() to resume ticking the other player.

import type { Player } from "./types.js";

export class ChessClock {
  private timePlayer1: number;
  private timePlayer2: number;
  private activePlayer: Player = 1;
  private intervalId: number | null = null;
  private running: boolean = false;

  onTick: ((player: Player, remaining: number, total: number) => void) | null =
    null;
  onTimeout: ((player: Player) => void) | null = null;

  private readonly totalTime1: number;
  private readonly totalTime2: number;
  private player1Expired: boolean = false;
  private player2Expired: boolean = false;

  constructor(timePlayer1Sec: number, timePlayer2Sec: number) {
    this.totalTime1 = timePlayer1Sec * 1000;
    this.totalTime2 = timePlayer2Sec * 1000;
    this.timePlayer1 = this.totalTime1;
    this.timePlayer2 = this.totalTime2;
  }

  start(player: Player): void {
    this.activePlayer = player;
    this.running = true;
    this.player1Expired = false;
    this.player2Expired = false;
    this.fireTick();

    this.intervalId = window.setInterval(() => {
      if (!this.running) return;

      // If active player already expired, idle until switchTo or stop
      if (this.activePlayer === 1 && this.player1Expired) return;
      if (this.activePlayer === 2 && this.player2Expired) return;

      if (this.activePlayer === 1) {
        this.timePlayer1 -= 100;
        if (this.timePlayer1 <= 0) {
          this.timePlayer1 = 0;
          this.player1Expired = true;
          this.fireTick();
          this.onTimeout?.(1);
          return;
        }
      } else {
        this.timePlayer2 -= 100;
        if (this.timePlayer2 <= 0) {
          this.timePlayer2 = 0;
          this.player2Expired = true;
          this.fireTick();
          this.onTimeout?.(2);
          return;
        }
      }

      this.fireTick();
    }, 100);
  }

  stop(): void {
    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  switchTo(player: Player): void {
    this.activePlayer = player;
    this.fireTick();
  }

  bothExpired(): boolean {
    return this.player1Expired && this.player2Expired;
  }

  getActivePlayer(): Player {
    return this.activePlayer;
  }

  getRemaining(player: Player): number {
    return player === 1 ? this.timePlayer1 : this.timePlayer2;
  }

  getTotal(player: Player): number {
    return player === 1 ? this.totalTime1 : this.totalTime2;
  }

  isRunning(): boolean {
    return this.running;
  }

  private fireTick(): void {
    const p = this.activePlayer;
    const remaining = p === 1 ? this.timePlayer1 : this.timePlayer2;
    const total = p === 1 ? this.totalTime1 : this.totalTime2;
    this.onTick?.(p, remaining, total);
  }
}
