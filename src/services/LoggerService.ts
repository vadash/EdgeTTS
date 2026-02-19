// Logger Service
// Implements ILogger interface with LogStore integration

import type { ILogger, LogLevel } from '@/services/interfaces';
import type { LogStore } from '@/stores/LogStore';

/**
 * Logger Service - logs to console and LogStore
 */
export class LoggerService implements ILogger {
  private store: LogStore | null;
  private prefix: string;

  constructor(store?: LogStore, prefix: string = '') {
    this.store = store ?? null;
    this.prefix = prefix;
  }

  /**
   * Set the log store (can be set after construction)
   */
  setStore(store: LogStore): void {
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
    const errorData = error
      ? { ...data, error: error.message, stack: error.stack }
      : data;

    console.error(`[ERROR] ${formatted}`, error ?? '', data ?? '');
    this.store?.add('error', formatted, errorData);
  }

  /**
   * Create a child logger with a prefix
   */
  child(prefix: string): LoggerService {
    const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new LoggerService(this.store ?? undefined, childPrefix);
  }
}

/**
 * Create a new LoggerService
 */
export function createLoggerService(store?: LogStore, prefix?: string): LoggerService {
  return new LoggerService(store, prefix);
}

