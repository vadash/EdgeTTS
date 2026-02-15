import { generateSignature, signaturesMatch, type SignatureSettings, type JobSignature } from './jobSignature';

export interface ResumeInfo {
  cachedChunks: number;
  totalChunks: number;
  cachedOutputFiles: number;
  hasLLMState: boolean;
}

export type ResumeCheckResult = ResumeInfo | null;

export interface PipelineState {
  assignments: Array<{ text: string; speaker: string; voiceId: string }>;
  characterVoiceMap: Record<string, string>;
  fileNames: Array<[string, number]>;
}

async function tryGetDirectory(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function tryReadJSON<T>(
  dir: FileSystemDirectoryHandle,
  filename: string
): Promise<T | null> {
  try {
    const fileHandle = await dir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
}

async function countChunkFiles(dir: FileSystemDirectoryHandle): Promise<number> {
  let count = 0;
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.endsWith('.bin') && name.startsWith('chunk_')) {
      count++;
    }
  }
  return count;
}

async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

export async function checkResumeState(
  dirHandle: FileSystemDirectoryHandle,
  text: string,
  settings: SignatureSettings
): Promise<ResumeCheckResult> {
  const tempDir = await tryGetDirectory(dirHandle, '_temp_work');
  if (!tempDir) return null;

  const savedSig = await tryReadJSON<JobSignature>(tempDir, 'job_signature.json');
  if (!savedSig) return null;

  const currentSig = generateSignature(text, settings);
  if (!signaturesMatch(savedSig, currentSig)) return null;

  const cachedChunks = await countChunkFiles(tempDir);
  const hasLLMState = await fileExists(tempDir, 'pipeline_state.json');

  return {
    cachedChunks,
    totalChunks: (savedSig as any).chunkCount ?? 0,
    cachedOutputFiles: 0, // counted later by merge step
    hasLLMState,
  };
}

export async function writeSignature(
  dirHandle: FileSystemDirectoryHandle,
  text: string,
  settings: SignatureSettings
): Promise<void> {
  const tempDir = await dirHandle.getDirectoryHandle('_temp_work', { create: true });
  const sig = generateSignature(text, settings);
  const fileHandle = await tempDir.getFileHandle('job_signature.json', { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(sig));
  await writable.close();
}

export async function loadPipelineState(
  dirHandle: FileSystemDirectoryHandle
): Promise<PipelineState | null> {
  const tempDir = await tryGetDirectory(dirHandle, '_temp_work');
  if (!tempDir) return null;
  return tryReadJSON<PipelineState>(tempDir, 'pipeline_state.json');
}
