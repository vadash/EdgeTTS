import { computed, signal } from '@preact/signals';
import { formatHMS } from '@/utils/time';

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
 * Dependency injection seam for logging. Logger and LoggerStore both
 * implement it, so components accept either one.
 */
export interface ILogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: Error, data?: Record<string, unknown>): void;
  debug?(message: string, data?: Record<string, unknown>): void;
}

// ========== Helper Functions ==========

function generateLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function formatElapsedTime(startTime: number): string {
  return formatHMS(Math.floor((Date.now() - startTime) / 1000));
}

// ========== Logger ==========

export class Logger implements ILogger {
  private store: LoggerStore | null;
  private prefix: string;

  constructor(store?: LoggerStore, prefix: string = '') {
    this.store = store ?? null;
    this.prefix = prefix;
  }

  setStore(store: LoggerStore): void {
    this.store = store;
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  private formatMessage(message: string): string {
    return this.prefix ? `[${this.prefix}] ${message}` : message;
  }

  /**
   * Console only: the store never records debug output.
   */
  debug(message: string, data?: Record<string, unknown>): void {
    const formatted = this.formatMessage(message);
    console.debug(`[DEBUG] ${formatted}`, data ?? '');
  }

  info(message: string, data?: Record<string, unknown>): void {
    const formatted = this.formatMessage(message);
    console.log(`[INFO] ${formatted}`, data ?? '');
    this.store?.add('info', formatted, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    const formatted = this.formatMessage(message);
    console.warn(`[WARN] ${formatted}`, data ?? '');
    this.store?.add('warn', formatted, data);
  }

  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    const formatted = this.formatMessage(message);
    const errorData = error ? { ...data, error: error.message, stack: error.stack } : data;

    console.error(`[ERROR] ${formatted}`, error ?? '', data ?? '');
    this.store?.add('error', formatted, errorData);
  }

  child(prefix: string): Logger {
    const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new Logger(this.store ?? undefined, childPrefix);
  }
}

export function createLogger(store?: LoggerStore, prefix?: string): Logger {
  return new Logger(store, prefix);
}

// ========== LoggerStore ==========

export class LoggerStore implements ILogger {
  readonly entries = signal<LogEntry[]>([]);

  readonly maxEntries = signal<number>(2000);

  readonly startTime = signal<number | null>(null);

  // ========== Computed Properties ==========

  readonly hasEntries = computed(() => this.entries.value.length > 0);

  readonly count = computed(() => this.entries.value.length);

  // ========== Actions ==========

  /**
   * Call at Conversion start. Elapsed times measure from this moment.
   */
  startTimer(): void {
    this.startTime.value = Date.now();
  }

  resetTimer(): void {
    this.startTime.value = null;
  }

  add(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      id: generateLogId(),
      timestamp: new Date(),
      elapsed: this.startTime.value ? formatElapsedTime(this.startTime.value) : '00:00:00',
      level,
      message,
      data,
    };

    // Append so entries stay in chronological order.
    const newEntries = [...this.entries.value, entry];

    if (newEntries.length > this.maxEntries.value) {
      newEntries.splice(0, newEntries.length - this.maxEntries.value);
    }

    this.entries.value = newEntries;
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.add('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.add('warn', message, data);
  }

  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    const errorData = error ? { ...data, error: error.message, stack: error.stack } : data;
    this.add('error', message, errorData);
  }

  /**
   * Console only: never stored.
   */
  debug(message: string, data?: Record<string, unknown>): void {
    console.debug(`[DEBUG] ${message}`, data ?? '');
  }

  clear(): void {
    this.entries.value = [];
  }

  setMaxEntries(max: number): void {
    this.maxEntries.value = max;

    if (this.entries.value.length > max) {
      this.entries.value = this.entries.value.slice(-max);
    }
  }

  // ========== Export Methods ==========

  toText(): string {
    return this.entries.value
      .map(
        (e) =>
          `[${e.elapsed}] [${e.level.toUpperCase()}] ${e.message}${e.data ? ` ${JSON.stringify(e.data)}` : ''}`,
      )
      .join('\n');
  }

  toJSON(): string {
    return JSON.stringify(this.entries.value, null, 2);
  }

  toDisplayLines(): string[] {
    return this.entries.value.map((e) => `[${e.elapsed}] ${e.message}`);
  }
}

export function createLoggerStore(): LoggerStore {
  return new LoggerStore();
}
