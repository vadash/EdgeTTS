// Logger Module
// Consolidated logger with LogStore integration

import { computed, signal } from '@preact/signals';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: Date;
  elapsed: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Minimal logger interface for dependency injection
 * Both Logger and LoggerStore implement this
 */
export interface ILogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: Error, data?: Record<string, unknown>): void;
  debug?(message: string, data?: Record<string, unknown>): void;
}

// ========== Helper Functions ==========

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

// ========== Logger ==========

/**
 * Logger - logs to console and LoggerStore
 */
export class Logger implements ILogger {
  private store: LoggerStore | null;
  private prefix: string;

  constructor(store?: LoggerStore, prefix: string = '') {
    this.store = store ?? null;
    this.prefix = prefix;
  }

  /**
   * Set the log store (can be set after construction)
   */
  setStore(store: LoggerStore): void {
    this.store = store;
  }

  /**
   * Set prefix for all log messages
   */
  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  /**
   * Format message with prefix
   */
  private formatMessage(message: string): string {
    return this.prefix ? `[${this.prefix}] ${message}` : message;
  }

  /**
   * Log debug message (console only - not stored in UI)
   */
  debug(message: string, data?: Record<string, unknown>): void {
    const formatted = this.formatMessage(message);
    console.debug(`[DEBUG] ${formatted}`, data ?? '');
  }

  /**
   * Log info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    const formatted = this.formatMessage(message);
    console.log(`[INFO] ${formatted}`, data ?? '');
    this.store?.add('info', formatted, data);
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    const formatted = this.formatMessage(message);
    console.warn(`[WARN] ${formatted}`, data ?? '');
    this.store?.add('warn', formatted, data);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    const formatted = this.formatMessage(message);
    const errorData = error ? { ...data, error: error.message, stack: error.stack } : data;

    console.error(`[ERROR] ${formatted}`, error ?? '', data ?? '');
    this.store?.add('error', formatted, errorData);
  }

  /**
   * Create a child logger with a prefix
   */
  child(prefix: string): Logger {
    const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new Logger(this.store ?? undefined, childPrefix);
  }
}

/**
 * Create a new Logger
 */
export function createLogger(store?: LoggerStore, prefix?: string): Logger {
  return new Logger(store, prefix);
}

// ========== LoggerStore ==========

/**
 * Logger Store - manages application logs
 */
export class LoggerStore implements ILogger {
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
    const errorData = error ? { ...data, error: error.message, stack: error.stack } : data;
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
      .map(
        (e) =>
          `[${e.elapsed}] [${e.level.toUpperCase()}] ${e.message}${e.data ? ` ${JSON.stringify(e.data)}` : ''}`,
      )
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
    return this.entries.value.map((e) => `[${e.elapsed}] ${e.message}`);
  }

  /**
   * Get entries as simple string array (backward compatible)
   */
  getStatusLines(): string[] {
    return this.toDisplayLines();
  }
}

/**
 * Create a new LoggerStore instance
 */
export function createLoggerStore(): LoggerStore {
  return new LoggerStore();
}
