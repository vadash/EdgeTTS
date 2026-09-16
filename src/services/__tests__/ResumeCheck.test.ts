import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';
import type { PipelineState } from '../ResumeCheck';
import { loadPipelineState, savePipelineState } from '../ResumeCheck';

const STATE: PipelineState = {
  assignments: [{ sentenceIndex: 0, text: 'Hello there', speaker: 'alice', voiceId: 'voice-1' }],
  characterVoiceMap: { alice: 'voice-1' },
  characters: [
    { canonicalName: 'alice', variations: ['Alice'], gender: 'female', voiceId: 'voice-1' },
  ],
  fileNames: [['book.epub', 42]],
};

describe('savePipelineState', () => {
  let dir: FileSystemDirectoryHandle;

  beforeEach(() => {
    dir = createMockDirectoryHandle();
  });

  it('round-trips state through loadPipelineState', async () => {
    await savePipelineState(dir, STATE);
    await expect(loadPipelineState(dir)).resolves.toEqual(STATE);
  });

  it('resolves false without throwing when the write fails', async () => {
    const failingDir = createMockDirectoryHandle();
    vi.spyOn(failingDir, 'getDirectoryHandle').mockRejectedValue(
      new DOMException('permission lost', 'NotAllowedError'),
    );
    await expect(savePipelineState(failingDir, STATE)).resolves.toBe(false);
  });
});
