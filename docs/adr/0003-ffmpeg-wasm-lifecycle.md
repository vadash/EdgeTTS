# FFmpeg runs as disposable WASM instances

The FFmpeg core is single-threaded WASM that leaks memory, so instances are disposable: each one terminates and reloads itself after 10 operations, and merge groups run on a small worker pool. More than 4 workers loses to disk I/O and core contention.

## Consequences

- The operation counter is per instance; pool workers start their own count.
- Core loading tries three tiers in order: cached blob URL, IndexedDB, then network. Core blob URLs are cached at module scope so every instance reuses the first successful load. Only an in-memory tier failure clears the cached blob URLs; terminating an instance does not.
- The merge pool size is the user setting, capped at 4.
- The injected singleton is always the first worker and keeps its own lifecycle rules. Extra workers come from a factory and are terminated in a finally block after the merge. The pool spawns no more workers than there are pending groups.
- The first rejection aborts the batch. In-flight workers may still finish and save, which is harmless because resume skips existing files.
