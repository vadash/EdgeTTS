import { useCallback, useState } from 'preact/hooks';
import { getFFmpeg } from '@/services';
import type { AudioProcessingConfig } from '@/services/FFmpegService';
import { withRetry } from '@/utils/retry/network';
import { SAMPLE_PHRASES, synthesizeSample, useAudioPreview } from './useAudioPreview';

export type PreviewStage = 'tts' | 'ffmpeg' | null;

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
 * processed result. Playback lifecycle lives in src/hooks/useAudioPreview.ts.
 *
 * stage: 'tts' while synthesizing the sample, 'ffmpeg' while processing,
 * or null when idle — drives the button label / spinner text.
 */
export function useAudioProcessingPreview() {
  const [stage, setStage] = useState<PreviewStage>(null);

  const { isPlaying, error, stop, play: playCore } = useAudioPreview(() => setStage(null));

  const play = useCallback(
    (input: AudioProcessingPreviewInput) =>
      playCore(
        async () => {
          // ---- TTS: synthesize the sample with the narrator voice ----
          const text = SAMPLE_PHRASES[Math.floor(Math.random() * SAMPLE_PHRASES.length)];
          const ttsBytes = await synthesizeSample(
            text,
            input.narratorVoice,
            input.rate,
            input.pitch,
          );

          // ---- FFmpeg: process through the filter chain ----
          setStage('ffmpeg');

          // silenceGapMs is meaningless for a single chunk — always force 0
          const processConfig: AudioProcessingConfig = { ...input.config, silenceGapMs: 0 };

          const ffmpeg = getFFmpeg();
          const processed = await withRetry(
            () => ffmpeg.processAudio([new Uint8Array(ttsBytes)], processConfig),
            { maxRetries: 1 },
          );

          // ---- Play the processed (opus/ogg) result ----
          setStage(null);

          return new Blob([processed as BlobPart], { type: 'audio/ogg; codecs=opus' });
        },
        {
          shouldStart: () => !!input.narratorVoice,
          onStart: () => setStage('tts'),
        },
      ),
    [playCore],
  );

  return { play, stop, isPlaying, stage, error };
}
