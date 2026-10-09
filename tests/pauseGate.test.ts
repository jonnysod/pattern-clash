import { describe, it, expect, vi } from "vitest";
import { PauseGate } from "../src/pauseGate.js";

describe("PauseGate", () => {
  it("runs continuations immediately while not paused", () => {
    const gate = new PauseGate();
    const fn = vi.fn();
    gate.run(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("parks a continuation while paused and runs it once on resume", () => {
    const gate = new PauseGate();
    const fn = vi.fn();
    gate.pause();
    gate.run(fn);
    expect(fn).not.toHaveBeenCalled();
    gate.resume();
    expect(fn).toHaveBeenCalledTimes(1);
    gate.resume(); // no-op, must not re-run
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resume without a parked continuation only flips the state", () => {
    const gate = new PauseGate();
    gate.pause();
    gate.resume();
    expect(gate.isPaused).toBe(false);
  });

  it("reset drops the parked continuation instead of running it", () => {
    const gate = new PauseGate();
    const fn = vi.fn();
    gate.pause();
    gate.run(fn);
    gate.reset();
    expect(gate.isPaused).toBe(false);
    gate.resume();
    expect(fn).not.toHaveBeenCalled();
  });

  it("toggle alternates and reports every change", () => {
    const gate = new PauseGate();
    const changes: boolean[] = [];
    gate.onChange = (p) => changes.push(p);
    gate.toggle();
    gate.toggle();
    gate.pause();
    gate.pause(); // repeated pause is not a change
    gate.reset();
    gate.reset(); // reset while running is not a change
    expect(changes).toEqual([true, false, true, false]);
  });

  it("a continuation parked from inside a resumed one waits for the next resume", () => {
    // Mirrors a tick that re-schedules itself: after resume the loop runs on,
    // and a pause in between parks the follow-up tick again.
    const gate = new PauseGate();
    const second = vi.fn();
    gate.pause();
    gate.run(() => {
      gate.pause();
      gate.run(second);
    });
    gate.resume();
    expect(second).not.toHaveBeenCalled();
    gate.resume();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("step runs one parked continuation and stays paused", () => {
    // A self-rescheduling loop: each tick parks the next one via the gate.
    const gate = new PauseGate();
    let ticks = 0;
    const tick = (): void => {
      ticks++;
      gate.run(tick);
    };
    gate.pause();
    gate.run(tick);
    expect(gate.step()).toBe(true);
    expect(ticks).toBe(1);
    expect(gate.isPaused).toBe(true);
    expect(gate.step()).toBe(true);
    expect(ticks).toBe(2);
  });

  it("step is a no-op while running or with nothing parked", () => {
    const gate = new PauseGate();
    expect(gate.step()).toBe(false);
    gate.pause();
    expect(gate.step()).toBe(false);
    expect(gate.isPaused).toBe(true);
  });
});
