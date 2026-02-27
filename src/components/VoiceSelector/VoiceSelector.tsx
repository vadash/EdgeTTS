import { computed, signal } from '@preact/signals';
import { Text } from 'preact-i18n';
import { useVoicePreview } from '../../hooks/useVoicePreview';
import { useData } from '../../stores';
import { patchSettings, settings } from '../../stores/SettingsStore';
import voices from './voices';

const SAMPLE_PHRASES = [
  'The quick brown fox jumps over the lazy dog',
  'Every moment is a fresh beginning',
  'Fortune favors the bold',
  'The stars shine bright tonight',
  'Welcome to the world of voices',
  'Hello and thank you for listening',
  'This is a sample of the selected voice',
  'Reading books is a wonderful adventure',
  'The sun rises in the east and sets in the west',
  'Music brings joy to the heart and soul',
];

const samplePhrase = signal<string>(
  SAMPLE_PHRASES[Math.floor(Math.random() * SAMPLE_PHRASES.length)],
);

export function VoiceSelector() {
  const data = useData();
  const preview = useVoicePreview();

  // Filter voices based on detected language, with separator between groups
  const filteredVoices = computed(() => {
    const lang = data.detectedLanguage.value;
    const multilingual = voices.filter((v) => v.name.includes('Multilingual'));
    const langVoices = voices.filter(
      (v) => v.locale.startsWith(lang) && !v.name.includes('Multilingual'),
    );
    return [
      ...multilingual.map((v) => ({ ...v, isSeparator: false })),
      { fullValue: '---', name: '---', locale: '---', gender: 'male' as const, isSeparator: true },
      ...langVoices.map((v) => ({ ...v, isSeparator: false })),
    ];
  });

  const playVoiceSample = () => {
    preview.play(samplePhrase.value, settings.value.narratorVoice, {
      rate: settings.value.rate,
      pitch: settings.value.pitch,
    });
  };

  return (
    <div class="voice-selector">
      <label class="voice-selector-label" htmlFor="voice-select">
        <Text id="settings.voice">Voice</Text>:
      </label>
      <div class="voice-selector-row">
        <select
          id="voice-select"
          class="voice-select"
          value={settings.value.narratorVoice}
          onChange={(e) => patchSettings({ narratorVoice: (e.target as HTMLSelectElement).value })}
        >
          {filteredVoices.value.map((v) =>
            v.isSeparator ? (
              <option key="separator" disabled>
                ────────────
              </option>
            ) : (
              <option key={v.fullValue} value={v.fullValue}>
                {v.fullValue} ({v.gender})
              </option>
            ),
          )}
        </select>
        <button
          type="button"
          class="play-sample-btn"
          onClick={playVoiceSample}
          disabled={preview.isPlaying}
          aria-label="Play voice sample"
          aria-busy={preview.isPlaying}
        >
          {preview.isPlaying ? '...' : '▶'}
        </button>
      </div>
      <input
        type="text"
        class="sample-phrase-input"
        value={samplePhrase.value}
        onInput={(e) => (samplePhrase.value = (e.target as HTMLInputElement).value)}
        placeholder="Sample phrase..."
        aria-label="Sample phrase for voice preview"
      />
    </div>
  );
}
