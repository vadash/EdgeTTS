import { describe, it, expect } from 'vitest';
import { createMockDirectoryHandle } from '@/test/pipeline/helpers';
import { generateSignature, type JobSignature } from '@/services/pipeline/jobSignature';

// Test the checkResumable logic extracted as a standalone function
import { checkResumeState, type ResumeCheckResult, writeSignature } from '@/services/pipeline/resumeCheck';

describe('checkResumeState', () => {
  const settings = {
    voice: 'en-US-AriaNeural',
    rate: '+0%',
    pitch: '+0Hz',
    outputFormat: 'opus' as const,
    opusBitrate: '32k',
  };

  it('returns null when _temp_work does not exist', async () => {
    const dirHandle = createMockDirectoryHandle();
    const result = await checkResumeState(dirHandle, 'Hello', settings);
    expect(result).toBeNull();
  });

  it('returns ResumeInfo when signature matches and chunks exist', async () => {
    const dirHandle = createMockDirectoryHandle();
    // Setup: _temp_work exists with matching signature and some chunk files
    const sig = generateSignature('Hello', settings);
    const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
    // Write signature
    const sigFile = await tempDir.getFileHandle('job_signature.json', { create: true });
    const sigWritable = await sigFile.createWritable();
    await sigWritable.write(JSON.stringify(sig));
    await sigWritable.close();
    // Write a fake chunk file
    const chunkFile = await tempDir.getFileHandle('chunk_0001.bin', { create: true });
    const chunkWritable = await chunkFile.createWritable();
    await chunkWritable.write(new Uint8Array([1, 2, 3]));
    await chunkWritable.close();

    const result = await checkResumeState(dirHandle, 'Hello', settings);
    expect(result).not.toBeNull();
    expect(result!.cachedChunks).toBe(1);
  });

  it('returns null when signature does not match', async () => {
    const dirHandle = createMockDirectoryHandle();
    const oldSig = generateSignature('Old text', settings);
    const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
    const sigFile = await tempDir.getFileHandle('job_signature.json', { create: true });
    const sigWritable = await sigFile.createWritable();
    await sigWritable.write(JSON.stringify(oldSig));
    await sigWritable.close();

    const result = await checkResumeState(dirHandle, 'New text', settings);
    expect(result).toBeNull();
  });

  it('detects pipeline_state.json for LLM cache', async () => {
    const dirHandle = createMockDirectoryHandle();
    const sig = generateSignature('Hello', settings);
    const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
    // Write signature
    const sigFile = await tempDir.getFileHandle('job_signature.json', { create: true });
    const sigWritable = await sigFile.createWritable();
    await sigWritable.write(JSON.stringify(sig));
    await sigWritable.close();
    // Write pipeline state
    const stateFile = await tempDir.getFileHandle('pipeline_state.json', { create: true });
    const stateWritable = await stateFile.createWritable();
    await stateWritable.write(JSON.stringify({ assignments: [{ text: 'Hi', sentenceIndex: 0, speaker: 'Narrator', voiceId: 'en-US-AriaNeural' }], characterVoiceMap: { Narrator: 'en-US-AriaNeural' }, fileNames: [] }));
    await stateWritable.close();

    const result = await checkResumeState(dirHandle, 'Hello', settings);
    expect(result).not.toBeNull();
    expect(result!.hasLLMState).toBe(true);
  });
});

describe('writeSignature', () => {
  const settings = {
    voice: 'en-US-AriaNeural',
    rate: '+0%',
    pitch: '+0Hz',
    outputFormat: 'opus' as const,
    opusBitrate: '32k',
  };

  it('writes job_signature.json to _temp_work', async () => {
    const dirHandle = createMockDirectoryHandle();
    await writeSignature(dirHandle, 'Hello', settings);

    const tempDir = await dirHandle.getDirectoryHandle('_temp_work');
    const sigFile = await tempDir.getFileHandle('job_signature.json');
    const file = await sigFile.getFile();
    const sig = JSON.parse(await file.text());
    expect(sig.version).toBe(1);
    expect(sig.voice).toBe('en-US-AriaNeural');
  });
});
