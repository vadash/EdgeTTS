// Voice Review Modal
// Allows user to review and edit voice assignments after character extraction

import { useState, useRef } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Text } from 'preact-i18n';
import type { LLMCharacter } from '@/state/types';
import { useSettings, useLLM, useLogs, useData } from '@/stores';
import { useVoicePreview } from '@/hooks/useVoicePreview';
import { Button } from '@/components/common';
import voices from '@/components/VoiceSelector/voices';
import {
  importProfile,
  readJSONFile,
  randomizeBelowVoices,
} from '@/services/llm/VoiceProfile';

interface VoiceReviewModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

const sampleText = signal('Hello, I am testing this voice.');

export function VoiceReviewModal({ onConfirm, onCancel }: VoiceReviewModalProps) {
  const settings = useSettings();
  const llm = useLLM();
  const logs = useLogs();
  const data = useData();
  const preview = useVoicePreview();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const characters = llm.detectedCharacters.value;
  const voiceMap = llm.characterVoiceMap.value;
  const lineCounts = llm.characterLineCounts.value;

  // Sort characters by line count (more lines = more prominent)
  const sortedCharacters = [...characters].sort((a, b) => {
    const countA = lineCounts.get(a.canonicalName) ?? 0;
    const countB = lineCounts.get(b.canonicalName) ?? 0;
    return countB - countA;
  });

  // Get enabled voices, grouped by gender
  const enabledVoices = settings.enabledVoices.value;
  const maleVoices = voices.filter(v => v.gender === 'male' && enabledVoices.includes(v.fullValue));
  const femaleVoices = voices.filter(v => v.gender === 'female' && enabledVoices.includes(v.fullValue));

  const handleVoiceChange = (characterName: string, newVoice: string) => {
    const oldVoice = voiceMap.get(characterName) ?? '';

    // Find current character's index in sorted list
    const currentIndex = sortedCharacters.findIndex(c => c.canonicalName === characterName);

    // Look for characters BELOW that have the newVoice and swap them
    if (currentIndex >= 0 && oldVoice !== newVoice) {
      const newMap = new Map(voiceMap);
      newMap.set(characterName, newVoice);

      // Find first character below that has the newVoice
      for (let i = currentIndex + 1; i < sortedCharacters.length; i++) {
        const belowChar = sortedCharacters[i];
        if (newMap.get(belowChar.canonicalName) === newVoice) {
          // Swap: give them the old voice
          newMap.set(belowChar.canonicalName, oldVoice);
          break; // Only swap one
        }
      }

      llm.setVoiceMap(newMap);
    } else {
      llm.updateVoiceMapping(characterName, newVoice);
    }
  };

  const handlePlayPreview = (voiceId: string) => {
    const text = sampleText.value || 'Hello, I am testing this voice.';
    preview.play(text, voiceId, {
      rate: settings.rate.value,
      pitch: settings.pitch.value,
    });
  };

  const handleRandomizeBelow = (clickedIndex: number) => {
    const enabledVoiceOptions = voices.filter(v => enabledVoices.includes(v.fullValue));
    const newMap = randomizeBelowVoices({
      sortedCharacters,
      currentVoiceMap: voiceMap,
      clickedIndex,
      enabledVoices: enabledVoiceOptions,
      narratorVoice: settings.voice.value,
      bookLanguage: data.detectedLanguage.value,
    });
    llm.setVoiceMap(newMap);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      setImportError(null);
      const json = await readJSONFile(file);
      const { voiceMap: importedMap, matchedCharacters, unmatchedCharacters } = importProfile(json, characters);

      // Merge imported voices into current map
      const newMap = new Map(voiceMap);
      for (const [name, voice] of importedMap) {
        newMap.set(name, voice);
      }
      llm.setVoiceMap(newMap);

      const matchCount = matchedCharacters.size;
      const unmatchCount = unmatchedCharacters.length;
      logs.info(`Imported voices: ${matchCount} matched, ${unmatchCount} unmatched from ${file.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      setImportError(message);
      logs.error(`Failed to import voice profile: ${message}`);
    }

    input.value = '';
  };

  // Get short voice name for display
  const shortVoiceName = (fullValue: string) => {
    // "en-US, JennyNeural" -> "en-US-JennyNeural"
    return fullValue.replace(', ', '-');
  };

  // Gender symbol
  const genderSymbol = (gender: 'male' | 'female' | 'unknown') => {
    switch (gender) {
      case 'male': return 'M';
      case 'female': return 'F';
      default: return '?';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold">
            <Text id="voiceReview.title">Voice Review</Text>
          </h2>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-white p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Sample text input */}
        <div className="px-4 py-3 border-b border-border">
          <label className="input-label text-sm">
            <Text id="voiceReview.sampleText">Sample text</Text>:
          </label>
          <input
            type="text"
            className="input-field w-full mt-1"
            value={sampleText.value}
            onInput={(e) => sampleText.value = (e.target as HTMLInputElement).value}
            placeholder="Enter sample text to preview voices..."
          />
        </div>

        {/* Character list */}
        <div className="flex-1 overflow-auto px-4 py-3">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-gray-400 border-b border-border">
                <th className="pb-2 font-medium">
                  <Text id="voiceReview.character">Character</Text>
                </th>
                <th className="pb-2 font-medium">
                  <Text id="voiceReview.voice">Voice</Text>
                </th>
                <th className="pb-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {sortedCharacters.map((char, index) => {
                const currentVoice = voiceMap.get(char.canonicalName) ?? '';
                return (
                  <tr key={char.canonicalName} className="border-b border-border/50">
                    <td className="py-2 pr-2">
                      <span className="font-medium">{char.canonicalName}</span>
                      <span className="ml-2 text-gray-500">{genderSymbol(char.gender)}</span>
                      <span className="ml-2 text-xs text-gray-400 bg-surface-alt px-1.5 py-0.5 rounded">
                        {lineCounts.get(char.canonicalName) ?? 0}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        className="select-field w-full text-sm"
                        value={currentVoice}
                        onChange={(e) => handleVoiceChange(char.canonicalName, (e.target as HTMLSelectElement).value)}
                      >
                        <optgroup label="Male">
                          {maleVoices.map(v => (
                            <option key={v.fullValue} value={v.fullValue}>
                              {shortVoiceName(v.fullValue)}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Female">
                          {femaleVoices.map(v => (
                            <option key={v.fullValue} value={v.fullValue}>
                              {shortVoiceName(v.fullValue)}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </td>
                    <td className="py-2">
                      <button
                        className="btn btn-sm px-2"
                        onClick={() => handlePlayPreview(currentVoice)}
                        disabled={preview.isPlaying && preview.currentVoiceId === currentVoice}
                        aria-label={`Preview voice for ${char.canonicalName}`}
                      >
                        {preview.isPlaying && preview.currentVoiceId === currentVoice ? '...' : '▶'}
                      </button>
                    </td>
                    <td className="py-2">
                      <button
                        className="btn btn-sm px-2"
                        onClick={() => handleRandomizeBelow(index)}
                        title="Randomize voices below"
                      >
                        🎲↓
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {characters.length === 0 && (
            <p className="text-gray-500 text-center py-8">
              <Text id="voiceReview.noCharacters">No characters detected</Text>
            </p>
          )}
        </div>

        {/* Import button */}
        <div className="px-4 py-3 border-t border-border">
          <Button onClick={handleImportClick} className="w-full">
            <Text id="voiceReview.import">Import JSON</Text>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
          />
          {importError && (
            <p className="text-red-400 text-sm mt-2">{importError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <Button onClick={onCancel}>
            <Text id="common.cancel">Cancel</Text>
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            <Text id="voiceReview.continue">Continue</Text> →
          </Button>
        </div>
      </div>
    </div>
  );
}
