interface FlightEntry<V> {
  controller: AbortController;
  promise: Promise<V>;
  subscribers: number;
  settled: boolean;
}

export class SingleFlight<K, V> {
  readonly #flights = new Map<K, FlightEntry<V>>();

  run(
    key: K,
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<V>,
  ): Promise<V> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));

    let entry = this.#flights.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = {
        controller,
        promise: Promise.resolve().then(() => operation(controller.signal)),
        subscribers: 0,
        settled: false,
      };
      this.#flights.set(key, entry);
      const createdEntry = entry;
      void createdEntry.promise.then(
        () => this.#settle(key, createdEntry),
        () => this.#settle(key, createdEntry),
      );
    }

    entry.subscribers += 1;
    return this.#subscribe(key, entry, signal);
  }

  #subscribe(key: K, entry: FlightEntry<V>, signal?: AbortSignal): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      let finished = false;
      const finish = (callback: () => void) => {
        if (finished) return;
        finished = true;
        if (signal) signal.removeEventListener("abort", onAbort);
        entry.subscribers -= 1;
        callback();
        if (entry.subscribers === 0 && !entry.settled) {
          if (this.#flights.get(key) === entry) this.#flights.delete(key);
          entry.controller.abort(new DOMException("All subscribers cancelled.", "AbortError"));
        }
      };
      const onAbort = () => finish(() => reject(abortReason(signal!)));

      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      void entry.promise.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  #settle(key: K, entry: FlightEntry<V>): void {
    entry.settled = true;
    if (this.#flights.get(key) === entry) this.#flights.delete(key);
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
