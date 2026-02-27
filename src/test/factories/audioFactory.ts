// Test Factories - Audio Data
// Factory functions for creating test audio data

import type { MergedFile } from '@/services/AudioMerger';

/**
 * Create fake audio data (empty MP3 header + silence)
 */
export function createTestAudioData(sizeBytes: number = 1000): Uint8Array {
  // Simple fake MP3 frame header + padding
  const header = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
  const padding = new Uint8Array(Math.max(0, sizeBytes - 4));

  const result = new Uint8Array(sizeBytes);
  result.set(header, 0);
  result.set(padding, 4);

  return result;
}

/**
 * Create a map of test audio chunks
 */
export function createTestAudioMap(
  count: number = 5,
  chunkSize: number = 1000,
): Map<number, Uint8Array> {
  const audioMap = new Map<number, Uint8Array>();

  for (let i = 0; i < count; i++) {
    audioMap.set(i, createTestAudioData(chunkSize));
  }

  return audioMap;
}

/**
 * Create a blob from audio data
 */
function createAudioBlob(data: Uint8Array): Blob {
  // Create a copy to a new ArrayBuffer to avoid SharedArrayBuffer issues
  const buffer = new ArrayBuffer(data.length);
  const view = new Uint8Array(buffer);
  view.set(data);
  return new Blob([buffer], { type: 'audio/mpeg' });
}

/**
 * Create test merged file result
 */
export function createTestMergedFile(overrides: Partial<MergedFile> = {}): MergedFile {
  const audioData = createTestAudioData(5000);
  return {
    filename: 'test_audio_001.mp3',
    blob: createAudioBlob(audioData),
    fromIndex: 0,
    toIndex: 10,
    ...overrides,
  };
}

/**
 * Create multiple test merged files
 */
export function createTestMergedFiles(count: number = 2): MergedFile[] {
  const files: MergedFile[] = [];
  let startIndex = 0;

  for (let i = 0; i < count; i++) {
    const endIndex = startIndex + 10;
    const audioData = createTestAudioData(5000);
    files.push({
      filename: `test_audio_${String(i + 1).padStart(3, '0')}.mp3`,
      blob: createAudioBlob(audioData),
      fromIndex: startIndex,
      toIndex: endIndex,
    });
    startIndex = endIndex + 1;
  }

  return files;
}
