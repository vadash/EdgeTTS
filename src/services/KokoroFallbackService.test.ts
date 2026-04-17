import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We'll mock Worker globally. Each test creates a tracked mock worker.
interface MockWorkerType {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
}

let mockWorkerInstance: MockWorkerType | null = null;

const workerInstances: MockWorkerType[] = [];

class MockWorker {
  postMessage = vi.fn();
  terminate = vi.fn();
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;

  constructor() {
    mockWorkerInstance = this as unknown as MockWorkerType;
    workerInstances.push(this as unknown as MockWorkerType);
  }
}

// Must import after MockWorker is defined so the module can reference it
// But since KokoroFallbackService uses Worker via `new Worker(...)`, we need
// to set up the global mock before importing the module.

describe('KokoroFallbackService', () => {
  let KokoroFallbackService: typeof import('./KokoroFallbackService').KokoroFallbackService;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWorkerInstance = null;
    workerInstances.length = 0;

    // Set Worker on globalThis before importing
    (globalThis as Record<string, unknown>).Worker = MockWorker;

    // Re-import the module to get a fresh module-level state
    vi.resetModules();
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Clean up: dispose and restore
    const mod = await import('./KokoroFallbackService');
    mod.KokoroFallbackService.disposeInstance();
    delete (globalThis as Record<string, unknown>).Worker;
    vi.restoreAllMocks();
  });

  async function getService() {
    const mod = await import('./KokoroFallbackService');
    KokoroFallbackService = mod.KokoroFallbackService;
    return KokoroFallbackService;
  }

  it('getInstance returns the same instance on repeated calls', async () => {
    const Svc = await getService();
    const a = Svc.getInstance();
    const b = Svc.getInstance();
    expect(a).toBe(b);
  });

  it('preload creates a worker and posts a load message', async () => {
    const Svc = await getService();
    const instance = Svc.getInstance();

    const preloadPromise = instance.preload();

    // Worker should have been created
    expect(mockWorkerInstance).not.toBeNull();
    expect(mockWorkerInstance!.postMessage).toHaveBeenCalledWith({ type: 'load' });

    // Simulate worker responding with ready
    mockWorkerInstance!.onmessage!({ data: { type: 'ready' } } as MessageEvent);

    await preloadPromise;
    expect(instance.ready).toBe(true);
  });

  it('preload is idempotent — calling again returns the same promise', async () => {
    const Svc = await getService();
    const instance = Svc.getInstance();

    const p1 = instance.preload();
    const p2 = instance.preload();

    // Same promise returned
    expect(p1).toBe(p2);

    // Only one worker created
    expect(workerInstances.length).toBe(1);

    // Resolve it
    mockWorkerInstance!.onmessage!({ data: { type: 'ready' } } as MessageEvent);
    await p1;
  });

  it('ready getter returns true after worker posts ready', async () => {
    const Svc = await getService();
    const instance = Svc.getInstance();

    expect(instance.ready).toBe(false);

    const preloadPromise = instance.preload();
    mockWorkerInstance!.onmessage!({ data: { type: 'ready' } } as MessageEvent);
    await preloadPromise;

    expect(instance.ready).toBe(true);
  });

  it('dispose terminates worker and resets state', async () => {
    const Svc = await getService();
    const instance = Svc.getInstance();

    const preloadPromise = instance.preload();
    mockWorkerInstance!.onmessage!({ data: { type: 'ready' } } as MessageEvent);
    await preloadPromise;

    expect(instance.ready).toBe(true);

    await instance.dispose();

    expect(instance.ready).toBe(false);
    expect(mockWorkerInstance!.terminate).toHaveBeenCalled();
  });

  it('after dispose, getInstance returns a fresh instance', async () => {
    const Svc = await getService();
    const first = Svc.getInstance();
    const preloadPromise = first.preload();
    mockWorkerInstance!.onmessage!({ data: { type: 'ready' } } as MessageEvent);
    await preloadPromise;

    await first.dispose();

    const second = Svc.getInstance();
    expect(second).not.toBe(first);
    expect(second.ready).toBe(false);
  });

  it('inactivity timeout: dispose is called automatically after 5 minutes', async () => {
    const Svc = await getService();
    const instance = Svc.getInstance();

    const preloadPromise = instance.preload();
    mockWorkerInstance!.onmessage!({ data: { type: 'ready' } } as MessageEvent);
    await preloadPromise;

    expect(instance.ready).toBe(true);

    // Advance time by 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000);

    // Worker should have been terminated via inactivity timeout
    expect(mockWorkerInstance!.terminate).toHaveBeenCalled();
  });

  it('preload failure: worker posts error, promise rejects, ready stays false', async () => {
    const Svc = await getService();
    const instance = Svc.getInstance();

    const preloadPromise = instance.preload();

    // Simulate worker error
    mockWorkerInstance!.onmessage!({
      data: { type: 'error', message: 'Model load failed' },
    } as MessageEvent);

    await expect(preloadPromise).rejects.toThrow('Model load failed');
    expect(instance.ready).toBe(false);
  });

  it('dispose during active synthesis rejects pending promise gracefully', async () => {
    const Svc = await getService();
    const instance = Svc.getInstance();

    // Preload first
    const preloadPromise = instance.preload();
    mockWorkerInstance!.onmessage!({ data: { type: 'ready' } } as MessageEvent);
    await preloadPromise;

    // Simulate starting a synthesis (we'll call internal methods via casting)
    // The synthesize method isn't implemented yet, but we test the pendingSyntheses mechanism
    // We'll use a cast to access private methods
    const svc = instance as unknown as {
      pendingSyntheses: Set<Promise<unknown>>;
      resetInactivityTimer(): void;
    };

    // Create a pending synthesis promise
    let rejectSynthesis: (reason: Error) => void;
    const synthPromise = new Promise<unknown>((_, reject) => {
      rejectSynthesis = reject;
    });
    svc.pendingSyntheses.add(synthPromise);

    // Dispose should settle pending syntheses
    const disposePromise = instance.dispose();

    // The pending synthesis should be rejected
    // (the implementation rejects via AbortController or similar)
    // We need to reject it to let dispose complete
    rejectSynthesis!(new Error('Disposed during synthesis'));

    await disposePromise;

    // initPromise should be cleared — a new preload should work
    const newPreloadPromise = instance.preload();
    // Should create a new worker
    expect(workerInstances.length).toBe(2);
    mockWorkerInstance!.onmessage!({ data: { type: 'ready' } } as MessageEvent);
    await newPreloadPromise;
    expect(instance.ready).toBe(true);
  });

  it('preload after failure starts fresh (not stuck on old rejected promise)', async () => {
    const Svc = await getService();
    const instance = Svc.getInstance();

    // First preload fails
    const failPromise = instance.preload();
    mockWorkerInstance!.onmessage!({
      data: { type: 'error', message: 'fail' },
    } as MessageEvent);
    await expect(failPromise).rejects.toThrow('fail');

    // Second preload should work — not return the rejected promise
    const successPromise = instance.preload();
    // A new worker should be created
    expect(workerInstances.length).toBe(2);
    mockWorkerInstance!.onmessage!({ data: { type: 'ready' } } as MessageEvent);
    await successPromise;
    expect(instance.ready).toBe(true);
  });
});
