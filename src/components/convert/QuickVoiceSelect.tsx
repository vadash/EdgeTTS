import { signal, computed } from '@preact/signals';
import { Text } from 'preact-i18n';
import { useSettings, useData } from '@/stores';
import { useLogger } from '@/di';
import voices from '@/components/VoiceSelector/voices';
import { EdgeTTSService } from '@/services/EdgeTTSService';

const SAMPLE_PHRASES = [
  "The quick brown fox jumps over the lazy dog",
  "Every moment is a fresh beginning",
  "Fortune favors the bold",
  "The stars shine bright tonight",
  "Welcome to the world of voices",
];

const samplePhrase = signal<string>(SAMPLE_PHRASES[Math.floor(Math.random() * SAMPLE_PHRASES.length)]);
const isPlaying = signal<boolean>(false);

export function QuickVoiceSelect() {
  const settings = useSettings();
  const data = useData();
  const logger = useLogger();

  // Filter voices based on detected language
  const filteredVoices = computed(() => {
    const lang = data.detectedLanguage.value;
    return voices.filter(v =>
      v.locale.startsWith(lang) || v.name.includes('Multilingual')
    );
  });

  const playVoiceSample = async () => {
    if (isPlaying.value || !samplePhrase.value.trim()) return;

    isPlaying.value = true;

    try {
      const audioData = await new Promise<Uint8Array>((resolve, reject) => {
        const tts = new EdgeTTSService({
          indexPart: 0,
          filename: 'sample',
          filenum: '0',
          config: {
            voice: `Microsoft Server Speech Text to Speech Voice (${settings.narratorVoice.value})`,
            rate: `${settings.rate.value >= 0 ? '+' : ''}${settings.rate.value}%`,
            pitch: `${settings.pitch.value >= 0 ? '+' : ''}${settings.pitch.value}Hz`,
            volume: '+0%'
          },
          text: samplePhrase.value,
          onComplete: resolve,
          onError: reject
        });
        tts.start();
      });

      const blob = new Blob([(audioData.buffer as ArrayBuffer).slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength)], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      audio.onended = () => {
        URL.revokeObjectURL(url);
        isPlaying.value = false;
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        isPlaying.value = false;
      };

      await audio.play();
    } catch (e) {
      logger.error('Failed to play sample', e instanceof Error ? e : undefined);
      isPlaying.value = false;
    }
  };

  return (
    <div className="space-y-2">
      <label className="input-label">
        <Text id="settings.voice">Voice</Text>
      </label>
      <div className="flex gap-2">
        <select
          className="select-field flex-1"
          value={settings.narratorVoice.value}
          onChange={(e) => settings.setNarratorVoice((e.target as HTMLSelectElement).value)}
        >
          {filteredVoices.value.map((v) => (
            <option key={v.fullValue} value={v.fullValue}>
              {v.fullValue} ({v.gender})
            </option>
          ))}
        </select>
        <button
          onClick={playVoiceSample}
          disabled={isPlaying.value}
          className="btn btn-icon"
          aria-label="Play voice sample"
        >
          {isPlaying.value ? '...' : '▶'}
        </button>
      </div>
    </div>
  );
}
