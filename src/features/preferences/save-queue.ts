import type { PreferenceValue } from "@/domain/shifts/shift-type";

/**
 * Auto-save of one day's preference, as a small framework-free state
 * machine (the React hook only subscribes to it), so its race handling is
 * unit-tested directly.
 *
 * - One request per day at a time. A choice made while a save is in flight
 *   is queued; only the latest queued choice is sent, after the current one
 *   settles. Saves of one day therefore reach the server in the order the
 *   nurse made them, and the last one sent is the last one chosen.
 * - `shown` is what the day displays: the latest choice while saving, then
 *   what the server confirmed. A failed save never stays on screen: the day
 *   falls back to the last confirmed value and says what was not saved.
 * - Repeating the shown choice sends nothing (no duplicate submissions).
 */

export type PreferenceChoice = PreferenceValue | null;

export type SaveResult =
  | { readonly ok: true; readonly value: PreferenceChoice }
  | {
      readonly ok: false;
      readonly message: string;
      readonly retryable: boolean;
    };

export type SavePhase = "idle" | "saving" | "saved" | "error";

export interface SaveState {
  /** The value the day displays. */
  readonly shown: PreferenceChoice;
  /** The last value the server confirmed as stored. */
  readonly confirmed: PreferenceChoice;
  readonly phase: SavePhase;
  /** Set in the `error` phase: the choice that was not saved, and why. */
  readonly failure: {
    readonly value: PreferenceChoice;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
}

export const NETWORK_FAILURE: SaveResult = {
  ok: false,
  message: "ارتباط با سرور برقرار نشد.",
  retryable: true,
};

export interface PreferenceSaver {
  getState(): SaveState;
  /** Pick a value (null clears). */
  choose(value: PreferenceChoice): void;
  /** Send the failed choice again. */
  retry(): void;
  /** The server's value changed (a page refresh); applied only when idle. */
  sync(value: PreferenceChoice): void;
  /** The "saved" confirmation has been shown long enough. */
  settle(): void;
  subscribe(listener: () => void): () => void;
}

export function createPreferenceSaver(
  initial: PreferenceChoice,
  send: (value: PreferenceChoice) => Promise<SaveResult>,
  onConfirmed?: (value: PreferenceChoice) => void,
): PreferenceSaver {
  let state: SaveState = {
    shown: initial,
    confirmed: initial,
    phase: "idle",
    failure: null,
  };
  let inFlight = false;
  // `undefined`: nothing queued (null is a real choice: clear).
  let queued: PreferenceChoice | undefined;
  const listeners = new Set<() => void>();

  const update = (next: Partial<SaveState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  function start(value: PreferenceChoice) {
    inFlight = true;
    let request: Promise<SaveResult>;
    try {
      request = send(value);
    } catch {
      request = Promise.resolve(NETWORK_FAILURE);
    }
    request
      .catch(() => NETWORK_FAILURE)
      .then((result) => complete(value, result));
  }

  function complete(value: PreferenceChoice, result: SaveResult) {
    inFlight = false;
    if (result.ok && result.value !== state.confirmed) {
      state = { ...state, confirmed: result.value };
      onConfirmed?.(result.value);
    }
    if (queued !== undefined) {
      const next = queued;
      queued = undefined;
      if (next !== state.confirmed) {
        update({ shown: next, phase: "saving", failure: null });
        start(next);
        return;
      }
      // The latest choice is already what the server holds.
      update({ shown: next, phase: "saved", failure: null });
      return;
    }
    update(
      result.ok
        ? { shown: state.confirmed, phase: "saved", failure: null }
        : {
            shown: state.confirmed,
            phase: "error",
            failure: {
              value,
              message: result.message,
              retryable: result.retryable,
            },
          },
    );
  }

  function submit(value: PreferenceChoice) {
    if (inFlight) {
      queued = value;
      update({ shown: value, phase: "saving", failure: null });
      return;
    }
    if (value === state.confirmed) {
      // Back to the stored value before anything was sent: nothing to save.
      update({ shown: value, phase: "idle", failure: null });
      return;
    }
    update({ shown: value, phase: "saving", failure: null });
    start(value);
  }

  return {
    getState: () => state,
    choose(value) {
      if (value === state.shown && state.phase !== "error") return;
      submit(value);
    },
    retry() {
      // An error is only reported once nothing is in flight.
      if (!state.failure) return;
      const { value } = state.failure;
      update({ shown: value, phase: "saving", failure: null });
      start(value);
    },
    sync(value) {
      if (inFlight || value === state.confirmed) return;
      update({ confirmed: value, shown: value });
    },
    settle() {
      if (state.phase === "saved") update({ phase: "idle" });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
