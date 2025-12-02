import { signal, computed } from '@preact/signals';
import type { ProcessedBook, TTSWorker, AppSettings } from './types';

// Settings State
export const voice = signal<string>('ru-RU, DmitryNeural');
export const narratorVoice = signal<string>('ru-RU, DmitryNeural');
export const voicePoolLocale = signal<string>('ru-RU');
export const rate = signal<number>(0);
export const pitch = signal<number>(0);
export const maxThreads = signal<number>(20);
export const mergeFiles = signal<number>(10);
export const pointsSelect = signal<string>('Не заменять точки');
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
  mergeFiles.value >= 100 ? 'ВСЕ' : `${mergeFiles.value} шт.`
);

// UI State
export const isLiteMode = signal<boolean>(true);
export const showDopSettings = signal<boolean>(false);

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
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSettings(): void {
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
      pointsSelect.value = settings.pointsSelect ?? 'Не заменять точки';
      pointsType.value = settings.pointsType ?? 'V1';
      lexxRegister.value = settings.lexxRegister ?? true;
      showDopSettings.value = settings.showDopSettings ?? false;
      isLiteMode.value = settings.isLiteMode ?? true;
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

export function addStatusLine(message: string): void {
  statusLines.value = [...statusLines.value, message];
}

export function clearStatus(): void {
  statusLines.value = [];
  processedCount.value = 0;
  totalCount.value = 0;
}
