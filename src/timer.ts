// Reusable countdown timer with tick callbacks

export class Timer {
  private duration: number;
  private remainingTime: number;
  private intervalId: number | null = null;
  private onTimeoutCallback: () => void;
  private onTickCallback: (remaining: number, total: number) => void;

  constructor(
    duration: number,
    onTimeout: () => void,
    onTick: (remaining: number, total: number) => void,
  ) {
    this.duration = duration;
    this.remainingTime = duration;
    this.onTimeoutCallback = onTimeout;
    this.onTickCallback = onTick;
  }

  start(): void {
    this.stop();
    this.remainingTime = this.duration;
    this.onTickCallback(this.remainingTime, this.duration);

    this.intervalId = window.setInterval(() => {
      this.remainingTime -= 100;

      if (this.remainingTime <= 0) {
        this.stop();
        this.onTimeoutCallback();
      } else {
        this.onTickCallback(this.remainingTime, this.duration);
      }
    }, 100);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reset(): void {
    this.stop();
    this.remainingTime = this.duration;
  }
}
