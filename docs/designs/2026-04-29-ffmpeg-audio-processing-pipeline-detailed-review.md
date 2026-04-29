# FFmpeg Audio Processing Pipeline

## Optimized Filter Chain

```
Input (concat MP3 chunks)
  → [1] highpass=f=60                    (remove rumble)
  → [2] equalizer=f=6000:t=q:w=2.5:g=-2  (tame harshness, narrower Q)
  → [3] silenceremove (RMS detection)    (remove dead air, better speech behavior)
  → [4] acompressor=threshold=-18dB:ratio=4:attack=5:release=80:makeup=0  (smooth dynamics)
  → [5] loudnorm=I=-20:LRA=7:TP=-1       (target -20 LUFS, single-pass)
  → [6] deesser=i=0.25:m=0.4:f=0.5:s=0.4 (catch sibilance after normalization, less lispiness)
  → [7] alimiter=level_in=1:level_out=1:limit=0.95:attack=5:release=150  (safety limiter)
  → [8] afade=t=in:ss=0:d=0.1            (fade-in)
  → [9] lowpass=f=11000                 (gentle roll-off to help Opus encoder)
  → Opus encode @ 24-48 kbps VBR         (speech-optimized)
```

---

## Complete Configuration Reference

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Sample rate | 24000 Hz | Edge TTS standard |
| Output format | Opus | Best codec for speech |
| Default bitrate | 32 kbps | Transparent for mono speech at 24kHz |
| PC preset | 24-48 kbps, comp=5 | Higher quality for processed audio |
| Mobile preset | 24-48 kbps, comp=3 | Smaller files for mobile |
| `normLufs` | -20 | Audiobook standard |
| `normLra` | 7 | Slightly more dynamic range |
| `normTruePeak` | -1.0 | Safety headroom |
| `silenceThreshold` | -40 dB (RMS) | Better speech behavior than peak detection |
| `silenceStartPeriods` | 1 | Remove leading silence |
| `silenceStartDuration` | 0.75s | Minimum silence duration |
| `silenceStopPeriods` | -1 | Remove all trailing silence |
| `silenceStopDuration` | 0.3s | Prevent cutting word tails |
| Compressor threshold | -18 dB | Catch more peaks than -20 dB |
| Compressor ratio | 4:1 | Effective dynamic range control |
| Compressor attack | 5 ms | Transparent for speech |
| Compressor release | 80 ms | Prevent gain-pumping on sustained vowels |
| Compressor makeup | 0 dB | Let loudnorm handle final level |
| De-esser intensity | 0.25 | Reduce lispiness, keep effectiveness |
| De-esser threshold | 0.4 | Gentle sibilance reduction |
| Fade-in duration | 100 ms | Prevent clicks |
| Lowpass frequency | 11000 Hz | Help Opus encoder allocate bits |

---

## Files Modified

### Phase 1 (Initial optimization)
- `src/services/audio/buildFilterChain.ts`
- `src/services/FFmpegService.ts`
- `src/services/AudioMerger.ts`
- `src/config/index.ts`
- `src/state/types.ts`
- `src/stores/SettingsStore.ts`
- `src/components/settings/tabs/AudioTab.tsx`
- `src/i18n/en.json` & `src/i18n/ru.json`

### Phase 2 (Further refinements)
- `src/services/audio/buildFilterChain.ts`
- `src/services/FFmpegService.ts`
- `src/config/index.ts`
- `src/state/types.ts`

---

Your syntax for the acompressor filter is largely correct, but there is one minor detail regarding the threshold value that often causes issues in FFmpeg commands.
## Syntax Verification
The general structure acompressor=option1=value1:option2=value2 is the standard [FFmpeg filtergraph syntax](https://trac.ffmpeg.org/wiki/FilteringGuide). [1, 2] 

* Filter Name: acompressor is the correct audio compressor filter.
* Threshold (-18dB): While FFmpeg's documentation often mentions dB for conceptual explanations, the threshold parameter in the filter string strictly expects a linear value (a double-precision float) rather than a string ending in "dB".
* To use -18dB, you should convert it to its linear equivalent: $10^{(-18/20)} \approx 0.12589$.
* Other Parameters:
* ratio=4: Correct (4:1 compression ratio).
   * attack=5: Correct (5ms attack time).
   * release=80: Correct (80ms release time).
   * makeup=0: Correct (0dB makeup gain, though this also expects a linear value where $1.0 = 0\text{dB}$). [3, 4, 5, 6, 7] 

## Recommended Syntax
To ensure compatibility with ffmpeg.wasm and standard FFmpeg, use linear values for levels:

# -18dB threshold is approx 0.12589# 0dB makeup gain is 1.0 (linear)
acompressor=threshold=0.12589:ratio=4:attack=5:release=80:makeup=1.0

## Quick Reference for "Smooth" Settings [8] 
Your settings are well-aligned for smooth dynamics: [9, 10] 

* Attack (5ms): Fast enough to catch transients without sounding overly "squashed".
* Release (80ms): Relatively fast, which helps the audio level return to normal quickly, maintaining energy.
* Ratio (4:1): A standard medium ratio for moderate control over dynamics. [11, 12] 
