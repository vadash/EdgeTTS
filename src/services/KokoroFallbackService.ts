export const KOKORO_CONFIG = {
  modelId: 'onnx-community/Kokoro-82M-ONNX',
  dtype: 'q8' as const,
  device: 'wasm' as const,
  voices: new Map([
    ['af_bella', 'af_bella'],
    ['af_nicole', 'af_nicole'],
    ['af_sarah', 'af_sarah'],
    ['af_sky', 'af_sky'],
    ['am_adam', 'am_adam'],
    ['am_michael', 'am_michael'],
    ['bf_emma', 'bf_emma'],
    ['bf_isabella', 'bf_isabella'],
    ['bm_george', 'bm_george'],
    ['bm_lewis', 'bm_lewis'],
  ]),
  maxChunkChars: 300,
  inactivityTimeoutMs: 5 * 60 * 1000,
} as const;

export class KokoroFallbackService {
  private static instance: KokoroFallbackService | null = null;

  private worker: Worker | null = null;
  private initPromise: Promise<void> | null = null;
  private _ready = false;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: read in future tasks for inactivity tracking
  private lastUsedAt = 0;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSyntheses = new Set<Promise<unknown>>();

  static getInstance(): KokoroFallbackService {
    if (!KokoroFallbackService.instance) {
      KokoroFallbackService.instance = new KokoroFallbackService();
    }
    return KokoroFallbackService.instance;
  }

  /** Dispose the singleton — used in tests and after inactivity timeout */
  static disposeInstance(): void {
    if (KokoroFallbackService.instance) {
      void KokoroFallbackService.instance.dispose();
      KokoroFallbackService.instance = null;
    }
  }

  get ready(): boolean {
    return this._ready;
  }

  preload(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise<void>((resolve, reject) => {
      this.worker = new Worker(new URL('./kokoro-worker.ts', import.meta.url), { type: 'module' });

      this.worker.onmessage = (ev: MessageEvent) => {
        const { type, message } = ev.data as { type: string; message?: string };
        if (type === 'ready') {
          this._ready = true;
          this.lastUsedAt = Date.now();
          this.resetInactivityTimer();
          resolve();
        } else if (type === 'error') {
          this.cleanup();
          reject(new Error(message ?? 'Worker error'));
        }
      };

      this.worker.onerror = (ev: ErrorEvent) => {
        this.cleanup();
        reject(new Error(ev.message || 'Worker error'));
      };

      this.worker.postMessage({ type: 'load' });
    });

    return this.initPromise;
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
    }
    this.inactivityTimer = setTimeout(() => {
      void this.dispose();
    }, KOKORO_CONFIG.inactivityTimeoutMs);
  }

  async dispose(): Promise<void> {
    // Wait for or reject pending syntheses
    if (this.pendingSyntheses.size > 0) {
      await Promise.allSettled(this.pendingSyntheses);
    }

    this.cleanup();
    KokoroFallbackService.instance = null;
  }

  private cleanup(): void {
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this._ready = false;
    this.initPromise = null;
    this.pendingSyntheses.clear();
  }
}
