// useTTSConversion - Simplified hook using ConversionOrchestrator
// This is the refactored version that delegates to the orchestrator

import { useCallback, useRef } from 'preact/hooks';
import { useServices } from '@/di';
import { useStores } from '@/stores';
import { ConversionOrchestrator } from '@/services/ConversionOrchestrator';
import type { ProcessedBook } from '@/state/types';

/**
 * Hook return type
 */
export interface UseTTSConversionResult {
  /** Start conversion with text and optional book metadata */
  startConversion: (text: string, existingBook?: ProcessedBook | null) => Promise<void>;
  /** Cancel ongoing conversion */
  cancel: () => void;
  /** Select directory for saving files */
  selectDirectory: () => Promise<boolean>;
  /** Whether conversion is in progress */
  isProcessing: boolean;
  /** Current progress */
  progress: {
    current: number;
    total: number;
  };
}

/**
 * Main TTS conversion hook
 * Uses ConversionOrchestrator for the actual conversion workflow
 */
export function useTTSConversion(): UseTTSConversionResult {
  const container = useServices();
  const stores = useStores();
  const orchestratorRef = useRef<ConversionOrchestrator | null>(null);

  /**
   * Start conversion
   */
  const startConversion = useCallback(async (
    text: string,
    existingBook?: ProcessedBook | null
  ) => {
    // Check if already processing
    if (stores.conversion.isProcessing.value) {
      stores.logs.info('Conversion already in progress');
      return;
    }

    // Create new orchestrator
    orchestratorRef.current = new ConversionOrchestrator(container, stores);

    try {
      await orchestratorRef.current.run(text, existingBook);
    } catch (error) {
      // Error is already logged by orchestrator
      // Just ensure we're not in processing state
      if (stores.conversion.isProcessing.value) {
        stores.conversion.setError((error as Error).message);
      }
    }
  }, [container, stores]);

  /**
   * Cancel conversion
   */
  const cancel = useCallback(() => {
    orchestratorRef.current?.cancel();
    stores.logs.info('Conversion cancelled');
  }, [stores]);

  /**
   * Select directory for saving files
   */
  const selectDirectory = useCallback(async (): Promise<boolean> => {
    const currentHandle = stores.data.directoryHandle.value;

    // If already have a handle, verify it's still valid
    if (currentHandle) {
      try {
        const permission = await currentHandle.requestPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          stores.logs.info(`Saving to: ${currentHandle.name}`);
          return true;
        }
      } catch {
        stores.data.setDirectoryHandle(null);
      }
    }

    // Check for directory picker support
    if (!window.showDirectoryPicker) {
      stores.logs.error('Directory picker not supported. Please use Chrome, Edge, or Opera.');
      return false;
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      stores.data.setDirectoryHandle(handle);
      stores.logs.info(`Saving to: ${handle.name}`);
      return true;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        stores.logs.error('Directory selection required. Please select a folder to save files.');
      } else {
        stores.logs.error(`Directory selection failed: ${(err as Error).message}`);
      }
      return false;
    }
  }, [stores]);

  return {
    startConversion,
    cancel,
    selectDirectory,
    isProcessing: stores.conversion.isProcessing.value,
    progress: {
      current: stores.conversion.progress.value.current,
      total: stores.conversion.progress.value.total,
    },
  };
}

// Re-export type for backward compatibility
export type { ConversionStatus } from '@/stores/ConversionStore';
