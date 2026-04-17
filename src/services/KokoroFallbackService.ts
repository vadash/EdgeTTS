import { FFmpegService } from './FFmpegService';
import { encodeWav } from './audio/encodeWav';

const GENDER_VOICE_MAP: Record<string, string> = {
  male: 'am_adam',
  female: 'af_bella',
  unknown: 'af_bella',
};

const SYNTHESIS_TIMEOUT_MS = 20_000;

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
  private ffmpeg: FFmpegService;

  private constructor() {
    this.ffmpeg = new FFmpegService();
  }

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
      this.worker = new Worker(new URL('./workers/kokoro.worker', import.meta.url), {
        type: 'module',
      });

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

  async synthesize(text: string, gender: 'male' | 'female' | 'unknown'): Promise<Blob> {
    await this.ensureReady();

    const voice = GENDER_VOICE_MAP[gender] ?? GENDER_VOICE_MAP.unknown;

    const chunks = text.length > KOKORO_CONFIG.maxChunkChars ? this.splitLongText(text) : [text];

    const pcmParts: Float32Array[] = [];
    for (const chunk of chunks) {
      const pcm = await this.generateSingle(chunk, voice);
      pcmParts.push(pcm);
    }

    // Concatenate PCM
    const totalLength = pcmParts.reduce((sum, p) => sum + p.length, 0);
    const concatenated = new Float32Array(totalLength);
    let offset = 0;
    for (const p of pcmParts) {
      concatenated.set(p, offset);
      offset += p.length;
    }

    // Encode to WAV
    const sampleRate = 24000;
    const wavBlob = encodeWav(concatenated, sampleRate);

    // Transcode WAV → MP3 via dedicated FFmpeg
    const wavBytes = new Uint8Array(await wavBlob.arrayBuffer());
    const loaded = await this.ffmpeg.load();
    if (!loaded) {
      throw new Error('FFmpeg failed to load for Kokoro transcoding');
    }
    const mp3Bytes = await this.ffmpeg.processAudio([wavBytes], {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
    });

    this.resetInactivityTimer();
    this.lastUsedAt = Date.now();

    // Create a new Uint8Array to ensure standard ArrayBuffer (not SharedArrayBuffer)
    const outputBytes = new Uint8Array(mp3Bytes);
    return new Blob([outputBytes], { type: 'audio/mpeg' });
  }

  private async ensureReady(): Promise<void> {
    if (this._ready && this.worker) return;
    await this.preload();
  }

  private generateSingle(text: string, voice: string): Promise<Float32Array> {
    return new Promise<Float32Array>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Synthesis timeout after ${SYNTHESIS_TIMEOUT_MS}ms`));
      }, SYNTHESIS_TIMEOUT_MS);

      const handleMessage = (ev: MessageEvent) => {
        const { type } = ev.data as { type: string; audio?: Float32Array; error?: string };
        if (type === 'generate_result') {
          clearTimeout(timeout);
          this.worker?.removeEventListener('message', handleMessage);
          resolve(ev.data.audio as Float32Array);
        } else if (type === 'generate_error') {
          clearTimeout(timeout);
          this.worker?.removeEventListener('message', handleMessage);
          reject(new Error(ev.data.error ?? 'Synthesis failed'));
        }
      };

      this.worker.addEventListener('message', handleMessage);
      this.worker.postMessage({ type: 'generate', text, voice });
    });
  }

  private splitLongText(text: string): string[] {
    // Split on sentence boundaries (. ! ?)
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if (sentence.length > KOKORO_CONFIG.maxChunkChars) {
        // Hard-split fallback: split on spaces/commas for chunks without punctuation
        if (current.length > 0) {
          chunks.push(current);
          current = '';
        }
        const subChunks = this.hardSplit(sentence);
        chunks.push(...subChunks);
      } else if (current.length + sentence.length + 1 > KOKORO_CONFIG.maxChunkChars) {
        chunks.push(current);
        current = sentence;
      } else {
        current = current.length > 0 ? `${current} ${sentence}` : sentence;
      }
    }

    if (current.length > 0) {
      chunks.push(current);
    }

    return chunks;
  }

  private hardSplit(text: string): string[] {
    // Split on spaces or commas, grouping into chunks ≤ maxChunkChars
    const parts = text.split(/(?<=[ ,])/);
    const chunks: string[] = [];
    let current = '';

    for (const part of parts) {
      if (current.length + part.length > KOKORO_CONFIG.maxChunkChars) {
        if (current.length > 0) {
          chunks.push(current);
          current = '';
        }
        // If a single part is still too long, force split
        if (part.length > KOKORO_CONFIG.maxChunkChars) {
          for (let i = 0; i < part.length; i += KOKORO_CONFIG.maxChunkChars) {
            chunks.push(part.slice(i, i + KOKORO_CONFIG.maxChunkChars));
          }
        } else {
          current = part;
        }
      } else {
        current += part;
      }
    }

    if (current.length > 0) {
      chunks.push(current);
    }

    return chunks;
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

    this.ffmpeg.terminate();
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
