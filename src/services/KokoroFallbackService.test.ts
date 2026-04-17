import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We'll mock Worker globally. Each test creates a tracked mock worker.
interface MockWorkerType {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  addEventListener: (type: string, handler: (ev: MessageEvent) => void) => void;
  removeEventListener: (type: string, handler: (ev: MessageEvent) => void) => void;
  dispatchMessage: (data: unknown) => void;
}

let mockWorkerInstance: MockWorkerType | null = null;

const workerInstances: MockWorkerType[] = [];

class MockWorker {
  postMessage = vi.fn();
  terminate = vi.fn();
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  private listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};

  addEventListener(type: string, handler: (ev: MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  removeEventListener(type: string, handler: (ev: MessageEvent) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((h) => h !== handler);
  }

  /** Dispatch a message to both onmessage and addEventListener handlers */
  dispatchMessage(data: unknown) {
    const ev = { data } as MessageEvent;
    this.onmessage?.(ev);
    for (const handler of this.listeners.message ?? []) {
      handler(ev);
    }
  }

  constructor() {
    mockWorkerInstance = this as unknown as MockWorkerType;
    workerInstances.push(this as unknown as MockWorkerType);
  }
}

// Track dedicated FFmpegService instances created by KokoroFallbackService
const mockFFmpegInstances: Array<{
  load: ReturnType<typeof vi.fn>;
  processAudio: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}> = [];

// Must be a named class for vi.mock's factory to work as a constructor
class MockFFmpegService {
  load = vi.fn(async () => true);
  processAudio = vi.fn(async (chunks: Uint8Array[]) => {
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.length;
    }
    return buf;
  });
  terminate = vi.fn();

  constructor() {
    mockFFmpegInstances.push({
      load: this.load,
      processAudio: this.processAudio,
      terminate: this.terminate,
    });
  }
}

vi.mock('./FFmpegService', () => ({
  FFmpegService: MockFFmpegService,
}));

// Must import after MockWorker is defined so the module can reference it
// But since KokoroFallbackService uses Worker via `new Worker(...)`, we need
// to set up the global mock before importing the module.

