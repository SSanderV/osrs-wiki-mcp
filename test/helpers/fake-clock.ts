import type { CancelScheduledTask, Clock } from "../../src/http/deadline.ts";

interface ScheduledTask {
  at: number;
  callback: () => void;
  cancelled: boolean;
}

export class FakeClock implements Clock {
  readonly sleeps: number[] = [];
  #monotonicNow: number;
  #wallNow: number;
  #randomValue: number;
  readonly #scheduled: ScheduledTask[] = [];

  constructor(options: { monotonicNow?: number; wallNow?: number; random?: number } = {}) {
    this.#monotonicNow = options.monotonicNow ?? 0;
    this.#wallNow = options.wallNow ?? Date.parse("2026-07-15T00:00:00.000Z");
    this.#randomValue = options.random ?? 0;
  }

  now(): number {
    return this.#monotonicNow;
  }

  wallNow(): number {
    return this.#wallNow;
  }

  random(): number {
    return this.#randomValue;
  }

  async sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    this.sleeps.push(milliseconds);
    this.advance(milliseconds);
    if (signal?.aborted) throw signal.reason;
  }

  schedule(milliseconds: number, callback: () => void): CancelScheduledTask {
    const task = {
      at: this.#monotonicNow + milliseconds,
      callback,
      cancelled: false,
    };
    this.#scheduled.push(task);
    return () => {
      task.cancelled = true;
    };
  }

  advance(milliseconds: number): void {
    this.#monotonicNow += milliseconds;
    this.#runDueTasks();
  }

  setWallNow(milliseconds: number): void {
    this.#wallNow = milliseconds;
  }

  setRandom(value: number): void {
    this.#randomValue = value;
  }

  #runDueTasks(): void {
    while (true) {
      const next = this.#scheduled
        .filter((task) => !task.cancelled && task.at <= this.#monotonicNow)
        .sort((left, right) => left.at - right.at)[0];
      if (!next) return;
      next.cancelled = true;
      next.callback();
    }
  }
}
