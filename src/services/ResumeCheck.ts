// Resume state checking for TTS conversion
// Checks for cached work to resume after interruption

import type { LLMCharacter, SpeakerAssignment } from '@/state/types';

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
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function tryReadJSON<T>(dir: FileSystemDirectoryHandle, filename: string): Promise<T | null> {
  try {
    const fileHandle = await dir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
}

const NUMBERED_INDEX_RE = /^chunks_index_\d+\.jsonl$/;

async function countNewFormatChunks(dir: FileSystemDirectoryHandle): Promise<number> {
  let total = 0;
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && NUMBERED_INDEX_RE.test(entry.name)) {
      const handle = await dir.getFileHandle(entry.name);
      const file = await handle.getFile();
      const text = await file.text();
      total += text.split('\n').filter((line) => line.trim().length > 0).length;
    }
  }
  return total;
}

async function hasNewFormat(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && NUMBERED_INDEX_RE.test(entry.name)) {
      return true;
    }
  }
  return false;
}

async function hasOldFormat(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.startsWith('chunk_') && name.endsWith('.bin')) {
      return true;
    }
  }
  return false;
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
  log?: (msg: string) => void,
): Promise<ResumeCheckResult> {
  const tempDir = await tryGetDirectory(dirHandle, '_temp_work');
  if (!tempDir) {
    log?.('Resume check: no _temp_work directory found');
    return null;
  }

  // Legacy detection: old format present but no new format index
  const hasNew = await hasNewFormat(tempDir);
  const hasOld = await hasOldFormat(tempDir);

  if (hasOld && !hasNew) {
    log?.('Resume check: legacy format detected, wiping for fresh start');
    // Wipe temp directory
    try {
      await dirHandle.removeEntry('_temp_work', { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }

  const hasLLMState = await fileExists(tempDir, 'pipeline_state.json');
  if (!hasLLMState) {
    log?.('Resume check: _temp_work exists but no pipeline_state.json');
    return null;
  }

  const cachedChunks = hasNew ? await countNewFormatChunks(tempDir) : 0;

  if (cachedChunks === 0 && !hasLLMState) {
    log?.('Resume check: no resumable state found');
    return null;
  }

  log?.(
    `Resume check: resumable state found (${cachedChunks} cached chunks, LLM state: ${hasLLMState})`,
  );
  return {
    cachedChunks,
    hasLLMState,
  };
}

export async function loadPipelineState(
  dirHandle: FileSystemDirectoryHandle,
): Promise<PipelineState | null> {
  const tempDir = await tryGetDirectory(dirHandle, '_temp_work');
  if (!tempDir) return null;
  return tryReadJSON<PipelineState>(tempDir, 'pipeline_state.json');
}
