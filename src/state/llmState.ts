import { signal } from '@preact/signals';
import type { LLMCharacter } from './types';
import { encryptValue, decryptValue } from '@/services/SecureStorage';

// LLM Settings (persisted to localStorage)
export const llmEnabled = signal<boolean>(true);
export const llmApiKey = signal<string>('');
export const llmApiUrl = signal<string>('https://api.openai.com/v1');
export const llmModel = signal<string>('gpt-4o-mini');

// LLM Processing State
export type LLMProcessingStatus = 'idle' | 'pass1' | 'review' | 'pass2' | 'error';
export const llmProcessingStatus = signal<LLMProcessingStatus>('idle');
export const llmCurrentBlock = signal<number>(0);
export const llmTotalBlocks = signal<number>(0);
export const llmError = signal<string | null>(null);

// Character data (persisted between Pass 1 and Pass 2)
export const detectedCharacters = signal<LLMCharacter[]>([]);
export const characterVoiceMap = signal<Map<string, string>>(new Map());

// Persistence
const LLM_SETTINGS_KEY = 'edgetts_llm_settings';

interface LLMSettings {
  enabled: boolean;
  apiKey: string; // encrypted
  apiUrl: string;
  model: string;
}

export async function saveLLMSettings(): Promise<void> {
  const encryptedKey = await encryptValue(llmApiKey.value);
  const settings: LLMSettings = {
    enabled: llmEnabled.value,
    apiKey: encryptedKey,
    apiUrl: llmApiUrl.value,
    model: llmModel.value,
  };
  localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadLLMSettings(): Promise<void> {
  try {
    const saved = localStorage.getItem(LLM_SETTINGS_KEY);
    if (saved) {
      const settings: LLMSettings = JSON.parse(saved);
      llmEnabled.value = settings.enabled ?? true;
      llmApiKey.value = await decryptValue(settings.apiKey ?? '');
      llmApiUrl.value = settings.apiUrl ?? 'https://api.openai.com/v1';
      llmModel.value = settings.model ?? 'gpt-4o-mini';
    }
  } catch (e) {
    console.error('Failed to load LLM settings:', e);
  }
}

export function resetLLMState(): void {
  llmProcessingStatus.value = 'idle';
  llmCurrentBlock.value = 0;
  llmTotalBlocks.value = 0;
  llmError.value = null;
  detectedCharacters.value = [];
  characterVoiceMap.value = new Map();
}

export function isLLMConfigured(): boolean {
  return llmApiKey.value.length > 0;
}
