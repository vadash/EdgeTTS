import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { getTTSPreviewService } from '@/services';

export const SAMPLE_PHRASES = [
  'The quick brown fox jumps over the lazy dog',
  'Every moment is a fresh beginning',
  'Fortune favors the bold',
  'The stars shine bright tonight',
  'Welcome to the world of voices',
];

/**
 * Synthesize a short TTS sample and return an independent copy of the audio
 * bytes. Rate/pitch use the EdgeTTS wire formats ("+0%", "+0Hz").
 */
export async function synthesizeSample(
  text: string,
  voiceId: string,
  rate?: number,
  pitch?: number,
): Promise<ArrayBuffer> {
  const rateStr = rate !== undefined ? `${rate >= 0 ? '+' : ''}${rate}%` : '+0%';
  const pitchStr = pitch !== undefined ? `${pitch >= 0 ? '+' : ''}${pitch}Hz` : '+0Hz';

  const audioData = await getTTSPreviewService().send({
    text,
    config: {
      voice: `Microsoft Server Speech Text to Speech Voice (${voiceId})`,
      rate: rateStr,
      pitch: pitchStr,
      volume: '+0%',
    },
  });

  return (audioData.buffer as ArrayBuffer).slice(
    audioData.byteOffset,
    audioData.byteOffset + audioData.byteLength,
  );
}

interface StartOptions {
  /** Return false to abort after the stop but before the playing state is set. */
  shouldStart?: () => boolean;
  /** Marks hook-specific state (e.g. currentVoiceId, stage) as started. */
  onStart?: () => void;
}

/**
 * Shared playback core for the audio-preview hooks: owns the Audio element
 * and object-URL refs, the isPlaying/error state, and the single stop path.
 *
 * `onReset` runs on every stop (manual stop, playback end, error, unmount,
 * restart) to clear hook-specific state. It is read through a ref, so an
 * unstable identity is fine.
 */
export function useAudioPreview(onReset?: () => void) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

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
    onResetRef.current?.();
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    cleanup();
  }, [cleanup]);

  /**
   * Run one preview: stops any current playback, then (unless `shouldStart`
   * rejects) produces the blob and plays it. Any failure lands in `error`
   * and resets playback state.
   */
  const play = useCallback(
    async (produce: () => Promise<Blob>, options: StartOptions = {}) => {
      cleanup();

      if (options.shouldStart && !options.shouldStart()) return;

      setIsPlaying(true);
      options.onStart?.();
      setError(null);

      try {
        const blob = await produce();

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
    [cleanup],
  );

  return { isPlaying, error, stop, play };
}
