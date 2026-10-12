// Short rewind buffer for a paused simulation — view only.
//
// Rewinding never touches the engine. Its state is more than the grid
// (score buckets, stability history, the bot's observation recording), so
// winding it back and replaying would re-credit points and feed the bot the
// same events twice. Instead the last few frames are copied here, and
// "back" only changes which frame is *shown*. Stepping forward walks the
// view back towards the newest frame; only from there does the real
// simulation advance again.
//
// The buffer is short on purpose (CONFIG.REWIND_GENERATIONS): it answers
// "what just happened", and a near window keeps the player oriented.
// Memory is not the reason — a whole 250-generation phase would be ~2.5 MB.

export interface HistoryFrame {
  generation: number;
  grid: boolean[][];
  score1: number;
  score2: number;
}

export class FrameHistory {
  // Oldest first; the last entry is the live frame.
  private frames: HistoryFrame[] = [];
  // How many frames behind live the view is. 0 = live.
  private offset: number = 0;

  constructor(private readonly maxStepsBack: number) {}

  // Store a copy of the current live frame. Recording only happens while
  // the simulation advances, which only happens with the view at live.
  record(
    generation: number,
    grid: boolean[][],
    score1: number,
    score2: number,
  ): void {
    this.frames.push({
      generation,
      grid: grid.map((row) => row.slice()),
      score1,
      score2,
    });
    if (this.frames.length > this.maxStepsBack + 1) this.frames.shift();
    this.offset = 0;
  }

  clear(): void {
    this.frames = [];
    this.offset = 0;
  }

  get isViewingHistory(): boolean {
    return this.offset > 0;
  }

  get stepsBack(): number {
    return this.offset;
  }

  get canGoBack(): boolean {
    return this.offset < this.frames.length - 1;
  }

  back(): boolean {
    if (!this.canGoBack) return false;
    this.offset++;
    return true;
  }

  forward(): boolean {
    if (this.offset === 0) return false;
    this.offset--;
    return true;
  }

  toLive(): void {
    this.offset = 0;
  }

  // Generations of the oldest reachable and the live frame, or null if
  // nothing was recorded.
  get range(): { oldest: number; live: number } | null {
    const oldest = this.frames[0];
    const live = this.frames[this.frames.length - 1];
    if (!oldest || !live) return null;
    return { oldest: oldest.generation, live: live.generation };
  }

  // The frame currently in view, or null if nothing was recorded.
  current(): HistoryFrame | null {
    return this.frames[this.frames.length - 1 - this.offset] ?? null;
  }
}
