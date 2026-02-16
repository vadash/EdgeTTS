import type { SpeakerAssignment, LLMCharacter } from '@/state/types';

export interface ResumeInfo {
  cachedChunks: number;
  hasLLMState: boolean;
}

export type ResumeCheckResult = ResumeInfo | null;

export interface PipelineState {
  assignments: SpeakerAssignment[];
  characterVoiceMap: Record<string, string>;
  characters?: LLMCharacter[];
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

/**
 * Check if _temp_work has resumable state.
 * Resume = _temp_work directory exists with pipeline_state.json.
 * 1 folder = 1 book, no signature/hash comparison needed.
 */
export async function checkResumeState(
  dirHandle: FileSystemDirectoryHandle,
  log?: (msg: string) => void
): Promise<ResumeCheckResult> {
  const tempDir = await tryGetDirectory(dirHandle, '_temp_work');
  if (!tempDir) {
    log?.('Resume check: no _temp_work directory found');
    return null;
  }

  const hasLLMState = await fileExists(tempDir, 'pipeline_state.json');
  if (!hasLLMState) {
    log?.('Resume check: _temp_work exists but no pipeline_state.json');
    return null;
  }

  const cachedChunks = await countChunkFiles(tempDir);

  log?.(`Resume check: resumable state found (${cachedChunks} cached chunks, LLM state: ${hasLLMState})`);
  return {
    cachedChunks,
    hasLLMState,
  };
}

export async function loadPipelineState(
  dirHandle: FileSystemDirectoryHandle
): Promise<PipelineState | null> {
  const tempDir = await tryGetDirectory(dirHandle, '_temp_work');
  if (!tempDir) return null;
  return tryReadJSON<PipelineState>(tempDir, 'pipeline_state.json');
}
