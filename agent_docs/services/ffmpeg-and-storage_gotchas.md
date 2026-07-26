# FFmpeg & Storage Gotchas

Memory, encoding, and crash-recovery rules for the conversion pipeline.

- **Memory Management**: Do NOT hold audio in RAM. Stream directly to `ChunkStore` (`_temp_work`).
- **FFmpeg Leaks**: `FFmpegService` proactively terminates and reloads itself after 10 operations.
- **FFmpeg Loading**: `FFmpegService.reload` tries 3 tiers: In-memory Blob URL -> IndexedDB -> Network fetch.
- **Audio Filter Chain Order**: `buildFilterChain.ts` emits (in order) `deesser → silenceremove → loudnorm → afade`. EQ and compressor are opt-in and default OFF for new users (Edge TTS speech is already clean/leveled; De-Ess stays on for harsh sibilance). Existing users keep their saved ON state via the `loadFromStorage` merge — do NOT add a settings migration. `silenceremove` runs BEFORE `loudnorm` so trimming happens at source level, not after gain changes.
- **Silence Removal vs. Inter-chunk Gaps**: `FFmpegService.processAudio` inserts `silence.mp3` files between chunks (length = `silenceGapMs`) BEFORE the `-af` filter chain runs. `buildFilterChain` clamps `stop_silence` to `Math.max(silenceStopDuration, silenceGapMs/1000)` so `silenceremove` cannot eat those deliberate pauses. If you touch either the gap insertion or the `stop_silence` computation, keep them in sync or the Gap slider silently breaks above 300 ms.