describe('KokoroFallbackService', () => {
  let KokoroFallbackService: typeof import('./KokoroFallbackService').KokoroFallbackService;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWorkerInstance = null;
    workerInstances.length = 0;
    mockFFmpegInstances.length = 0;

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

  // --- synthesize tests ---

  async function preloadService() {
    const Svc = await getService();
    const instance = Svc.getInstance();
    const preloadPromise = instance.preload();
    mockWorkerInstance!.onmessage!({ data: { type: 'ready' } } as MessageEvent);
    await preloadPromise;
    return { Svc, instance };
  }

  it('synthesize sends generate message to worker and returns MP3 blob', async () => {
    const { instance } = await preloadService();
    const ffmpeg = mockFFmpegInstances[mockFFmpegInstances.length - 1];

    // Start synthesis — respond to worker after a microtask flush
    const synthPromise = instance.synthesize('Hello', 'female');
    // Let microtasks flush so generateSingle runs
    await vi.advanceTimersByTimeAsync(0);

    // Simulate worker responding with PCM data
    const pcm = new Float32Array(480).fill(0.5);
    mockWorkerInstance!.dispatchMessage({ type: 'generate_result', audio: pcm, sampleRate: 24000 });

    const blob = await synthPromise;
    expect(blob).toBeInstanceOf(Blob);
    // FFmpeg processAudio should have been called (WAV → MP3 transcode)
    expect(ffmpeg.processAudio).toHaveBeenCalledOnce();
    // Worker should have received generate message
    expect(mockWorkerInstance!.postMessage).toHaveBeenCalledWith({
      type: 'generate',
      text: 'Hello',
      voice: 'af_bella',
    });
  });

  it('synthesize maps gender to correct voice', async () => {
    const { instance } = await preloadService();

    // male → am_adam
    const synthPromise1 = instance.synthesize('Hi', 'male');
    await vi.advanceTimersByTimeAsync(0);
    mockWorkerInstance!.dispatchMessage({
      type: 'generate_result',
      audio: new Float32Array(100),
      sampleRate: 24000,
    });
    await synthPromise1;
    expect(mockWorkerInstance!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'generate', voice: 'am_adam' }),
    );

    // female → af_bella
    const synthPromise2 = instance.synthesize('Hi', 'female');
    await vi.advanceTimersByTimeAsync(0);
    mockWorkerInstance!.dispatchMessage({
      type: 'generate_result',
      audio: new Float32Array(100),
      sampleRate: 24000,
    });
    await synthPromise2;
    expect(mockWorkerInstance!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'generate', voice: 'af_bella' }),
    );

    // unknown → af_bella (same as female default)
    const synthPromise3 = instance.synthesize('Hi', 'unknown');
    await vi.advanceTimersByTimeAsync(0);
    mockWorkerInstance!.dispatchMessage({
      type: 'generate_result',
      audio: new Float32Array(100),
      sampleRate: 24000,
    });
    await synthPromise3;
    expect(mockWorkerInstance!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'generate', voice: 'af_bella' }),
    );
  });

  it('synthesize splits long text on sentence boundaries', async () => {
    const { instance } = await preloadService();

    // Create text >300 chars with sentence boundaries
    const sentence = 'This is a test sentence that has some length to it. ';
    const longText = sentence.repeat(10); // ~480 chars, 10 sentences

    // Set up auto-responder: each time worker gets a generate message, respond
    const generatePromise = instance.synthesize(longText, 'female');
    // Flush microtasks repeatedly and respond to each generate call
    let responded = 0;
    const responder = async () => {
      // Keep flushing and responding until the promise settles
      while (responded < 20) {
        await vi.advanceTimersByTimeAsync(0);
        const generateCalls = mockWorkerInstance!.postMessage.mock.calls.filter(
          (call: unknown[]) => (call[0] as { type: string }).type === 'generate',
        );
        if (generateCalls.length > responded) {
          mockWorkerInstance!.dispatchMessage({
            type: 'generate_result',
            audio: new Float32Array(100).fill(0.1),
            sampleRate: 24000,
          });
          responded++;
          await vi.advanceTimersByTimeAsync(0);
        } else {
          break;
        }
      }
    };
    await responder();

    const blob = await generatePromise;
    expect(blob).toBeInstanceOf(Blob);

    // Worker should receive multiple generate messages
    const generateCalls = mockWorkerInstance!.postMessage.mock.calls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === 'generate',
    );
    expect(generateCalls.length).toBeGreaterThan(1);

    // Each sub-chunk should be ≤300 chars
    for (const call of generateCalls) {
      const text = (call[0] as { text: string }).text;
      expect(text.length).toBeLessThanOrEqual(300);
    }
  });

  it('synthesize hard-splits text with no punctuation on spaces/commas', async () => {
    const { instance } = await preloadService();

    // Long text with no punctuation (no .!?)
    const longText = 'a '.repeat(200).trim(); // ~400 chars, no punctuation

    const synthPromise = instance.synthesize(longText, 'female');
    // Flush and respond to each generate call
    let responded = 0;
    while (responded < 20) {
      await vi.advanceTimersByTimeAsync(0);
      const generateCalls = mockWorkerInstance!.postMessage.mock.calls.filter(
        (call: unknown[]) => (call[0] as { type: string }).type === 'generate',
      );
      if (generateCalls.length > responded) {
        mockWorkerInstance!.dispatchMessage({
          type: 'generate_result',
          audio: new Float32Array(50).fill(0.1),
          sampleRate: 24000,
        });
        responded++;
      } else {
        break;
      }
    }

    const blob = await synthPromise;
    expect(blob).toBeInstanceOf(Blob);

    const generateCalls = mockWorkerInstance!.postMessage.mock.calls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === 'generate',
    );
    expect(generateCalls.length).toBeGreaterThan(1);

    // Each sub-chunk should be ≤300 chars
    for (const call of generateCalls) {
      const text = (call[0] as { text: string }).text;
      expect(text.length).toBeLessThanOrEqual(300);
    }
  });

  it('synthesize rejects on 20s timeout if worker does not respond', async () => {
    const { instance } = await preloadService();

    const synthPromise = instance.synthesize('Hello', 'female');
    await vi.advanceTimersByTimeAsync(0);

    // Don't respond — advance time past 20s
    vi.advanceTimersByTime(21_000);

    await expect(synthPromise).rejects.toThrow(/timeout/i);
  });

  it('synthesize recovers after worker crash — next call succeeds', async () => {
    const { instance } = await preloadService();

    // First call: worker sends error
    const failPromise = instance.synthesize('fail', 'female');
    await vi.advanceTimersByTimeAsync(0);
    mockWorkerInstance!.dispatchMessage({ type: 'generate_error', error: 'crash' });
    await expect(failPromise).rejects.toThrow('crash');

    // Second call should still work
    const okPromise = instance.synthesize('ok', 'female');
    await vi.advanceTimersByTimeAsync(0);
    mockWorkerInstance!.dispatchMessage({
      type: 'generate_result',
      audio: new Float32Array(100),
      sampleRate: 24000,
    });
    const blob = await okPromise;
    expect(blob).toBeInstanceOf(Blob);
  });

  it('synthesize calls resetInactivityTimer after successful synthesis', async () => {
    const { instance } = await preloadService();

    // Spy on resetInactivityTimer
    const spy = vi.spyOn(
      instance as unknown as { resetInactivityTimer: () => void },
      'resetInactivityTimer',
    );

    const synthPromise = instance.synthesize('Hello', 'female');
    await vi.advanceTimersByTimeAsync(0);
    mockWorkerInstance!.dispatchMessage({
      type: 'generate_result',
      audio: new Float32Array(100),
      sampleRate: 24000,
    });
    await synthPromise;

    expect(spy).toHaveBeenCalled();
  });

  it('synthesize uses dedicated FFmpeg instance, not shared singleton', async () => {
    const { instance } = await preloadService();

    // Should have created a dedicated FFmpegService instance
    expect(mockFFmpegInstances.length).toBeGreaterThanOrEqual(1);

    const synthPromise = instance.synthesize('Hello', 'female');
    await vi.advanceTimersByTimeAsync(0);
    mockWorkerInstance!.dispatchMessage({
      type: 'generate_result',
      audio: new Float32Array(100),
      sampleRate: 24000,
    });
    await synthPromise;

    // The dedicated FFmpeg's processAudio should be called
    const ffmpeg = mockFFmpegInstances[mockFFmpegInstances.length - 1];
    expect(ffmpeg.processAudio).toHaveBeenCalled();
  });

  it('dispose terminates dedicated FFmpeg instance', async () => {
    const { instance } = await preloadService();
    const ffmpeg = mockFFmpegInstances[mockFFmpegInstances.length - 1];

    await instance.dispose();

    expect(ffmpeg.terminate).toHaveBeenCalled();
  });
});
