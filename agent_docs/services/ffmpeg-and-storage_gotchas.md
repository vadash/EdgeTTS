# FFmpeg & Storage Gotchas

Memory, encoding, and crash-recovery rules for the conversion pipeline.

- **Memory Management**: Do NOT hold audio in RAM. Stream directly to `ChunkStore` (`_temp_work`).
- **FFmpeg Leaks**: `FFmpegService` proactively terminates and reloads itself after 10 operations.
- **FFmpeg Loading**: `FFmpegService.reload` tries 3 tiers: In-memory Blob URL -> IndexedDB -> Network fetch.
- **Session Resume**: `ResumeCheck.ts` reads `_temp_work/pipeline_state.json` to seamlessly recover crashed conversions.
