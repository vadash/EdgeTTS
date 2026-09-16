# Pipeline modules take narrow ports, not the Stores bundle

`runConversion` and everything downstream of it never receives the Stores bundle. It takes a `ConversionPorts` object — `ProgressReporter`, `ReviewGate`, `ResumeGate`, `RunControl`, `CharacterDataSink` — with the interfaces defined in the orchestrator module. The hook (`useTTSConversion`) adapts `Stores` to the ports. The stage-to-status mapping (`STAGE_STATUS` in `state/types.ts`) is consumed by that adapter, not by the pipeline. Services (clients, factories, `ChunkStore`) keep arriving through the separate `ConversionOrchestratorServices` bundle.

## Consequences

- A pipeline stage that needs something new from a store widens one port interface in `ConversionOrchestrator.ts`; never pass `Stores` deeper, and never import store modules from the orchestrator.
- Orchestration tests fake ports (a few `vi.fn()` lines each) instead of hand-mocking the whole store bundle; `ChunkStore` arrives via `chunkStoreFactory`, so no prototype spies.
- A new `StageId` fails typecheck at the adapter until `STAGE_STATUS` maps it (`Record` exhaustiveness), so the deleted `updateStatus` switch cannot lose a case silently.
- `FailureLog` and `savePipelineState` own the `_temp_work` JSON files; the orchestrator holds no OPFS JSON code.
- The review gate still reaches `LLMStore` through its adapter, and cancellation is still reconciled by string comparison in the catch block; both are pre-existing debt (the "one Gate + one cancellation encoding" candidate). The `ReviewGate` port makes that future swap local to the adapter.
