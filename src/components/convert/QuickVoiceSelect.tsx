import { computed, signal } from '@preact/signals';
import { Text } from 'preact-i18n';
import voices, { groupVoicesForLanguage } from '@/components/VoiceSelector/voices';
import { SAMPLE_PHRASES } from '@/hooks/useAudioPreview';
import { useVoicePreview } from '@/hooks/useVoicePreview';
import { patchSettings, settings, useData } from '@/stores';

const samplePhrase = signal<string>(
  SAMPLE_PHRASES[Math.floor(Math.random() * SAMPLE_PHRASES.length)],
);

export function QuickVoiceSelect() {
  const data = useData();
  const preview = useVoicePreview();

  // Multilingual voices first, separator, then voices for the detected language
  const filteredVoices = computed(() =>
    groupVoicesForLanguage(voices, data.detectedLanguage.value),
  );

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
