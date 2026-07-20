type Release = () => void;

interface Waiter {
  resolve(release: Release): void;
  reject(reason?: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class Semaphore {
  #available: number;
  readonly #queue: Waiter[] = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError("Semaphore limit must be a positive integer.");
    }
    this.#available = limit;
  }

  acquire(signal?: AbortSignal): Promise<Release> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));

    if (this.#available > 0) {
      this.#available -= 1;
      return Promise.resolve(this.#createRelease());
    }

    return new Promise<Release>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (signal) {
        waiter.signal = signal;
        waiter.onAbort = () => {
          const index = this.#queue.indexOf(waiter);
          if (index >= 0) this.#queue.splice(index, 1);
          reject(abortReason(signal));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.#queue.push(waiter);
    });
  }

  #createRelease(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#grantNext();
    };
  }

  #grantNext(): void {
    while (this.#queue.length > 0) {
      const waiter = this.#queue.shift()!;
      if (waiter.onAbort && waiter.signal) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      if (waiter.signal?.aborted) {
        waiter.reject(abortReason(waiter.signal));
        continue;
      }
      waiter.resolve(this.#createRelease());
      return;
    }
    this.#available += 1;
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
