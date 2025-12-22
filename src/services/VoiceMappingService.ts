// Voice Mapping Service
// Handles export/import of character-to-voice mappings

import type { LLMCharacter } from '@/state/types';

/**
 * A single voice mapping entry
 */
export interface VoiceMappingEntry {
  name: string;
  voice: string;
  gender: 'male' | 'female' | 'unknown';
}

/**
 * Voice mapping file format
 */
export interface VoiceMappingFile {
  version: 1;
  narrator: string;
  voices: VoiceMappingEntry[];
}

/**
 * Export characters and voice mappings to JSON string
 */
export function exportToJSON(
  characters: LLMCharacter[],
  voiceMap: Map<string, string>,
  narratorVoice: string
): string {
  const voices: VoiceMappingEntry[] = characters.map(char => ({
    name: char.canonicalName,
    voice: voiceMap.get(char.canonicalName) ?? '',
    gender: char.gender,
  }));

  const data: VoiceMappingFile = {
    version: 1,
    narrator: narratorVoice,
    voices,
  };

  return JSON.stringify(data, null, 2);
}

/**
 * Import voice mappings from JSON string
 * Returns entries and narrator voice
 */
export function importFromJSON(json: string): {
  entries: VoiceMappingEntry[];
  narrator: string;
} {
  const data = JSON.parse(json) as VoiceMappingFile;

  if (!data.version || data.version !== 1) {
    throw new Error('Invalid voice mapping file version');
  }

  if (!Array.isArray(data.voices)) {
    throw new Error('Invalid voice mapping file: missing voices array');
  }

  return {
    entries: data.voices,
    narrator: data.narrator ?? '',
  };
}

/**
 * Apply imported entries to existing characters and voice map
 * Only updates characters that exist in both the import and current list
 */
export function applyImportedMappings(
  importedEntries: VoiceMappingEntry[],
  currentCharacters: LLMCharacter[],
  currentVoiceMap: Map<string, string>
): Map<string, string> {
  const newMap = new Map(currentVoiceMap);
  const importMap = new Map(importedEntries.map(e => [e.name.toLowerCase(), e]));

  for (const char of currentCharacters) {
    const imported = importMap.get(char.canonicalName.toLowerCase());
    if (imported && imported.voice) {
      newMap.set(char.canonicalName, imported.voice);
      // Also update variations
      for (const variation of char.variations) {
        newMap.set(variation, imported.voice);
      }
    }
  }

  return newMap;
}

/**
 * Download JSON as a file
 */
export function downloadJSON(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Read JSON file from user input
 */
export async function readJSONFile(file: File): Promise<string> {
  return file.text();
}
