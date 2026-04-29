import { defaultConfig } from '@/config';
import type { AudioProcessingConfig } from '../FFmpegService';

/**
 * Build FFmpeg audio filter chain string from config flags.
 * Pure function -- no side effects.
 */
export function buildFilterChain(config: AudioProcessingConfig): string {
  const filters: string[] = [];
  const audio = defaultConfig.audio;

  // 1. Clean & Shape (Correcting source before gain changes)
  if (config.eq) {
    filters.push('highpass=f=80', 'equalizer=f=6000:t=q:w=2.5:g=-2');
  }

  // 2. De-Ess (Fix sibilance while signal is "natural" - before compression/normalization)
  if (config.deEss) {
    filters.push('deesser=i=0.25:m=0.4:f=0.5:s=0.4');
  }

  // 3. Dynamics (Smooth out the speech)
  if (config.compressor) {
    filters.push('acompressor=threshold=0.12589:ratio=3:attack=5:release=150:makeup=1.0');
  }

  // 4. Standards (Loudnorm handles the heavy lifting - includes built-in true-peak limiting)
  if (config.normalization) {
    filters.push(
      `loudnorm=` +
        `I=${audio.normLufs}:` +
        `LRA=${audio.normLra}:` +
        `TP=${audio.normTruePeak}:`
    );
  }

  // 5. Cleanup (Remove silence after gain is stabilized)
  if (config.silenceRemoval) {
    filters.push(
      `silenceremove=` +
        `start_periods=${audio.silenceStartPeriods}:` +
        `start_silence=${audio.silenceStartDuration}:` +
        `start_threshold=${audio.silenceThreshold}dB:` +
        `detection=rms:` +
        `stop_periods=${audio.silenceStopPeriods}:` +
        `stop_silence=${audio.silenceStopDuration}:` +
        `stop_threshold=${audio.silenceThreshold}dB`,
    );
  }

  // 6. Finishing
  if (config.fadeIn) {
    filters.push('afade=t=in:ss=0:d=0.1');
  }

  // 7. EQ
  if (config.eq) {
    filters.push('lowpass=f=11000');
  }

  return filters.join(',');
}
