import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggerStore } from '@/services/Logger';
import type { AudioProcessingConfig } from './FFmpegService';
import { FFmpegBlobCache, FFmpegService } from './FFmpegService';

describe('AudioProcessingConfig', () => {
  it('should accept Opus encoding parameters', () => {
    const config: AudioProcessingConfig = {
      silenceRemoval: true,
      normalization: true,
      deEss: true,
      silenceGapMs: 100,
      eq: true,
      compressor: true,
      fadeIn: true,
      stereoWidth: false,
      opusMinBitrate: 48,
      opusMaxBitrate: 64,
      opusCompressionLevel: 5,
    };
    expect(config.opusMinBitrate).toBe(48);
    expect(config.opusMaxBitrate).toBe(64);
    expect(config.opusCompressionLevel).toBe(5);
  });

  it('should work without Opus parameters (backward compat)', () => {
    const config: AudioProcessingConfig = {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
    };
    expect(config.opusMinBitrate).toBeUndefined();
  });

  it('should have optional Opus fields in interface', () => {
    // This test will cause a type error if the fields aren't defined
    const config: AudioProcessingConfig = {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
    };
    const minBitrate = config.opusMinBitrate;
    expect(minBitrate).toBeUndefined();
  });
});

describe('FFmpegService Opus integration', () => {
  it('should use custom Opus settings when provided', async () => {
    const logStore = new LoggerStore();
    const service = new FFmpegService(logStore);

    // Mock FFmpeg for testing - collect all args into a flat array
    const allCalls: string[] = [];
    (service as any).ffmpeg = {
      exec: async (args: string[]) => {
        allCalls.push(...args); // Spread the array of args
        return;
      },
      writeFile: () => {},
      readFile: () => new Uint8Array(),
      deleteFile: () => {},
    };
    (service as any).loaded = true;

    const config: AudioProcessingConfig = {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
      opusMinBitrate: 48,
      opusMaxBitrate: 64,
      opusCompressionLevel: 5,
    };

    await service.processAudio([new Uint8Array()], config);

    // The last exec call should be the main processing one
    // Find the index of '-c:a' followed by 'libopus' which starts the Opus encoding args
    const codecIdx = allCalls.indexOf('-c:a');
    expect(codecIdx).toBeGreaterThan(-1);
    expect(allCalls[codecIdx + 1]).toBe('libopus');

    // Check that custom bitrate args are present (after codec)
    const bitrateIdx = allCalls.indexOf('-b:a');
    expect(bitrateIdx).toBeGreaterThan(-1);
    expect(allCalls[bitrateIdx + 1]).toBe('48k');

    // Check that compression level is present
    const compressionIdx = allCalls.indexOf('-compression_level');
    expect(compressionIdx).toBeGreaterThan(-1);
    expect(allCalls[compressionIdx + 1]).toBe('5');

    // Check that VBR is on
    expect(allCalls).toContain('-vbr');
    expect(allCalls).toContain('on');

    // Check maxrate is present when max > min
    expect(allCalls).toContain('-maxrate');
    expect(allCalls[allCalls.indexOf('-maxrate') + 1]).toBe('64k');
  });

  it('should use default Opus settings when not provided', async () => {
    const logStore = new LoggerStore();
    const service = new FFmpegService(logStore);

    const allCalls: string[] = [];
    (service as any).ffmpeg = {
      exec: async (args: string[]) => {
        allCalls.push(...args);
        return;
      },
      writeFile: () => {},
      readFile: () => new Uint8Array(),
      deleteFile: () => {},
    };
    (service as any).loaded = true;

    const config: AudioProcessingConfig = {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
      // No Opus settings - should use defaults
    };

    await service.processAudio([new Uint8Array()], config);

    // Should still have bitrate args (from default config)
    const bitrateIdx = allCalls.indexOf('-b:a');
    expect(bitrateIdx).toBeGreaterThan(-1);
    expect(allCalls[bitrateIdx + 1]).toMatch(/\d+k/); // Should be something like '64k'

    // Should still have compression level (from default config)
    const compressionIdx = allCalls.indexOf('-compression_level');
    expect(compressionIdx).toBeGreaterThan(-1);
  });
});

/**
 * Minimal fake IndexedDB that supports the event-based IDB patterns
 * used by FFmpegBlobCache (onsuccess/onerror/onupgradeneeded on open request,
 * oncomplete/onerror on transaction).
 *
 * Uses setTimeout(0) to simulate async event delivery, ensuring handlers
 * are registered before events fire.
 */
