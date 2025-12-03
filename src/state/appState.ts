import { signal, computed } from '@preact/signals';
import type { ProcessedBook, TTSWorker, AppSettings } from './types';
import { loadLLMSettings as loadLLMSettingsInternal } from './llmState';

// Re-export LLM state
export {
  llmEnabled,
  llmApiKey,
  llmApiUrl,
  llmModel,
  llmProcessingStatus,
  llmCurrentBlock,
  llmTotalBlocks,
  llmError,
  detectedCharacters,
  characterVoiceMap,
  saveLLMSettings,
  loadLLMSettings,
  resetLLMState,
  isLLMConfigured,
} from './llmState';
export type { LLMProcessingStatus } from './llmState';

// Settings State
export const voice = signal<string>('ru-RU, DmitryNeural');
export const narratorVoice = signal<string>('ru-RU, DmitryNeural');
export const voicePoolLocale = signal<string>('ru-RU');
export const rate = signal<number>(0);
export const pitch = signal<number>(0);
export const maxThreads = signal<number>(20);
export const mergeFiles = signal<number>(10);
export const pointsSelect = signal<string>('none');
export const pointsType = signal<'V1' | 'V2' | 'V3'>('V1');
export const lexxRegister = signal<boolean>(true);

// Computed display values
export const rateDisplay = computed(() =>
  rate.value >= 0 ? `+${rate.value}%` : `${rate.value}%`
);
export const pitchDisplay = computed(() =>
  pitch.value >= 0 ? `+${pitch.value}Hz` : `${pitch.value}Hz`
);
export const mergeDisplay = computed(() =>
  mergeFiles.value >= 100 ? 'ALL' : `${mergeFiles.value}`
);

// UI State
export const isLiteMode = signal<boolean>(true);
export const showDopSettings = signal<boolean>(false);
export const statusAreaWidth = signal<number>(450);

// Data State
export const dictionary = signal<string[]>([]);
export const textContent = signal<string>('');
export const book = signal<ProcessedBook | null>(null);
export const bookLoaded = signal<boolean>(false);

// Processing State
export const isProcessing = signal<boolean>(false);
export const statusLines = signal<string[]>([]);
export const processedCount = signal<number>(0);
export const totalCount = signal<number>(0);
export const conversionStartTime = signal<number>(Date.now());

// TTS Workers State
export const activeWorkers = signal<TTSWorker[]>([]);
export const savePathHandle = signal<FileSystemDirectoryHandle | null>(null);

// File naming state
export const fileNameIndex = signal<number>(1);
export const numBook = signal<number>(0);
export const numText = signal<number>(0);

// Settings persistence
const SETTINGS_KEY = 'edgetts_settings';

export function saveSettings(): void {
  const settings: AppSettings = {
    voice: voice.value,
    narratorVoice: narratorVoice.value,
    voicePoolLocale: voicePoolLocale.value,
    rate: rate.value,
    pitch: pitch.value,
    maxThreads: maxThreads.value,
    mergeFiles: mergeFiles.value,
    pointsSelect: pointsSelect.value,
    pointsType: pointsType.value,
    lexxRegister: lexxRegister.value,
    showDopSettings: showDopSettings.value,
    isLiteMode: isLiteMode.value,
    statusAreaWidth: statusAreaWidth.value,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadSettings(): Promise<void> {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const settings: AppSettings = JSON.parse(saved);
      voice.value = settings.voice ?? 'ru-RU, DmitryNeural';
      narratorVoice.value = settings.narratorVoice ?? 'ru-RU, DmitryNeural';
      voicePoolLocale.value = settings.voicePoolLocale ?? 'ru-RU';
      rate.value = settings.rate ?? 0;
      pitch.value = settings.pitch ?? 0;
      maxThreads.value = settings.maxThreads ?? 20;
      mergeFiles.value = settings.mergeFiles ?? 10;
      pointsSelect.value = settings.pointsSelect ?? 'none';
      pointsType.value = settings.pointsType ?? 'V1';
      lexxRegister.value = settings.lexxRegister ?? true;
      showDopSettings.value = settings.showDopSettings ?? false;
      isLiteMode.value = settings.isLiteMode ?? true;
      statusAreaWidth.value = settings.statusAreaWidth ?? 450;
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  // Load LLM settings from separate storage (async for encrypted API key)
  await loadLLMSettingsInternal();
}

function formatElapsedTime(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function addStatusLine(message: string): void {
  const timestamp = formatElapsedTime(conversionStartTime.value);
  statusLines.value = [...statusLines.value, `[${timestamp}] ${message}`];
}

export function clearStatus(): void {
  statusLines.value = [];
  processedCount.value = 0;
  totalCount.value = 0;
  conversionStartTime.value = Date.now();
}
