import PQueue from 'p-queue';

import { throwIfAborted } from '@/errors';
import { getLimit, onLimitChange, setCeiling } from './rateLimitGate';

export interface ConcurrencyOptions {
  concurrency: number;
  signal: AbortSignal | null;
  onProgress?: (completed: number, total: number) => void;
  /** Live effective concurrency (`min(concurrency, gate)`) as the gate reacts. */
  onConcurrencyChange?: (effective: number) => void;
}

/**
 * Run task thunks with controlled concurrency and collect the results in
 * input order.
 *
 * Concurrency is the minimum of the configured ceiling and the global
 * rate-limit gate (`rateLimitGate`): a provider 429 collapses the gate to 1
 * and parks new starts until the cooldown elapses, then clean calls climb
 * the gate back toward the ceiling while the queue resyncs live.
 *
 * @throws Error if the signal is already aborted or any task throws.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  options: ConcurrencyOptions,
): Promise<T[]> {
  const { concurrency, signal, onProgress, onConcurrencyChange } = options;

  if (tasks.length === 0) {
    return [];
  }

  throwIfAborted(signal);

  setCeiling(concurrency);
  const effective = Math.min(concurrency, getLimit());
  const queue = new PQueue({ concurrency: effective });

  // Re-sync live as the gate reacts to 429s and recoveries. The effective
  // value is what both the queue and any status badge must display, so the
  // badge subscribes here instead of reading the configured ceiling once.
  const off = onLimitChange((next) => {
    const live = Math.max(1, Math.min(concurrency, next));
    queue.concurrency = live;
    onConcurrencyChange?.(live);
  });
  onConcurrencyChange?.(Math.max(1, effective));

  let completedCount = 0;

  const wrappedTasks = tasks.map((task) => {
    return queue.add(async () => {
      throwIfAborted(signal);

      const result = await task();

      completedCount++;
      if (onProgress) {
        onProgress(completedCount, tasks.length);
      }

      return result;
    });
  });

  // Promise.all preserves order and rejects on first error
  try {
    return await Promise.all(wrappedTasks);
  } finally {
    off();
  }
}
