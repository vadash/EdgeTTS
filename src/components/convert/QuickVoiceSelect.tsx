import { computed, signal } from '@preact/signals';
import { Text } from 'preact-i18n';
import voices from '@/components/VoiceSelector/voices';
import { useVoicePreview } from '@/hooks/useVoicePreview';
import { patchSettings, settings, useData } from '@/stores';

const SAMPLE_PHRASES = [
  'The quick brown fox jumps over the lazy dog',
  'Every moment is a fresh beginning',
  'Fortune favors the bold',
  'The stars shine bright tonight',
  'Welcome to the world of voices',
];

const samplePhrase = signal<string>(
  SAMPLE_PHRASES[Math.floor(Math.random() * SAMPLE_PHRASES.length)],
);

export function QuickVoiceSelect() {
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
    <div className="space-y-2">
      <label className="input-label" htmlFor="quick-voice-select">
        <Text id="settings.voice">Voice</Text>
      </label>
      <div className="flex gap-2">
        <select
          id="quick-voice-select"
          className="select-field flex-1"
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
          onClick={playVoiceSample}
          disabled={preview.isPlaying}
          className="btn btn-icon"
          aria-label="Play voice sample"
        >
          {preview.isPlaying ? '...' : '▶'}
        </button>
      </div>
    </div>
  );
}
