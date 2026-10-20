Deployed url is https://vadash.github.io/EdgeTTS/

# Edge TTS Web

A web-based Text-to-Speech converter using Microsoft Edge's TTS service. Converts text files (TXT, FB2, EPUB, ZIP) to audio files.

Example (03/10/2026) https://vocaroo.com/1dizBwJTKZRs

I like to use 1.0 speed generation then 1.20..1.35 speed in audioplayer

# How

The app assigns speakers per sentence, not paragraph. Here's the breakdown:

Text Processing Hierarchy

TextBlockSplitter (`src/services/TextBlockSplitter.ts`):

1. Paragraph split → split on newlines
2. Sentence split → the platform's native segmenter (Intl.Segmenter)
3. Block grouping → sentences organized into scene-sized Blocks for the LLM passes; token limits come from the central config (`extractBlockTokens`, `assignBlockTokens`)

LLM Passes (`src/services/llm/stages.ts`):

1. Extract → lists the Characters appearing in each Block
2. Character merge → concurrent votes at distinct temperatures unify Character identities across Blocks
3. Assign → maps sentences to Character codes; a draft pass, plus a QA correction pass when voting is on
- Sentences are sent 0-based numbered: [0] First sentence\n[1] Second sentence\n...
- The LLM returns a speaker code per sentence → SpeakerAssignment[]:
{
sentenceIndex: number;    // Global sentence number
text: string;             // Sentence text
speaker: string;          // Character code
voiceId: string;          // Assigned voice
}

Speech Detection

Non-dialogue sentences (no quotes/apostrophes) → Narrator voice automatically

Voice Allocation

Voice allocation is gender-routed: top Characters by line count get unique voices from the first 80% of their gender pool; the rest round-robin the remaining 20% (repeats allowed). A reroll keeps the same voices unless the pool order is shuffled.

So: sentence-level assignment, Block-level grouping for LLM efficiency.

## Weak and free models

The pipeline already degrades gracefully (Backup model, halved Blocks, Narrator fallback), but model choice still matters:

- Pick models that honor OpenAI-style structured output (`json_schema`). A model that ignores it answers in prose, and every parse tier will fail.
- Keep Temperature at 0.3 or below for the Extract, Merge, and Assign stages. Weak models at temperature 1 tend to stream chain-of-thought instead of JSON.
- Prefer the text-only variant when a provider offers one next to a vision-language variant; this pipeline is text-only.
