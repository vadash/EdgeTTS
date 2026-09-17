import { useCallback, useState } from 'preact/hooks';
import { getFFmpeg } from '@/services';
import type { AudioSettings } from '@/state/types';
import { withRetry } from '@/utils/retry/network';
import { SAMPLE_PHRASES, synthesizeSample, useAudioPreview } from './useAudioPreview';

export type PreviewStage = 'tts' | 'ffmpeg' | null;

export interface AudioProcessingPreviewInput {
  /** Narrator Voice short name, e.g. "en-US-AriaNeural" */
  narratorVoice: string;
  /** Rate in percent points, e.g. 0 -> "+0%" */
  rate?: number;
  /** Pitch in Hz points, e.g. 0 -> "+0Hz" */
  pitch?: number;
  /** Audio settings for the preview; silenceGapMs is always forced to 0 (single Chunk) */
  config: AudioSettings;
}

/**
 * Live filter-chain preview for the Audio settings tab.
 *
 * Synthesizes a short voice sample with the Narrator Voice, runs it through
 * FFmpegService.processAudio with the current Audio settings, and plays the
 * processed result. Playback lifecycle lives in src/hooks/useAudioPreview.ts.
 *
 * stage is 'tts' while synthesizing the sample, 'ffmpeg' while processing,
 * and null when idle. It drives the button label and spinner text.
 */
export function useAudioProcessingPreview() {
  const [stage, setStage] = useState<PreviewStage>(null);

  const { isPlaying, error, stop, play: playCore } = useAudioPreview(() => setStage(null));

  const play = useCallback(
    (input: AudioProcessingPreviewInput) =>
      playCore(
        async () => {
          const text = SAMPLE_PHRASES[Math.floor(Math.random() * SAMPLE_PHRASES.length)];
          const ttsBytes = await synthesizeSample(
            text,
            input.narratorVoice,
            input.rate,
            input.pitch,
          );

          setStage('ffmpeg');

          // silenceGapMs inserts a Gap between Chunks; the sample is one
          // Chunk, so force 0.
          const processConfig: AudioSettings = { ...input.config, silenceGapMs: 0 };

          const ffmpeg = getFFmpeg();
          const processed = await withRetry(
            () => ffmpeg.processAudio([new Uint8Array(ttsBytes)], processConfig),
            { maxRetries: 1 },
          );

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
