// Mock Worker Pool
// Used for testing components that depend on worker pool functionality

import { vi } from 'vitest';
import type { IWorkerPool, PoolTask, WorkerPoolProgress } from '@/services/interfaces';

export class MockWorkerPool implements IWorkerPool {
  private tasks: PoolTask[] = [];
  private completedAudio = new Map<number, Uint8Array>();
  private failedTasks = new Set<number>();
  private completed = 0;

  addTask = vi.fn((task: PoolTask) => {
    this.tasks.push(task);
  });

  addTasks = vi.fn((tasks: PoolTask[]) => {
    this.tasks.push(...tasks);
  });

  getCompletedAudio = vi.fn(() => this.completedAudio);

  getFailedTasks = vi.fn(() => this.failedTasks);

  getProgress = vi.fn((): WorkerPoolProgress => ({
    completed: this.completed,
    total: this.tasks.length,
    failed: this.failedTasks.size,
  }));

  clear = vi.fn(() => {
    this.tasks = [];
    this.completedAudio.clear();
    this.failedTasks.clear();
    this.completed = 0;
  });

  // Test helpers
  simulateProgress(completed: number): void {
    this.completed = completed;
  }

  simulateComplete(index: number, audio: Uint8Array): void {
    this.completedAudio.set(index, audio);
    this.completed++;
  }

  simulateFail(index: number): void {
    this.failedTasks.add(index);
  }

  reset(): void {
    this.tasks = [];
    this.completedAudio.clear();
    this.failedTasks.clear();
    this.completed = 0;
  }
}

export function createMockWorkerPool(): MockWorkerPool {
  return new MockWorkerPool();
}
