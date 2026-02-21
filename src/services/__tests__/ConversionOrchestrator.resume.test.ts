import { describe, it, expect } from 'vitest';
import { createMockDirectoryHandle } from '@/test/mocks/FileSystemMocks';
import { checkResumeState, type ResumeCheckResult } from '@/services/ResumeCheck';

describe('checkResumeState', () => {
  it('returns null when _temp_work does not exist', async () => {
    const dirHandle = createMockDirectoryHandle();
    const result = await checkResumeState(dirHandle);
    expect(result).toBeNull();
  });

  it('returns null when _temp_work exists but no pipeline_state.json', async () => {
    const dirHandle = createMockDirectoryHandle();
    await dirHandle.getDirectoryHandle('_temp_work', { create: true });

    const result = await checkResumeState(dirHandle);
    expect(result).toBeNull();
  });

  it('returns ResumeInfo when pipeline_state.json exists', async () => {
    const dirHandle = createMockDirectoryHandle();
    const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });

    // Write pipeline state
    const stateFile = await tempDir.getFileHandle('pipeline_state.json', { create: true });
    const stateWritable = await stateFile.createWritable();
    await stateWritable.write(JSON.stringify({
      assignments: [{ text: 'Hi', sentenceIndex: 0, speaker: 'Narrator', voiceId: 'en-US-AriaNeural' }],
      characterVoiceMap: { Narrator: 'en-US-AriaNeural' },
      fileNames: [],
    }));
    await stateWritable.close();

    const result = await checkResumeState(dirHandle);
    expect(result).not.toBeNull();
    expect(result!.hasLLMState).toBe(true);
    expect(result!.cachedChunks).toBe(0);
  });

  it('counts cached chunk files', async () => {
    const dirHandle = createMockDirectoryHandle();
    const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });

    // Write pipeline state
    const stateFile = await tempDir.getFileHandle('pipeline_state.json', { create: true });
    const stateWritable = await stateFile.createWritable();
    await stateWritable.write(JSON.stringify({
      assignments: [],
      characterVoiceMap: {},
      fileNames: [],
    }));
    await stateWritable.close();

    // Write chunk files
    for (const name of ['chunk_0001.bin', 'chunk_0002.bin', 'chunk_0003.bin']) {
      const f = await tempDir.getFileHandle(name, { create: true });
      const w = await f.createWritable();
      await w.write(new Uint8Array([1, 2, 3]));
      await w.close();
    }

    const result = await checkResumeState(dirHandle);
    expect(result).not.toBeNull();
    expect(result!.cachedChunks).toBe(3);
  });

  it('logs messages when log callback provided', async () => {
    const dirHandle = createMockDirectoryHandle();
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    await checkResumeState(dirHandle, log);
    expect(logs).toContain('Resume check: no _temp_work directory found');
  });
});
