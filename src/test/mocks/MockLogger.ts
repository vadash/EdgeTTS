// Mock Logger Service
// Used for testing components that depend on logging

import { vi } from 'vitest';
import type { Logger } from '@/services/Logger';

export interface LogCall {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: Record<string, unknown>;
}

export class MockLogger implements Logger {
  public calls: LogCall[] = [];

  info = vi.fn((message: string, data?: Record<string, unknown>) => {
    this.calls.push({ level: 'info', message, data });
  });

  warn = vi.fn((message: string, data?: Record<string, unknown>) => {
    this.calls.push({ level: 'warn', message, data });
  });

  error = vi.fn((message: string, error?: Error, data?: Record<string, unknown>) => {
    this.calls.push({
      level: 'error',
      message,
      data: {
        ...data,
        ...(error ? { error: error.message, stack: error.stack } : {}),
      },
    });
  });

  debug = vi.fn((message: string, data?: Record<string, unknown>) => {
    this.calls.push({ level: 'debug', message, data });
  });

  // Test helpers
  getInfoCalls(): LogCall[] {
    return this.calls.filter((c) => c.level === 'info');
  }

  getWarnCalls(): LogCall[] {
    return this.calls.filter((c) => c.level === 'warn');
  }

  getErrorCalls(): LogCall[] {
    return this.calls.filter((c) => c.level === 'error');
  }

  getDebugCalls(): LogCall[] {
    return this.calls.filter((c) => c.level === 'debug');
  }

  hasMessage(message: string): boolean {
    return this.calls.some((c) => c.message.includes(message));
  }

  reset(): void {
    this.calls = [];
  }
}

export function createMockLogger(): MockLogger {
  return new MockLogger();
}
