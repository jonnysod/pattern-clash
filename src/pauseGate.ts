// Pause support for timer-driven simulation loops.
//
// The sim loops (UIController, PuzzleRunner) are chains of setTimeout
// callbacks: ticks, plus hold timers after a stability skip or segment end.
// Instead of cancelling and re-arming each timer kind on pause, every
// callback passes through the gate: while paused, the continuation is
// parked and runs on resume. A timer that fires during the pause therefore
// costs nothing, and no timer kind can be forgotten.
//
// Only one continuation can be parked — the loops are strictly sequential
// (exactly one pending timer at a time), so a second park would be a bug.

import { logWarn } from "./logger.js";

export class PauseGate {
  private paused: boolean = false;
  private parked: (() => void) | null = null;

  // Fired after every pause/resume so the owner can refresh its button.
  onChange: ((paused: boolean) => void) | null = null;

  get isPaused(): boolean {
    return this.paused;
  }

  // Run the continuation now, or park it until resume().
  run(continuation: () => void): void {
    if (!this.paused) {
      continuation();
      return;
    }
    if (this.parked !== null) {
      logWarn("[PauseGate] replacing an already parked continuation");
    }
    this.parked = continuation;
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.onChange?.(true);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const continuation = this.parked;
    this.parked = null;
    this.onChange?.(false);
    continuation?.();
  }

  // While paused: run the parked continuation once and stay paused. The
  // loop re-schedules itself as usual, and its next callback parks again —
  // so one step is exactly one tick (or, at a segment end, the hold's
  // follow-up). Returns false if nothing was parked yet: the next tick's
  // timer hasn't fired, which only happens within one tick interval of
  // the previous step.
  step(): boolean {
    if (!this.paused || this.parked === null) return false;
    const continuation = this.parked;
    this.parked = null;
    continuation();
    return true;
  }

  toggle(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  // Drop any parked continuation without running it — for teardown paths
  // (sim end, quit, retry), where resuming would act on a dead run.
  reset(): void {
    const wasPaused = this.paused;
    this.paused = false;
    this.parked = null;
    if (wasPaused) this.onChange?.(false);
  }
}

// Space toggles pause. Shared so all screens agree on what counts as
// "the player is typing" (lobby code input) and so a focused button isn't
// clicked by the same key press.
export function isPauseKey(e: KeyboardEvent): boolean {
  return e.code === "Space" && !e.repeat && !isTyping(e);
}

// Right arrow steps one generation while paused. Key repeat is allowed:
// holding the key is a natural slow-motion.
export function isStepKey(e: KeyboardEvent): boolean {
  return e.code === "ArrowRight" && !isTyping(e);
}

function isTyping(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}