function createFakeIDB() {
  const store = new Map<string, Blob>();

  const fakeDB = {
    createObjectStore: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn((_storeName: string, _mode: string) => {
      const ops = {
        get: (key: string) => {
          const result = store.get(key);
          const req = { onsuccess: null as ((ev: any) => void) | null, onerror: null as ((ev: any) => void) | null, result };
          queueMicrotask(() => { if (req.onsuccess) req.onsuccess({}); });
          return req;
        },
        put: (value: Blob, key: string) => {
          store.set(key, value);
          const req = { onsuccess: null as ((ev: any) => void) | null, onerror: null as ((ev: any) => void) | null };
          queueMicrotask(() => { if (req.onsuccess) req.onsuccess({}); });
          return req;
        },
        delete: (key: string) => {
          store.delete(key);
          const req = { onsuccess: null as ((ev: any) => void) | null, onerror: null as ((ev: any) => void) | null };
          queueMicrotask(() => { if (req.onsuccess) req.onsuccess({}); });
          return req;
        },
      };

      const tx = {
        objectStore: vi.fn(() => ops),
        oncomplete: null as (() => void) | null,
        onerror: null as ((ev: any) => void) | null,
      };

      // Fire oncomplete asynchronously via setTimeout so the caller
      // has time to set tx.oncomplete before the event fires.
      setTimeout(() => {
        if (tx.oncomplete) tx.oncomplete();
      }, 0);

      return tx;
    }),
  };

  const openRequest = {
    result: fakeDB,
    error: null as DOMException | null,
    onsuccess: null as ((ev: any) => void) | null,
    onerror: null as ((ev: any) => void) | null,
    onupgradeneeded: null as ((ev: any) => void) | null,
  };

  return { store, fakeDB, openRequest };
}

describe('FFmpegBlobCache', () => {
  let fake: ReturnType<typeof createFakeIDB>;
  let originalIDB: any;

  beforeEach(() => {
    fake = createFakeIDB();
    originalIDB = window.indexedDB;

    // Replace indexedDB with our fake (setup.ts made it configurable)
    (window as any).indexedDB = {
      open: () => {
        const req = fake.openRequest;
        // Fire events asynchronously so the caller can set handlers first
        queueMicrotask(() => {
          if (req.onupgradeneeded) req.onupgradeneeded({} as any);
          if (req.onsuccess) req.onsuccess({} as any);
        });
        return req;
      },
    };
  });

  afterEach(() => {
    (window as any).indexedDB = originalIDB;
  });

  it('should store and load blobs', async () => {
    const coreBlob = new Blob(['core-content'], { type: 'text/javascript' });
    const wasmBlob = new Blob(['wasm-content'], { type: 'application/wasm' });

    await FFmpegBlobCache.store(coreBlob, wasmBlob);

    const result = await FFmpegBlobCache.load();
    expect(result).not.toBeNull();
    expect(result!.coreURL).toMatch(/^blob:/);
    expect(result!.wasmURL).toMatch(/^blob:/);
  });

  it('should return null when cache is empty', async () => {
    fake.store.clear();
    const result = await FFmpegBlobCache.load();
    expect(result).toBeNull();
  });

  it('should survive IndexedDB being unavailable', async () => {
    (window as any).indexedDB = undefined;

    // store should not throw
    await expect(FFmpegBlobCache.store(new Blob([]), new Blob([]))).resolves.toBeUndefined();

    // load should return null
    const result = await FFmpegBlobCache.load();
    expect(result).toBeNull();

    // clear should not throw
    await expect(FFmpegBlobCache.clear()).resolves.toBeUndefined();
  });

  it('should clear cached blobs', async () => {
    const coreBlob = new Blob(['core-content'], { type: 'text/javascript' });
    const wasmBlob = new Blob(['wasm-content'], { type: 'application/wasm' });

    await FFmpegBlobCache.store(coreBlob, wasmBlob);
    expect(fake.store.has('ffmpeg-core.js')).toBe(true);

    await FFmpegBlobCache.clear();
    expect(fake.store.has('ffmpeg-core.js')).toBe(false);
    expect(fake.store.has('ffmpeg-core.wasm')).toBe(false);
  });
});
