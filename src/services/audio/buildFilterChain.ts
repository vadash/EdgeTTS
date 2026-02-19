import type { AudioProcessingConfig } from '../FFmpegService';
import { defaultConfig } from '@/config';

/**
 * Build FFmpeg audio filter chain string from config flags.
 * Pure function — no side effects.
 */
export function buildFilterChain(config: AudioProcessingConfig): string {
  const filters: string[] = [];
  const audio = defaultConfig.audio;

  // 1. EQ — Broadcast Voice warmth & clarity
  if (config.eq) {
    filters.push(
      'highpass=f=60',
      'lowshelf=f=120:g=2',
      'equalizer=f=3000:t=q:w=1:g=-2'
    );
  }

  // 2. De-Ess
  if (config.deEss) {
    filters.push('deesser=i=0.4:m=0.5:f=0.5:s=0.5');
  }

  // 3. Silence Removal
  if (config.silenceRemoval) {
    filters.push(
      `silenceremove=` +
      `start_periods=${audio.silenceStartPeriods}:` +
      `start_silence=${audio.silenceStartDuration}:` +
      `start_threshold=${audio.silenceThreshold}dB:` +
      `detection=peak:` +
      `stop_periods=${audio.silenceStopPeriods}:` +
      `stop_silence=${audio.silenceStopDuration}:` +
      `stop_threshold=${audio.silenceThreshold}dB`
    );
  }

  // 4. Compressor — gentle vocal compression
  if (config.compressor) {
    filters.push(
      'compand=attacks=0.1:decays=0.8:points=-90/-90|-50/-50|-30/-30|-20/-20:soft-knee=6:gain=0'
    );
  }

  // 5. Normalization + 6. Limiter (auto with normalization)
  if (config.normalization) {
    filters.push(
      `loudnorm=` +
      `I=${audio.normLufs}:` +
      `LRA=${audio.normLra}:` +
      `TP=${audio.normTruePeak}:` +
      `dual_mono=true`
    );
    // Limiter always follows normalization
    filters.push(
      'alimiter=level_in=1:level_out=1:limit=0.95:attack=5:release=50:asc=0:asc_level=0'
    );
  }

  // 7. Fade-In
  if (config.fadeIn) {
    filters.push('afade=t=in:ss=0:d=0.1');
  }

  // 8. Stereo Width (pseudo-stereo)
  if (config.stereoWidth) {
    filters.push('aecho=0.8:0.88:10:0.3');
  }

  return filters.join(',');
}
