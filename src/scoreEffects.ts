// Score effects: floating "+N" text over the game canvas.
// Each ScoreEvent fed in produces one floating text — aggregation
// already happened upstream in Game.scoreBuckets, so the displayed
// numbers match the actual point award exactly.

import type { ScoreEvent } from "./types.js";
import { CONFIG } from "./config.js";

const FLOAT_DURATION = 1500; // ms for float + fade
const FLOAT_DISTANCE = 40; // px to float upward

interface EffectHandle {
  element: HTMLDivElement;
  timeoutId: number;
}

export class ScoreEffects {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cellSize: number;
  private activeEffects: Set<EffectHandle> = new Set();

  constructor(canvas: HTMLCanvasElement, cellSize: number) {
    this.canvas = canvas;
    this.cellSize = cellSize;

    // Create a container positioned exactly over the canvas
    this.container = document.createElement("div");
    this.container.style.position = "absolute";
    this.container.style.pointerEvents = "none";
    this.container.style.overflow = "hidden";
    this.container.style.width = canvas.width + "px";
    this.container.style.height = canvas.height + "px";
    this.container.style.left = "0";
    this.container.style.top = "0";

    // Wrap canvas in a relative container if not already
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.display = "inline-block";
    canvas.parentElement!.insertBefore(wrapper, canvas);
    wrapper.appendChild(canvas);
    wrapper.appendChild(this.container);
  }

  // Feed score events from a generation. Each event becomes its own
  // floating text — Game already aggregated nearby hits into one
  // event per bucket flush, so there's nothing more to do here.
  feed(events: ScoreEvent[]): void {
    for (const event of events) {
      this.createEffect(event);
    }
  }

  private createEffect(event: ScoreEvent): void {
    const el = document.createElement("div");
    const x = event.col * this.cellSize;
    const y = event.row * this.cellSize;

    const color =
      event.scorer === 1 ? CONFIG.COLOR_PLAYER1 : CONFIG.COLOR_PLAYER2;

    el.textContent = `+${event.points}`;
    el.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      color: ${color};
      font-size: 16px;
      font-weight: bold;
      font-family: Arial, sans-serif;
      text-shadow: 0 0 4px ${color}, 0 0 8px rgba(0,0,0,0.8);
      opacity: 1;
      transition: transform ${FLOAT_DURATION}ms ease-out, opacity ${FLOAT_DURATION}ms ease-in;
      transform: translateY(0px);
      z-index: 10;
    `;

    this.container.appendChild(el);

    // Trigger animation on next frame
    requestAnimationFrame(() => {
      el.style.transform = `translateY(-${FLOAT_DISTANCE}px)`;
      el.style.opacity = "0";
    });

    // Self-removing handle: when the timeout fires, the element is
    // detached and the handle removes itself from the active set.
    const handle: EffectHandle = { element: el, timeoutId: 0 };
    handle.timeoutId = window.setTimeout(() => {
      el.remove();
      this.activeEffects.delete(handle);
    }, FLOAT_DURATION);
    this.activeEffects.add(handle);
  }

  clear(): void {
    for (const handle of this.activeEffects) {
      clearTimeout(handle.timeoutId);
      handle.element.remove();
    }
    this.activeEffects.clear();
  }
}
