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
  let root: FileSystemDirectoryHandle;
  let work: FileSystemDirectoryHandle;

  beforeEach(async () => {
    root = createMockDirectoryHandle();
    // The orchestrator resolves the work folder via ChunkStore.ensureWorkFolder
    // before handing it to savePipelineState.
    work = await root.getDirectoryHandle('_temp_work', { create: true });
  });

  it('round-trips state through loadPipelineState', async () => {
    await savePipelineState(work, STATE);
    await expect(loadPipelineState(work)).resolves.toEqual(STATE);
  });

  it('resolves false without throwing when the write fails', async () => {
    const failingFolder = createMockDirectoryHandle();
    vi.spyOn(failingFolder, 'getFileHandle').mockRejectedValue(
      new DOMException('permission lost', 'NotAllowedError'),
    );
    await expect(savePipelineState(failingFolder, STATE)).resolves.toBe(false);
  });
});

describe('loadPipelineState', () => {
  it('resolves null for a missing folder without touching the file system', async () => {
    await expect(loadPipelineState(null)).resolves.toBeNull();
  });

  it('resolves null when the folder has no pipeline_state.json', async () => {
    const emptyRoot = createMockDirectoryHandle();
    const emptyFolder = await emptyRoot.getDirectoryHandle('_temp_work', { create: true });
    await expect(loadPipelineState(emptyFolder)).resolves.toBeNull();
  });
});
