import PQueue from 'p-queue';

import { getLimit, onLimitChange, setCeiling } from './rateLimitGate';

export interface ConcurrencyOptions {
  /** Maximum number of tasks to run concurrently */
  concurrency: number;
  /** AbortSignal to cancel the operation */
  signal: AbortSignal | null;
  /** Callback called after each task completes with (completed, total) */
  onProgress?: (completed: number, total: number) => void;
  /** Live effective concurrency (`min(concurrency, gate)`) as the gate reacts. */
  onConcurrencyChange?: (effective: number) => void;
}

/**
 * Runs an array of async task thunks with controlled concurrency.
 * Tasks are started based on the concurrency limit, and results are
 * returned in the same order as the input tasks.
 *
 * Concurrency is the min of the configured ceiling and the global rate-limit
 * gate (`rateLimitGate`): a provider 429 collapses the gate to 1 and parks new
 * starts until the cooldown elapses; as clean calls stack up the gate climbs
 * back toward the configured ceiling, and the queue resyncs live.
 *
 * @param tasks - Array of functions that return promises
 * @param options - Concurrency configuration
 * @returns Promise that resolves to array of results in input order
 * @throws Error if signal is already aborted or any task throws
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  options: ConcurrencyOptions,
): Promise<T[]> {
  const { concurrency, signal, onProgress, onConcurrencyChange } = options;

  // Handle empty task array
  if (tasks.length === 0) {
    return [];
  }

  // Check if already aborted
  if (signal?.aborted) {
    throw new Error('Operation cancelled');
  }

  // ponytail: min over config and the global rate-limit gate. When a 429
  // collapses the gate to 1, the queue drains to a single in-flight call and
  // holds new starts until the cooldown elapses; as clean calls stack up the
  // gate climbs back toward the configured ceiling.
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

  // Track completion count for progress reporting
  let completedCount = 0;

  // Wrap each task to handle abort check and progress tracking
  const wrappedTasks = tasks.map((task) => {
    return queue.add(async () => {
      // Check abort before running the task
      if (signal?.aborted) {
        throw new Error('Operation cancelled');
      }

      const result = await task();

      // Update progress after task completes
      completedCount++;
      if (onProgress) {
        onProgress(completedCount, tasks.length);
      }

      return result;
    });
  });

  // Wait for all tasks to complete
  // Promise.all preserves order and rejects on first error
  try {
    return await Promise.all(wrappedTasks);
  } finally {
    off();
  }
}
