import { defaultConfig } from '@/config';
import type { AudioProcessingConfig } from '../FFmpegService';

/**
 * Build FFmpeg audio filter chain string from config flags.
 * Pure function -- no side effects.
 */
export function buildFilterChain(config: AudioProcessingConfig): string {
  const filters: string[] = [];
  const audio = defaultConfig.audio;

  // 1. Highpass -- remove rumble
  if (config.eq) {
    filters.push('highpass=f=60');
  }

  // 2. EQ -- tame harshness (narrower Q for precision)
  if (config.eq) {
    filters.push('equalizer=f=6000:t=q:w=2.5:g=-2');
  }

  // 3. Silence Removal (RMS detection)
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

  // 4. Compressor -- smooth dynamics (using linear threshold value for -18dB)
  if (config.compressor) {
    filters.push('acompressor=threshold=0.12589:ratio=4:attack=5:release=80:makeup=1.0');
  }

  // 5. Normalization + 7. Limiter
  if (config.normalization) {
    filters.push(
      `loudnorm=` +
        `I=${audio.normLufs}:` +
        `LRA=${audio.normLra}:` +
        `TP=${audio.normTruePeak}:` +
        `dual_mono=true`,
    );
  }

  // 7. Limiter (safety limiter after normalization)
  if (config.normalization) {
    filters.push('alimiter=level_in=1:level_out=1:limit=0.95:attack=5:release=150');
  }

  // 6. De-Ess (after normalization, less lispiness)
  if (config.deEss) {
    filters.push('deesser=i=0.25:m=0.4:f=0.5:s=0.4');
  }

  // 8. Fade-In
  if (config.fadeIn) {
    filters.push('afade=t=in:ss=0:d=0.1');
  }

  // 9. Lowpass (gentle roll-off to help Opus encoder)
  if (config.eq) {
    filters.push('lowpass=f=11000');
  }

  return filters.join(',');
}
