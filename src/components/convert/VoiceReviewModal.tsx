// Voice Review Modal
// Allows user to review and edit voice assignments after character extraction

import { signal } from '@preact/signals';
import { useRef, useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { Button } from '@/components/common';
import voices from '@/components/VoiceSelector/voices';
import { useVoicePreview } from '@/hooks/useVoicePreview';
import { importProfile, randomizeBelowVoices, readJSONFile } from '@/services/llm/VoiceProfile';
import { assignUnmatchedFromPool } from '@/services/VoiceAllocator';
import type { VoiceProfileFile } from '@/state/types';
import { useData, useLLM, useLogs, useSettings } from '@/stores';
import { VoicePicker } from './VoicePicker';

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
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});

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
  const maleVoices = voices.filter(
    (v) => v.gender === 'male' && enabledVoices.includes(v.fullValue),
  );
  const femaleVoices = voices.filter(
    (v) => v.gender === 'female' && enabledVoices.includes(v.fullValue),
  );

  const handleVoiceChange = (characterName: string, newVoice: string) => {
    const oldVoice = voiceMap.get(characterName) ?? '';

    // Find current character's index in sorted list
    const currentIndex = sortedCharacters.findIndex((c) => c.canonicalName === characterName);

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
    const enabledVoiceOptions = voices.filter((v) => enabledVoices.includes(v.fullValue));
    const newMap = randomizeBelowVoices({
      sortedCharacters,
      currentVoiceMap: voiceMap,
      clickedIndex,
      enabledVoices: enabledVoiceOptions,
      narratorVoice: settings.narratorVoice.value,
      bookLanguage: data.detectedLanguage.value,
      frequency: lineCounts,
      shuffle: true,
    });
    llm.setVoiceMap(newMap);
  };

  // Merge the `dropName` character into `keepName`: keep's name/gender/voice survive,
  // drop's variations plus its canonicalName are appended (deduped). Indexes resolve
  // against the unsorted detectedCharacters array, NOT sortedCharacters display order.
  const handleMerge = (keepName: string, dropName: string) => {
    const all = llm.detectedCharacters.value;
    const keepIdx = all.findIndex((c) => c.canonicalName === keepName);
    const dropIdx = all.findIndex((c) => c.canonicalName === dropName);
    if (keepIdx < 0 || dropIdx < 0 || keepIdx === dropIdx) return;
    const keep = all[keepIdx];
    const drop = all[dropIdx];
    llm.updateCharacter(keepIdx, {
      variations: [...new Set([...keep.variations, ...drop.variations, drop.canonicalName])],
    });
    llm.removeCharacter(dropIdx);
    llm.removeVoiceMapping(dropName);
    setMergeTarget((prev) => ({ ...prev, [keepName]: '' }));
    logs.info(`Merged "${dropName}" into "${keepName}"`);
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
      const {
        voiceMap: importedMap,
        matchedCharacters,
        unmatchedCharacters,
      } = importProfile(json, characters);

      // Reassign unmatched + invalid voices from priority pool
      const enabledVoiceOptions = voices.filter((v) => enabledVoices.includes(v.fullValue));
      const newMap = assignUnmatchedFromPool(
        sortedCharacters,
        importedMap,
        enabledVoiceOptions,
        settings.narratorVoice.value,
        data.detectedLanguage.value,
      );
      llm.setVoiceMap(newMap);

      // Store the parsed profile for cumulative merge during export
      const parsed = JSON.parse(json) as VoiceProfileFile;
      llm.setLoadedProfile(parsed);

      // Count how many imported voices were not in enabled list
      const enabledSet = new Set(enabledVoices);
      const replacedCount = [...importedMap.values()].filter((v) => !enabledSet.has(v)).length;
      const matchCount = matchedCharacters.size - replacedCount;
      const unmatchCount = unmatchedCharacters.length + replacedCount;
      logs.info(
        `Imported voices: ${matchCount} matched, ${unmatchCount} reassigned from ${file.name}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      setImportError(message);
      logs.error(`Failed to import voice profile: ${message}`);
    }

    input.value = '';
  };

  // Gender symbol
  const genderSymbol = (gender: 'male' | 'female' | 'unknown') => {
    switch (gender) {
      case 'male':
        return 'M';
      case 'female':
        return 'F';
      default:
        return '?';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold">
            <Text id="voiceReview.title">Voice Review</Text>
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-400 hover:text-white p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Sample text input */}
        <div className="px-4 py-3 border-b border-border">
          <label className="input-label text-sm" htmlFor="sample-text-input">
            <Text id="voiceReview.sampleText">Sample text</Text>:
          </label>
          <input
            id="sample-text-input"
            type="text"
            className="input-field w-full mt-1"
            value={sampleText.value}
            onInput={(e) => (sampleText.value = (e.target as HTMLInputElement).value)}
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

                // Build used-above map: voices assigned to rows 0..index-1
                const usedAbove = new Map<string, string>();
                for (let i = 0; i < index; i++) {
                  const v = voiceMap.get(sortedCharacters[i].canonicalName);
                  if (v) usedAbove.set(v, sortedCharacters[i].canonicalName);
                }

                return (
                  <tr key={char.canonicalName} className="border-b border-border/50">
                    {/* Character column: name/gender/count on line 1, merge select on line 2 */}
                    <td className="py-2 pr-2 align-bottom">
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <span className="font-medium">{char.canonicalName}</span>
                        <span className="text-gray-500 text-xs">{genderSymbol(char.gender)}</span>
                        <span className="text-xs text-gray-400 bg-surface-alt px-1.5 py-0.5 rounded">
                          {lineCounts.get(char.canonicalName) ?? 0}
                        </span>
                      </div>
                      <select
                        className="select-field text-xs w-full"
                        value={mergeTarget[char.canonicalName] ?? ''}
                        onChange={(e) => {
                          const target = (e.target as HTMLSelectElement).value;
                          if (target) handleMerge(target, char.canonicalName);
                        }}
                        title="Merge this character into another"
                        aria-label={`Merge ${char.canonicalName} into...`}
                      >
                        <option value="">Merge into…</option>
                        {sortedCharacters
                          .filter((c) => c.canonicalName !== char.canonicalName)
                          .map((c) => (
                            <option key={c.canonicalName} value={c.canonicalName}>
                              {c.canonicalName}
                            </option>
                          ))}
                      </select>
                    </td>
                    {/* Voice column: VoicePicker aligned to merge-select baseline */}
                    <td className="py-2 pr-2 align-bottom">
                      <VoicePicker
                        value={currentVoice}
                        maleVoices={maleVoices}
                        femaleVoices={femaleVoices}
                        usedAbove={usedAbove}
                        onChange={(v) => handleVoiceChange(char.canonicalName, v)}
                      />
                    </td>
                    {/* Play + Dice buttons, aligned to bottom */}
                    <td className="py-2 align-bottom">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn btn-sm px-2"
                          onClick={() => handlePlayPreview(currentVoice)}
                          disabled={preview.isPlaying && preview.currentVoiceId === currentVoice}
                          aria-label={`Preview voice for ${char.canonicalName}`}
                        >
                          {preview.isPlaying && preview.currentVoiceId === currentVoice
                            ? '...'
                            : '▶'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm px-2"
                          onClick={() => handleRandomizeBelow(index)}
                          title="Randomize voices below"
                        >
                          🎲↓
                        </button>
                      </div>
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
          {importError && <p className="text-red-400 text-sm mt-2">{importError}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <Button onClick={onCancel}>
            <Text id="common.cancel">Cancel</Text>
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            <Text id="voiceReview.continue">Continue</Text>
            {' ->'}
          </Button>
        </div>
      </div>
    </div>
  );
}
