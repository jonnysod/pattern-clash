// Score effects: floating "+N" text over the game canvas.
// Each ScoreEvent fed in produces one floating text — aggregation
// already happened upstream in Game.scoreBuckets, so the displayed
// numbers match the actual point award exactly.
//
// The same overlay layer also carries placement highlights (see
// highlightPlacement): both are short-lived, purely visual, and must stay
// independent of when the canvas below is redrawn.

import type { ScoreEvent } from "./types.js";
import { CONFIG } from "./config.js";

const FLOAT_DURATION = 1500; // ms for float + fade
const FLOAT_DISTANCE = 40; // px to float upward

interface EffectHandle {
  element: HTMLElement;
  timeoutId: number;
}

// Marks the wrapper/container pair so a later ScoreEffects instance on the
// same canvas (game restart, puzzle retry) can recognize and reuse them
// instead of nesting another layer around an already-wrapped canvas.
const WRAPPER_MARKER = "data-score-effects-wrapper";
const CONTAINER_MARKER = "data-score-effects-container";

export class ScoreEffects {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cellSize: number;
  private activeEffects: Set<EffectHandle> = new Set();

  constructor(canvas: HTMLCanvasElement, cellSize: number) {
    this.canvas = canvas;
    this.cellSize = cellSize;

    const existingWrapper = canvas.parentElement;
    if (existingWrapper?.hasAttribute(WRAPPER_MARKER)) {
      // Reuse: this canvas was already wrapped by a prior ScoreEffects
      // instance. Resize instead of nesting — canvas dimensions can change
      // between constructions (puzzle grids vary in size).
      this.container = existingWrapper.querySelector(
        `:scope > [${CONTAINER_MARKER}]`,
      ) as HTMLElement;
      this.container.innerHTML = "";
      this.container.style.width = canvas.width + "px";
      this.container.style.height = canvas.height + "px";
      return;
    }

    // Create a container positioned exactly over the canvas
    this.container = document.createElement("div");
    this.container.setAttribute(CONTAINER_MARKER, "");
    this.container.style.position = "absolute";
    this.container.style.pointerEvents = "none";
    this.container.style.overflow = "hidden";
    this.container.style.width = canvas.width + "px";
    this.container.style.height = canvas.height + "px";
    this.container.style.left = "0";
    this.container.style.top = "0";

    // Wrap canvas in a relative container if not already
    const wrapper = document.createElement("div");
    wrapper.setAttribute(WRAPPER_MARKER, "");
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

  // Show freshly placed cells in the placer's colour, then fade out. Drawn
  // on its own small canvas in the overlay layer, so sim ticks, the ghost
  // preview, pause and rewind can redraw the board without touching it.
  // Slightly translucent: once the simulation moves the cells away, it
  // reads as a shadow of the placement rather than as live cells.
  highlightPlacement(cells: [number, number][], color: string): void {
    if (cells.length === 0) return;
    const cs = this.cellSize;
    const rows = cells.map(([r]) => r);
    const cols = cells.map(([, c]) => c);
    const minRow = Math.min(...rows);
    const minCol = Math.min(...cols);

    const el = document.createElement("canvas");
    el.width = (Math.max(...cols) - minCol + 1) * cs;
    el.height = (Math.max(...rows) - minRow + 1) * cs;
    // The page's global canvas rule adds a border and a black background;
    // neither belongs on an overlay. The game canvas keeps its border, so
    // its cells start clientLeft/clientTop px inside the layer's origin.
    el.style.cssText = `
      position: absolute;
      left: ${this.canvas.clientLeft + minCol * cs}px;
      top: ${this.canvas.clientTop + minRow * cs}px;
      border: none;
      background: transparent;
      opacity: 0.85;
      z-index: 5;
    `;
    const ctx = el.getContext("2d")!;
    ctx.fillStyle = color;
    for (const [r, c] of cells) {
      // Same footprint as Renderer's live cells (cs - 1, 1px grid gap).
      ctx.fillRect((c - minCol) * cs, (r - minRow) * cs, cs - 1, cs - 1);
    }
    this.container.appendChild(el);

    const fadeMs = CONFIG.PLACEMENT_HIGHLIGHT_FADE_MS;
    const handle: EffectHandle = { element: el, timeoutId: 0 };
    handle.timeoutId = window.setTimeout(() => {
      el.style.transition = `opacity ${fadeMs}ms ease-in`;
      el.style.opacity = "0";
      handle.timeoutId = window.setTimeout(() => {
        el.remove();
        this.activeEffects.delete(handle);
      }, fadeMs);
    }, CONFIG.PLACEMENT_HIGHLIGHT_MS);
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
