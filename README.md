# Edge TTS Web

A web-based Text-to-Speech converter using Microsoft Edge's TTS service. Converts text files (TXT, FB2, EPUB, ZIP) to audio files.

Example (15/02/2026) https://vocaroo.com/148irkR9sV8w

I like to use 1.0 speed generation then 1.20..1.35 speed in audioplayer

# How

The app assigns speakers per sentence, not paragraph. Here's the breakdown:

Text Processing Hierarchy

TextBlockSplitter (C:\projects\EdgeTTS\src\services\TextBlockSplitter.ts):

1. Paragraph split → Split on newlines
2. Sentence split → Large paragraphs (>3000 chars) split on .!?… delimiters
3. Block grouping → Sentences organized into blocks for LLM:
- Extract blocks: max 16K tokens
- Assign blocks: max 8K tokens

Speaker Assignment Step

SpeakerAssignmentStep (C:\projects\EdgeTTS\src\services\pipeline\steps\SpeakerAssignmentStep.ts):

- Creates assign blocks (8K token limit)
- Calls LLM with 0-based numbered sentences: [0] First sentence\n[1] Second sentence\n...
- LLM returns speaker code for each sentence
- Output: SpeakerAssignment[] with:
{
sentenceIndex: number;    // Global sentence number
text: string;             // Sentence text
speaker: string;          // Character code (A-Z, 0-9, a-z)
voiceId: string;          // Assigned voice
}

Speech Detection

Non-dialogue sentences (no quotes/apostrophes) → Narrator voice automatically

Voice Optimization

VoiceRemappingStep then optimizes voice assignments by frequency:
- Top N characters speaking most → Get unique voices
- Rare speakers → Share generic voices (male/female/unknown)

So: Sentence-level assignment, paragraph+block-level grouping for LLM efficiency.
