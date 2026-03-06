// Score effects: floating "+N" text over the game canvas
// Aggregates nearby score events to avoid visual clutter.

import type { Player, ScoreEvent } from "./types.js";
import { CONFIG } from "./config.js";

const REGION_SIZE = 5; // Cells to group into one region
const FLOAT_DURATION = 1500; // ms for float + fade
const FLOAT_DISTANCE = 40; // px to float upward

interface ActiveEffect {
  element: HTMLDivElement;
  totalPoints: number;
  scorer: Player;
  timeoutId: number;
  regionKey: string;
}

export class ScoreEffects {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cellSize: number;
  private activeEffects: Map<string, ActiveEffect> = new Map();

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

  // Feed score events from a generation
  feed(events: ScoreEvent[]): void {
    for (const event of events) {
      const regionKey = this.getRegionKey(event.row, event.col, event.scorer);
      const existing = this.activeEffects.get(regionKey);

      if (existing) {
        // Aggregate: increase points, restart animation
        existing.totalPoints += event.points;
        existing.element.textContent = `+${existing.totalPoints}`;
        this.restartAnimation(existing);
      } else {
        // Create new floating text
        this.createEffect(event, regionKey);
      }
    }
  }

  private getRegionKey(row: number, col: number, scorer: Player): string {
    const regionRow = Math.floor(row / REGION_SIZE);
    const regionCol = Math.floor(col / REGION_SIZE);
    return `${scorer}-${regionRow}-${regionCol}`;
  }

  private createEffect(event: ScoreEvent, regionKey: string): void {
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

    const timeoutId = window.setTimeout(() => {
      this.removeEffect(regionKey);
    }, FLOAT_DURATION);

    this.activeEffects.set(regionKey, {
      element: el,
      totalPoints: event.points,
      scorer: event.scorer,
      regionKey,
      timeoutId,
    });
  }

  private restartAnimation(effect: ActiveEffect): void {
    // Clear old timeout
    clearTimeout(effect.timeoutId);

    const el = effect.element;
    const color =
      effect.scorer === 1 ? CONFIG.COLOR_PLAYER1 : CONFIG.COLOR_PLAYER2;

    // Reset position and opacity instantly
    el.style.transition = "none";
    el.style.transform = "translateY(0px)";
    el.style.opacity = "1";
    el.style.color = color;

    // Re-trigger float animation on next frame
    requestAnimationFrame(() => {
      el.style.transition = `transform ${FLOAT_DURATION}ms ease-out, opacity ${FLOAT_DURATION}ms ease-in`;
      el.style.transform = `translateY(-${FLOAT_DISTANCE}px)`;
      el.style.opacity = "0";
    });

    effect.timeoutId = window.setTimeout(() => {
      this.removeEffect(effect.regionKey);
    }, FLOAT_DURATION);
  }

  private removeEffect(regionKey: string): void {
    const effect = this.activeEffects.get(regionKey);
    if (effect) {
      effect.element.remove();
      this.activeEffects.delete(regionKey);
    }
  }

  clear(): void {
    for (const effect of this.activeEffects.values()) {
      clearTimeout(effect.timeoutId);
      effect.element.remove();
    }
    this.activeEffects.clear();
  }
}
