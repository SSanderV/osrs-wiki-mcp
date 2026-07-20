import { setTimeout as delay } from "node:timers/promises";
import { clearTimeout, setTimeout } from "node:timers";

export type CancelScheduledTask = () => void;

export interface Clock {
  now(): number;
  wallNow(): number;
  random(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
  schedule(milliseconds: number, callback: () => void): CancelScheduledTask;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  wallNow: () => Date.now(),
  random: () => Math.random(),
  async sleep(milliseconds, signal) {
    await delay(milliseconds, undefined, signal ? { signal } : undefined);
  },
  schedule(milliseconds, callback) {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};

export class Deadline {
  readonly #clock: Clock;
  readonly #endsAt: number;

  private constructor(clock: Clock, endsAt: number) {
    this.#clock = clock;
    this.#endsAt = endsAt;
  }

  static after(clock: Clock, milliseconds: number): Deadline {
    assertDuration(milliseconds);
    return new Deadline(clock, clock.now() + milliseconds);
  }

  child(maximumMilliseconds: number): Deadline {
    assertDuration(maximumMilliseconds);
    return new Deadline(
      this.#clock,
      Math.min(this.#endsAt, this.#clock.now() + maximumMilliseconds),
    );
  }

  remaining(): number {
    return Math.max(0, this.#endsAt - this.#clock.now());
  }

  expired(): boolean {
    return this.remaining() === 0;
  }
}

function assertDuration(milliseconds: number): void {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new RangeError("Deadline duration must be a finite non-negative number.");
  }
}
