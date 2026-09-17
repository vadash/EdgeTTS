import type { LLMCharacter, SpeakerAssignment } from '@/state/types';
import { withPermissionRetry } from '@/utils/retry/filesystem';

import type { ChunkStore } from './ChunkStore';

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

async function tryReadJSON<T>(dir: FileSystemDirectoryHandle, filename: string): Promise<T | null> {
  try {
    const fileHandle = await dir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
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
 * Check whether the Chunk store holds resumable state: the _temp_work
 * directory exists and contains pipeline_state.json. One folder maps to
 * one Book, so no signature or hash comparison is needed. All _temp_work
 * and chunk-format knowledge lives in ChunkStore.
 */
export async function checkResumeState(
  store: Pick<ChunkStore, 'snapshot' | 'peekWorkFolder' | 'wipe'>,
  root: FileSystemDirectoryHandle,
  log?: (msg: string) => void,
): Promise<ResumeCheckResult> {
  const tempDir = await store.peekWorkFolder(root);
  if (!tempDir) {
    log?.('Resume check: no _temp_work directory found');
    return null;
  }

  // Legacy detection: old format present but no new format index
  const { chunkCount, legacyOnly } = await store.snapshot(tempDir);

  if (legacyOnly) {
    log?.('Resume check: legacy format detected, wiping for fresh start');
    await store.wipe(root);
    return null;
  }

  const hasLLMState = await fileExists(tempDir, 'pipeline_state.json');
  if (!hasLLMState) {
    log?.('Resume check: _temp_work exists but no pipeline_state.json');
    return null;
  }

  log?.(
    `Resume check: resumable state found (${chunkCount} cached chunks, LLM state: ${hasLLMState})`,
  );
  return {
    cachedChunks: chunkCount,
    hasLLMState,
  };
}

export async function loadPipelineState(
  folder: FileSystemDirectoryHandle | null,
): Promise<PipelineState | null> {
  if (!folder) return null;
  return tryReadJSON<PipelineState>(folder, 'pipeline_state.json');
}

/**
 * Persist pipeline state for resume. Writes the same pipeline_state.json
 * that loadPipelineState reads. The caller resolves the work folder
 * (ChunkStore.ensureWorkFolder creates it when missing); a null folder
 * skips the save and returns false. Non-fatal: errors are swallowed so a
 * failed save never breaks the Conversion.
 */
export async function savePipelineState(
  folder: FileSystemDirectoryHandle | null,
  state: PipelineState,
): Promise<boolean> {
  if (!folder) return false;
  try {
    await withPermissionRetry(folder, async () => {
      const stateFile = await folder.getFileHandle('pipeline_state.json', {
        create: true,
      });
      const writable = await stateFile.createWritable();
      await writable.write(JSON.stringify(state));
      await writable.close();
    });
    return true;
  } catch {
    return false;
  }
}
