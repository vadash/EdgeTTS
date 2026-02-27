// Test setup file for Vitest
// Configures the testing environment with mocks and utilities

import { afterEach, vi } from 'vitest';

// Mock p-retry - executes immediately without retry
vi.mock('p-retry', () => ({
  default: vi.fn(async (fn: (attemptNumber: number) => Promise<unknown>) => fn(1)),
  AbortError: class AbortError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'AbortError';
    }
  },
}));

// Mock p-queue - executes tasks immediately
vi.mock('p-queue', () => ({
  default: class MockPQueue {
    concurrency = 1;
    private listeners: Map<string, Array<() => void>> = new Map();

    add = vi.fn(async (fn: () => Promise<unknown>) => {
      const result = await fn();
      // Trigger idle event after task completes
      setTimeout(() => {
        const idleListeners = this.listeners.get('idle') || [];
        idleListeners.forEach((listener) => listener());
      }, 0);
      return result;
    });
    clear = vi.fn();
    on = vi.fn((event: string, listener: () => void) => {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event)!.push(listener);
    });
    get size() {
      return 0;
    }
    get pending() {
      return 0;
    }
  },
}));

// Mock generic-pool - simple acquire/release without actual pooling
vi.mock('generic-pool', () => ({
  createPool: vi.fn(
    (factory: { create: () => Promise<unknown>; destroy: (obj: unknown) => Promise<void> }) => {
      let created: unknown[] = [];
      return {
        acquire: vi.fn(async () => {
          const obj = await factory.create();
          created.push(obj);
          return obj;
        }),
        release: vi.fn(async () => {}),
        destroy: vi.fn(async (obj: unknown) => {
          await factory.destroy(obj);
          created = created.filter((c) => c !== obj);
        }),
        drain: vi.fn(async () => {}),
        clear: vi.fn(async () => {
          for (const obj of created) {
            await factory.destroy(obj);
          }
          created = [];
        }),
        get size() {
          return created.length;
        },
        get available() {
          return created.length;
        },
        get borrowed() {
          return 0;
        },
        get pending() {
          return 0;
        },
      };
    },
  ),
}));

// Mock browser APIs
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock IndexedDB
const indexedDBMock = {
  open: vi.fn(() => ({
    result: {
      createObjectStore: vi.fn(),
      transaction: vi.fn(() => ({
        objectStore: vi.fn(() => ({
          get: vi.fn(),
          put: vi.fn(),
          delete: vi.fn(),
        })),
      })),
    },
    onsuccess: null,
    onerror: null,
  })),
  deleteDatabase: vi.fn(),
};

Object.defineProperty(window, 'indexedDB', {
  value: indexedDBMock,
});

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public url: string) {
    setTimeout(() => this.onopen?.(new Event('open')), 0);
  }

  send = vi.fn();
  close = vi.fn();
}

Object.defineProperty(window, 'WebSocket', {
  value: MockWebSocket,
});

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn(() => Promise.resolve()),
    readText: vi.fn(() => Promise.resolve('')),
  },
});

// Mock URL.createObjectURL / revokeObjectURL
URL.createObjectURL = vi.fn(() => 'blob:mock-url');
URL.revokeObjectURL = vi.fn();

// Mock Audio
class MockAudio {
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
}

Object.defineProperty(window, 'Audio', {
  value: MockAudio,
});

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  value: MockResizeObserver,
});

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'IntersectionObserver', {
  value: MockIntersectionObserver,
});

// Clear all mocks after each test
afterEach(() => {
  vi.clearAllMocks();
  localStorageMock.clear();
});
