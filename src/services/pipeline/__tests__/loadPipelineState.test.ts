import { describe, it, expect } from 'vitest';
import { loadPipelineState, type PipelineState } from '../resumeCheck';
import { createMockDirectoryHandle } from '@/test/pipeline/helpers';

describe('loadPipelineState', () => {
  it('returns null when pipeline_state.json does not exist', async () => {
    const dirHandle = createMockDirectoryHandle();
    await dirHandle.getDirectoryHandle('_temp_work', { create: true });
    const result = await loadPipelineState(dirHandle);
    expect(result).toBeNull();
  });

  it('loads and parses pipeline_state.json from _temp_work', async () => {
    const dirHandle = createMockDirectoryHandle();
    const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
    const state: PipelineState = {
      assignments: [{ text: 'Hi', sentenceIndex: 0, speaker: 'Narrator', voiceId: 'en-US-AriaNeural' }],
      characterVoiceMap: { Narrator: 'en-US-AriaNeural' },
      fileNames: [['Chapter 1', 0]],
    };
    const file = await tempDir.getFileHandle('pipeline_state.json', { create: true });
    const w = await file.createWritable();
    await w.write(JSON.stringify(state));
    await w.close();

    const result = await loadPipelineState(dirHandle);
    expect(result).not.toBeNull();
    expect(result!.assignments).toHaveLength(1);
    expect(result!.assignments[0].speaker).toBe('Narrator');
    expect(result!.characterVoiceMap).toEqual({ Narrator: 'en-US-AriaNeural' });
  });

  it('returns null for corrupt JSON', async () => {
    const dirHandle = createMockDirectoryHandle();
    const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
    const file = await tempDir.getFileHandle('pipeline_state.json', { create: true });
    const w = await file.createWritable();
    await w.write('not json');
    await w.close();

    const result = await loadPipelineState(dirHandle);
    expect(result).toBeNull();
  });

  it('returns null when _temp_work does not exist', async () => {
    const dirHandle = createMockDirectoryHandle();
    const result = await loadPipelineState(dirHandle);
    expect(result).toBeNull();
  });
});
