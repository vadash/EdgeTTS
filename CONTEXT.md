# Edge TTS Web

A local-first web app that converts a Book into an audiobook: Edge TTS synthesizes speech, an LLM assigns Character voices.

## Language

### Pipeline

**Book**:
The input document (EPUB, FB2, or TXT) being converted into an audiobook.
_Avoid_: file, project

**Conversion**:
One run of the pipeline over a Book, producing the final audio.
_Avoid_: job, task, session

**Block**:
A scene-sized group of sentences that the LLM passes consume.
_Avoid_: chunk, section

**Chunk**:
A unit of synthesized speech, streamed to disk. The audio merge reads chunks to encode the final audio.
_Avoid_: block, segment

**Chunk index**:
The position of a Chunk in the Book's pronounceable stream. Minted once per Conversion; consumed by the TTS pool, the Chunk store, the Failure log, and the audio merge.
_Avoid_: sentence index.

**Chunk count**:
The number of Chunks in a Conversion. Upper bound of the Chunk index space.
_Avoid_: totalSentences.

**Gap**:
Deliberate silence inserted between chunks before the filter chain runs.

**Audio settings**:
The processing and encoding flags configured on the Audio tab, carried as one object from Conversion input into the audio merge.
_Avoid_: audio config, filter chain config

**Failure log**:
The file where permanently failed chunks are recorded.

**Review gate**:
The pause mid-Conversion where the user confirms or edits the draft Voice map. The draft lives in the gate; the store is written once on confirm.
_Avoid_: pendingReview, voice review modal state

**Resume gate**:
The pause asking whether to continue a previous Conversion from the Chunk store. Declining starts fresh; decline is an answer, not a cancellation.
_Avoid_: resumeInfo, resume modal state

### LLM passes

**Extract**:
The pass that lists the Characters appearing in a Block.

**Character merge**:
The vote-based pass that unifies Character identities across Blocks. Distinct from the audio merge stage.
_Avoid_: "merge" unqualified when Characters and audio are both in play

**Merge vote**:
One model response in Character merge, produced at its own temperature. Consensus needs two votes per pair.

**Culling**:
Dropping Characters with too few mentions before Character merge.

**Assign**:
The pass that maps Characters to Voices. Runs a draft, then a QA pass.

**QA pass**:
The correction pass over Assign's draft. On failure the draft stands.

### Characters and voices

**Character**:
A named speaker detected in a Book and given a Voice.
_Avoid_: entity, person

**Narrator**:
The default Voice. Non-character text uses it, and it covers sentences left unassigned when Assign is exhausted.

**Voice**:
An Edge TTS speech profile with a gender and a locale.
_Avoid_: speaker

**Voice allocation**:
Giving Voices to Characters: top speakers get distinct voices from the unique slice, the rest round-robin the shared tail.

**Unique slice**:
The first 80% of a gender pool, handed out once per Character.

**Shared tail**:
The remaining 20% of a gender pool, cycled and allowed to repeat.

**Reroll**:
Re-running allocation for a subset of Characters. Deterministic unless the pool order is shuffled.

**Priority tier**:
Native-versus-multilingual grouping of Voices for a locale. A shuffle never passes over a native voice for a multilingual one.

### Models

**Primary model**:
The user's chosen LLM for a stage.

**Backup model**:
The fallback LLM a stage uses after the Primary model exhausts its retries.

**Rate-limit gate**:
The process-global governor of provider concurrency.
_Avoid_: limiter, throttle

**Collapse**:
The gate dropping concurrency to 1 after a rate-limit hit.

**Cooldown**:
The parked wait until the provider deadline passes.

**Climb**:
Concurrency growing one slot per clean call, up to the configured ceiling.

### Storage

**Chunk store**:
The temporary work folder of a Conversion and everything in it. Chunks stream to disk there, and the Chunk store alone owns the folder's lifecycle; the Failure log and pipeline state are tenants inside it.
_Avoid_: work folder, temp dir

**Voice profile**:
A best-effort JSON sidecar in the Book output folder recording the allocation.
