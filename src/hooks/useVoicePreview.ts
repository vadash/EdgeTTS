import { useCallback, useState } from 'preact/hooks';
import { synthesizeSample, useAudioPreview } from './useAudioPreview';

export function useVoicePreview() {
  const [currentVoiceId, setCurrentVoiceId] = useState<string | null>(null);

  const { isPlaying, error, stop, play: playCore } = useAudioPreview(() => setCurrentVoiceId(null));

  const play = useCallback(
    (text: string, voiceId: string, options: { rate?: number; pitch?: number } = {}) =>
      playCore(
        async () => {
          const audioBytes = await synthesizeSample(text, voiceId, options.rate, options.pitch);
          return new Blob([audioBytes], { type: 'audio/mpeg' });
        },
        {
          shouldStart: () => !!text.trim(),
          onStart: () => setCurrentVoiceId(voiceId),
        },
      ),
    [playCore],
  );

  return { play, stop, isPlaying, currentVoiceId, error };
}
