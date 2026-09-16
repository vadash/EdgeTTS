import { defaultConfig } from '@/config';
import type { AudioSettings } from '@/state/types';

/**
 * Build FFmpeg audio filter chain string from config flags.
 * Pure function -- no side effects.
 */
export function buildFilterChain(audio: AudioSettings): string {
  const filters: string[] = [];
  const defaults = defaultConfig.audio;

  // 1. EQ (Clean & shape the source before gain changes)
  if (audio.eq) {
    filters.push('highpass=f=80', 'equalizer=f=6000:t=q:w=2.5:g=-2', 'lowpass=f=11000');
  }

  // 2. De-Ess (Fix sibilance while signal is "natural" - before compression/normalization)
  if (audio.deEss) {
    filters.push('deesser=i=0.25:m=0.4:f=0.5:s=0.4');
  }

  // 3. Compressor (Smooth out the speech)
  if (audio.compressor) {
    filters.push('acompressor=threshold=0.12589:ratio=3:attack=5:release=150:makeup=1.0');
  }

  // 4. Silence removal -- runs before loudnorm so trimming happens at source level;
  //    stop_silence is clamped to the inter-chunk gap so Remove Silence cannot eat deliberate pauses.
  if (audio.silenceRemoval) {
    const stopSilence = Math.max(defaults.silenceStopDuration, audio.silenceGapMs / 1000);
    filters.push(
      `silenceremove=` +
        `start_periods=${defaults.silenceStartPeriods}:` +
        `start_silence=${defaults.silenceStartDuration}:` +
        `start_threshold=${defaults.silenceThreshold}dB:` +
        `detection=rms:` +
        `stop_periods=${defaults.silenceStopPeriods}:` +
        `stop_silence=${stopSilence}:` +
        `stop_threshold=${defaults.silenceThreshold}dB`,
    );
  }

  // 5. Normalization (Loudnorm handles the heavy lifting - includes built-in true-peak limiting)
  if (audio.normalization) {
    filters.push(
      `loudnorm=I=${defaults.normLufs}:LRA=${defaults.normLra}:TP=${defaults.normTruePeak}:`,
    );
  }

  // 6. Fade-In
  if (audio.fadeIn) {
    filters.push('afade=t=in:ss=0:d=0.1');
  }

  return filters.join(',');
}
