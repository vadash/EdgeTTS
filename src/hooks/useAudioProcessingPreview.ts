import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { getFFmpeg, getTTSPreviewService } from '@/services';
import type { AudioProcessingConfig } from '@/services/FFmpegService';
import { withRetry } from '@/utils/retry/network';

export type PreviewStage = 'tts' | 'ffmpeg' | null;

// Sample phrases copied from src/components/convert/QuickVoiceSelect.tsx
const SAMPLE_PHRASES = [
  'The quick brown fox jumps over the lazy dog',
  'Every moment is a fresh beginning',
  'Fortune favors the bold',
  'The stars shine bright tonight',
  'Welcome to the world of voices',
];

export interface AudioProcessingPreviewInput {
  /** Narrator voice short name, e.g. "en-US-AriaNeural" */
  narratorVoice: string;
  /** Rate in percent points, e.g. 0 -> "+0%" */
  rate?: number;
  /** Pitch in Hz points, e.g. 0 -> "+0Hz" */
  pitch?: number;
  /** Filter chain config; silenceGapMs is always forced to 0 (single chunk) */
  config: AudioProcessingConfig;
}

/**
 * Live filter-chain preview for the Audio settings tab.
 *
 * Synthesizes a short voice sample with the narrator voice, runs it through
 * FFmpegService.processAudio with the current filter settings, and plays the
 * processed result. Structural template: src/hooks/useVoicePreview.ts.
 *
 * stage: 'tts' while synthesizing the sample, 'ffmpeg' while processing,
 * or null when idle — drives the button label / spinner text.
 */
export function useAudioProcessingPreview() {
  const ttsService = getTTSPreviewService();
  const [isPlaying, setIsPlaying] = useState(false);
  const [stage, setStage] = useState<PreviewStage>(null);
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
    setStage(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const play = useCallback(
    async (input: AudioProcessingPreviewInput) => {
      // Stop any existing playback
      cleanup();

      if (!input.narratorVoice) return;

      setIsPlaying(true);
      setStage('tts');
      setError(null);

      try {
        // ---- TTS: synthesize the sample with the narrator voice ----
        const text = SAMPLE_PHRASES[Math.floor(Math.random() * SAMPLE_PHRASES.length)];
        // Format rate/pitch exactly like useVoicePreview.play
        const rateStr =
          input.rate !== undefined ? `${input.rate >= 0 ? '+' : ''}${input.rate}%` : '+0%';
        const pitchStr =
          input.pitch !== undefined ? `${input.pitch >= 0 ? '+' : ''}${input.pitch}Hz` : '+0Hz';

        const audioData = await ttsService.send({
          text,
          config: {
            voice: `Microsoft Server Speech Text to Speech Voice (${input.narratorVoice})`,
            rate: rateStr,
            pitch: pitchStr,
            volume: '+0%',
          },
        });

        // ---- FFmpeg: process through the filter chain ----
        setStage('ffmpeg');

        // extract an independent ArrayBuffer copy (same slice pattern as useVoicePreview)
        const ttsBytes = new Uint8Array(
          (audioData.buffer as ArrayBuffer).slice(
            audioData.byteOffset,
            audioData.byteOffset + audioData.byteLength,
          ),
        );

        // silenceGapMs is meaningless for a single chunk — always force 0
        const processConfig: AudioProcessingConfig = { ...input.config, silenceGapMs: 0 };

        const ffmpeg = getFFmpeg();
        const processed = await withRetry(() => ffmpeg.processAudio([ttsBytes], processConfig), {
          maxRetries: 1,
        });

        // ---- Play the processed (opus/ogg) result ----
        setStage(null);

        const blob = new Blob([processed as BlobPart], { type: 'audio/ogg; codecs=opus' });
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

  return { play, stop, isPlaying, stage, error };
}
