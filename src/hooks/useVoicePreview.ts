import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { getTTSPreviewService } from '@/services';

export function useVoicePreview() {
  const ttsService = getTTSPreviewService();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentVoiceId, setCurrentVoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs to hold non-reactive instances
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setIsPlaying(false);
    setCurrentVoiceId(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const play = useCallback(
    async (text: string, voiceId: string, options: { rate?: number; pitch?: number } = {}) => {
      // Stop any existing playback
      cleanup();

      if (!text.trim()) return;

      setIsPlaying(true);
      setCurrentVoiceId(voiceId);
      setError(null);

      try {
        // Format rate/pitch for the service
        // EdgeTTS expects string formats like "+0%", "+0Hz"
        const rateStr =
          options.rate !== undefined ? `${options.rate >= 0 ? '+' : ''}${options.rate}%` : '+0%';
        const pitchStr =
          options.pitch !== undefined
            ? `${options.pitch >= 0 ? '+' : ''}${options.pitch}Hz`
            : '+0Hz';

        const audioData = await ttsService.send({
          text,
          config: {
            voice: `Microsoft Server Speech Text to Speech Voice (${voiceId})`,
            rate: rateStr,
            pitch: pitchStr,
            volume: '+0%',
          },
        });

        // Create Blob and Audio
        const blob = new Blob(
          [
            (audioData.buffer as ArrayBuffer).slice(
              audioData.byteOffset,
              audioData.byteOffset + audioData.byteLength,
            ),
          ],
          { type: 'audio/mpeg' },
        );

        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          cleanup();
        };

        audio.onerror = () => {
          setError('Playback failed');
          cleanup();
        };

        await audio.play();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Preview failed');
        cleanup();
      }
    },
    [ttsService, cleanup],
  );

  return { play, stop, isPlaying, currentVoiceId, error };
}
