/**
 * Conversion-scoped Connection pool draw (ADR-0022). The entries are shuffled
 * once with Fisher-Yates, and the order stays frozen for the whole Conversion.
 * Every request takes the next slot in that order; 429 parks one slot until
 * the provider deadline, 401/403 ejects it for the run. When no slot remains,
 * the draw fails the Conversion instead of falling back to a stage triple.
 */

import { getErrorMessage } from '@/errors';
import type { PoolEntry } from './pool';

/** Fallback park duration when a 429 carries no Retry-After deadline. */
export const DEFAULT_POOL_PARK_MS = 60_000;

export interface PoolSlot {
  entry: PoolEntry;
  /** 0-based position in the frozen shuffled order. */
  slot: number;
}

/** Every pool slot is parked or ejected; the pass must fail (ADR-0022). */
export class PoolExhaustedError extends Error {
  constructor(count: number, cause?: unknown) {
    super(
      `Connection pool exhausted: all ${count} entries are parked or ejected${cause ? ` (${getErrorMessage(cause)})` : ''}`,
    );
    this.name = 'PoolExhaustedError';
  }
}

interface PoolState {
  entry: PoolEntry;
  parkedUntil: number;
  ejected: boolean;
}

export interface PoolDraw {
  readonly size: number;
  /** Next healthy slot in the frozen order; throws PoolExhaustedError when none is. */
  draw(): PoolSlot;
  /** Skip the slot until the provider deadline (429). */
  park(slot: PoolSlot, retryAfterMs?: number | null): void;
  /** Drop the slot for the rest of the Conversion (401/403). */
  eject(slot: PoolSlot): void;
}

/**
 * Fisher-Yates shuffle makes the draw order uniform; `random` is injectable
 * so tests can freeze the order without mocking globals.
 */
export function createPoolDraw(entries: PoolEntry[], random: () => number = Math.random): PoolDraw {
  const states: PoolState[] = entries.map((entry) => ({
    entry,
    parkedUntil: 0,
    ejected: false,
  }));

  for (let i = states.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [states[i], states[j]] = [states[j], states[i]];
  }

  let counter = 0;

  const slotAt = (position: number): PoolSlot => ({
    entry: states[position].entry,
    slot: position,
  });

  return {
    size: states.length,

    draw(): PoolSlot {
      if (states.length === 0) throw new PoolExhaustedError(0);
      const now = Date.now();
      // Counter increments per skipped slot too, so a parked slot never
      // sticks: the next healthy slot always wins the current request.
      for (let attempts = 0; attempts < states.length; attempts++) {
        const position = counter++ % states.length;
        const state = states[position];
        if (state.ejected) continue;
        if (state.parkedUntil > now) continue;
        return slotAt(position);
      }
      throw new PoolExhaustedError(states.length);
    },

    park(slot: PoolSlot, retryAfterMs?: number | null): void {
      const state = states[slot.slot];
      const waitMs =
        retryAfterMs !== undefined && retryAfterMs !== null && retryAfterMs > 0
          ? retryAfterMs
          : DEFAULT_POOL_PARK_MS;
      state.parkedUntil = Math.max(state.parkedUntil, Date.now() + waitMs);
    },

    eject(slot: PoolSlot): void {
      const state = states[slot.slot];
      state.ejected = true;
      state.parkedUntil = 0;
    },
  };
}
