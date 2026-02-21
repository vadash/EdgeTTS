// Log Store
// Manages application logs with structured entries

import { signal, computed } from '@preact/signals';
import type { LogLevel, LogEntry, ILogger } from '@/services/LoggerService';

/**
 * Generate unique ID for log entries
 */
function generateLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Format duration in ms to HH:MM:SS
 */
function formatElapsedTime(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Log Store - manages application logs
 */
export class LogStore implements ILogger {
  // Log entries
  readonly entries = signal<LogEntry[]>([]);

  // Configuration
  readonly maxEntries = signal<number>(2000);

  // Timer state
  readonly startTime = signal<number | null>(null);

  // ========== Computed Properties ==========

  /**
   * Check if there are any entries
   */
  readonly hasEntries = computed(() => this.entries.value.length > 0);

  /**
   * Total entry count
   */
  readonly count = computed(() => this.entries.value.length);

  // ========== Actions ==========

  /**
   * Start the timer (call at conversion start)
   */
  startTimer(): void {
    this.startTime.value = Date.now();
  }

  /**
   * Reset the timer
   */
  resetTimer(): void {
    this.startTime.value = null;
  }

  /**
   * Add a log entry
   */
  add(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      id: generateLogId(),
      timestamp: new Date(),
      elapsed: this.startTime.value ? formatElapsedTime(this.startTime.value) : '00:00:00',
      level,
      message,
      data,
    };

    // Prepend to array (newest first) or append (oldest first)
    // Using append for chronological order
    const newEntries = [...this.entries.value, entry];

    // Trim to max entries
    if (newEntries.length > this.maxEntries.value) {
      newEntries.splice(0, newEntries.length - this.maxEntries.value);
    }

    this.entries.value = newEntries;
  }

  /**
   * Add info entry
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.add('info', message, data);
  }

  /**
   * Add warning entry
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.add('warn', message, data);
  }

  /**
   * Add error entry
   */
  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    const errorData = error
      ? { ...data, error: error.message, stack: error.stack }
      : data;
    this.add('error', message, errorData);
  }

  /**
   * Add debug entry (console only - not stored)
   */
  debug(message: string, data?: Record<string, unknown>): void {
    console.debug(`[DEBUG] ${message}`, data ?? '');
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.value = [];
  }

  /**
   * Set max entries
   */
  setMaxEntries(max: number): void {
    this.maxEntries.value = max;

    // Trim if needed
    if (this.entries.value.length > max) {
      this.entries.value = this.entries.value.slice(-max);
    }
  }

  // ========== Export Methods ==========

  /**
   * Export logs as plain text
   */
  toText(): string {
    return this.entries.value
      .map(e => `[${e.elapsed}] [${e.level.toUpperCase()}] ${e.message}${e.data ? ' ' + JSON.stringify(e.data) : ''}`)
      .join('\n');
  }

  /**
   * Export logs as JSON
   */
  toJSON(): string {
    return JSON.stringify(this.entries.value, null, 2);
  }

  /**
   * Export logs for display (formatted strings)
   */
  toDisplayLines(): string[] {
    return this.entries.value.map(e => `[${e.elapsed}] ${e.message}`);
  }

  /**
   * Get entries as simple string array (backward compatible)
   */
  getStatusLines(): string[] {
    return this.toDisplayLines();
  }
}

/**
 * Create a new LogStore instance
 */
export function createLogStore(): LogStore {
  return new LogStore();
}
