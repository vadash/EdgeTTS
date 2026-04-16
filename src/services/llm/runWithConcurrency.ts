import PQueue from 'p-queue';

export interface ConcurrencyOptions {
  /** Maximum number of tasks to run concurrently */
  concurrency: number;
  /** AbortSignal to cancel the operation */
  signal: AbortSignal | null;
  /** Callback called after each task completes with (completed, total) */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Runs an array of async task thunks with controlled concurrency.
 * Tasks are started based on the concurrency limit, and results are
 * returned in the same order as the input tasks.
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
  const { concurrency, signal, onProgress } = options;

  // Handle empty task array
  if (tasks.length === 0) {
    return [];
  }

  // Check if already aborted
  if (signal?.aborted) {
    throw new Error('Operation cancelled');
  }

  // Create queue with concurrency limit
  const queue = new PQueue({ concurrency });

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
  return Promise.all(wrappedTasks);
}
