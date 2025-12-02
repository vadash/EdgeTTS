import { useState } from 'preact/hooks';
import {
  detectedCharacters,
  characterVoiceMap,
  llmProcessingStatus,
} from '../state/appState';
import type { LLMCharacter } from '../state/types';
import { getFilteredVoices } from '../services/VoicePoolBuilder';

interface CharacterReviewPanelProps {
  onContinue: () => void;
  onCancel: () => void;
}

export function CharacterReviewPanel({ onContinue, onCancel }: CharacterReviewPanelProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [mergeSelection, setMergeSelection] = useState<Set<number>>(new Set());

  const characters = detectedCharacters.value;
  const voiceMap = characterVoiceMap.value;
  const availableVoices = getFilteredVoices();

  const handleNameChange = (index: number, newName: string) => {
    const updated = [...characters];
    const oldName = updated[index].canonicalName;
    updated[index] = { ...updated[index], canonicalName: newName };
    detectedCharacters.value = updated;

    // Update voice map
    const newMap = new Map(voiceMap);
    const voice = newMap.get(oldName);
    if (voice) {
      newMap.delete(oldName);
      newMap.set(newName, voice);
    }
    characterVoiceMap.value = newMap;
  };

  const handleGenderChange = (index: number, gender: 'male' | 'female' | 'unknown') => {
    const updated = [...characters];
    updated[index] = { ...updated[index], gender };
    detectedCharacters.value = updated;
  };

  const handleVoiceChange = (index: number, voiceId: string) => {
    const char = characters[index];
    const newMap = new Map(voiceMap);
    newMap.set(char.canonicalName, voiceId);
    characterVoiceMap.value = newMap;
  };

  const handleVariationsChange = (index: number, variationsStr: string) => {
    const updated = [...characters];
    const variations = variationsStr.split(',').map(v => v.trim()).filter(v => v);
    updated[index] = { ...updated[index], variations };
    detectedCharacters.value = updated;
  };

  const handleDelete = (index: number) => {
    const char = characters[index];
    const updated = characters.filter((_, i) => i !== index);
    detectedCharacters.value = updated;

    // Remove from voice map
    const newMap = new Map(voiceMap);
    newMap.delete(char.canonicalName);
    characterVoiceMap.value = newMap;
  };

  const handleMerge = () => {
    if (mergeSelection.size < 2) return;

    const indices = Array.from(mergeSelection).sort((a, b) => a - b);
    const primary = characters[indices[0]];
    const toMerge = indices.slice(1).map(i => characters[i]);

    // Combine variations
    const allVariations = new Set(primary.variations);
    for (const char of toMerge) {
      allVariations.add(char.canonicalName);
      char.variations.forEach(v => allVariations.add(v));
    }

    // Update primary character
    const updated = characters.filter((_, i) => !mergeSelection.has(i) || i === indices[0]);
    const primaryIndex = updated.findIndex(c => c.canonicalName === primary.canonicalName);
    updated[primaryIndex] = {
      ...primary,
      variations: Array.from(allVariations),
    };

    detectedCharacters.value = updated;

    // Update voice map - remove merged characters
    const newMap = new Map(voiceMap);
    for (const char of toMerge) {
      newMap.delete(char.canonicalName);
    }
    characterVoiceMap.value = newMap;

    setMergeSelection(new Set());
  };

  const handleAddCharacter = () => {
    const newChar: LLMCharacter = {
      canonicalName: `Character ${characters.length + 1}`,
      variations: [],
      gender: 'unknown',
    };
    detectedCharacters.value = [...characters, newChar];
  };

  const toggleMergeSelect = (index: number) => {
    const newSelection = new Set(mergeSelection);
    if (newSelection.has(index)) {
      newSelection.delete(index);
    } else {
      newSelection.add(index);
    }
    setMergeSelection(newSelection);
  };

  if (llmProcessingStatus.value !== 'review') {
    return null;
  }

  return (
    <div
      class="character-review-panel"
      style={{
        padding: '1rem',
        background: 'var(--panel-bg, #1a1a1a)',
        borderRadius: '8px',
        marginBottom: '1rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        <h3 style={{ margin: 0 }}>📝 Character Review</h3>
        <span style={{ fontSize: '0.9rem', opacity: 0.7 }}>
          {characters.length} characters detected
        </span>
      </div>

      <p style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '1rem' }}>
        Review and edit detected characters before continuing to TTS conversion.
      </p>

      {mergeSelection.size >= 2 && (
        <button
          onClick={handleMerge}
          style={{
            width: '100%',
            marginBottom: '1rem',
            background: 'var(--accent-color, #4a9eff)',
          }}
        >
          🔗 Merge {mergeSelection.size} Selected Characters
        </button>
      )}

      <div
        class="character-list"
        style={{
          maxHeight: '400px',
          overflowY: 'auto',
          marginBottom: '1rem',
        }}
      >
        {characters.map((char, index) => (
          <div
            key={char.canonicalName}
            style={{
              padding: '0.75rem',
              marginBottom: '0.5rem',
              background: mergeSelection.has(index)
                ? 'rgba(74, 158, 255, 0.2)'
                : 'var(--item-bg, #252525)',
              borderRadius: '6px',
              border: mergeSelection.has(index)
                ? '1px solid var(--accent-color, #4a9eff)'
                : '1px solid transparent',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                marginBottom: '0.5rem',
              }}
            >
              <input
                type="checkbox"
                checked={mergeSelection.has(index)}
                onChange={() => toggleMergeSelect(index)}
                title="Select for merge"
              />

              <input
                type="text"
                value={char.canonicalName}
                onInput={(e) =>
                  handleNameChange(index, (e.target as HTMLInputElement).value)
                }
                style={{
                  flex: 1,
                  padding: '0.4rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color, #444)',
                  background: 'var(--input-bg, #222)',
                  color: 'inherit',
                  fontWeight: 'bold',
                }}
              />

              <select
                value={char.gender}
                onChange={(e) =>
                  handleGenderChange(
                    index,
                    (e.target as HTMLSelectElement).value as 'male' | 'female' | 'unknown'
                  )
                }
                style={{
                  padding: '0.4rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color, #444)',
                  background: 'var(--input-bg, #222)',
                  color: 'inherit',
                }}
              >
                <option value="male">♂ Male</option>
                <option value="female">♀ Female</option>
                <option value="unknown">? Unknown</option>
              </select>

              <button
                onClick={() => handleDelete(index)}
                style={{
                  padding: '0.4rem 0.6rem',
                  background: 'rgba(200, 0, 0, 0.3)',
                }}
                title="Delete character"
              >
                🗑️
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                fontSize: '0.9rem',
              }}
            >
              <span style={{ opacity: 0.7, minWidth: '80px' }}>Variations:</span>
              <input
                type="text"
                value={char.variations.join(', ')}
                onInput={(e) =>
                  handleVariationsChange(index, (e.target as HTMLInputElement).value)
                }
                placeholder="Name variations (comma-separated)"
                style={{
                  flex: 1,
                  padding: '0.3rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color, #444)',
                  background: 'var(--input-bg, #222)',
                  color: 'inherit',
                  fontSize: '0.85rem',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                marginTop: '0.5rem',
                fontSize: '0.9rem',
              }}
            >
              <span style={{ opacity: 0.7, minWidth: '80px' }}>Voice:</span>
              <select
                value={voiceMap.get(char.canonicalName) || ''}
                onChange={(e) =>
                  handleVoiceChange(index, (e.target as HTMLSelectElement).value)
                }
                style={{
                  flex: 1,
                  padding: '0.3rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color, #444)',
                  background: 'var(--input-bg, #222)',
                  color: 'inherit',
                  fontSize: '0.85rem',
                }}
              >
                {availableVoices.map((voice) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleAddCharacter}
        style={{
          width: '100%',
          marginBottom: '0.5rem',
          background: 'var(--secondary-bg, #333)',
        }}
      >
        ➕ Add Character
      </button>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            background: 'var(--secondary-bg, #333)',
          }}
        >
          ❌ Cancel
        </button>
        <button
          onClick={onContinue}
          style={{
            flex: 2,
            background: 'var(--accent-color, #4a9eff)',
          }}
        >
          ▶️ Continue to TTS
        </button>
      </div>
    </div>
  );
}
