# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Production build to dist/
npm run type-check   # TypeScript type checking
npm run preview      # Serve production build locally
```

## Architecture

A Preact + TypeScript web app that converts text files to MP3 audio using Microsoft Edge's TTS WebSocket API.

### Core Flow

1. **File Input** → `FileConverter` parses TXT/FB2/EPUB/ZIP files
2. **Text Processing** → `TextProcessor` applies dictionary replacements and splits into sentences
3. **TTS Conversion** → `TTSWorkerPool` manages concurrent `EdgeTTSService` WebSocket connections (up to 30 parallel)
4. **Audio Output** → `AudioMerger` combines MP3 chunks and saves/downloads

### Key Services (`src/services/`)

- **EdgeTTSService**: WebSocket client for Edge TTS API. Sends SSML via WebSocket, receives binary audio chunks, handles reconnection on failure.
- **TTSWorkerPool**: Queue-based worker pool with retry logic (3 retries, exponential backoff). Manages concurrent TTS requests.
- **TextProcessor**: Applies .lexx dictionary rules (regex and word-based), handles punctuation replacement, splits text into chunks.
- **FileConverter**: Converts FB2 (XML parser), EPUB (JSZip + NCX navigation), ZIP archives to plain text.
- **AudioMerger**: Concatenates MP3 chunks based on merge count setting, respects file boundaries.
- **SecureStorage**: Encrypts sensitive data (API keys) using Web Crypto API. Uses non-extractable AES-256 key stored in IndexedDB, making exported data useless on other machines/browsers.

### LLM Voice Assignment System

Optional feature for multi-voice audiobooks using LLM-based character detection:

- **TextBlockSplitter**: Splits text into sentences and blocks for LLM processing. Uses 16k token blocks for Pass 1, 8k for Pass 2.
- **LLMVoiceService**: Two-pass LLM system using OpenAI-compatible API:
  - Pass 1: Extracts characters from text (sequential processing, detects gender/name variations)
  - Pass 2: Assigns speakers to sentences (parallel, up to 20 concurrent requests)
  - Uses sparse output format with character codes (A-Z, 0-9, a-z) for ~95% token reduction
  - Infinite retry with exponential backoff (1s → 10min delays)
- **VoiceAssigner**: Assigns unique voices to characters based on detected gender, avoiding duplicates.
- **VoicePoolBuilder**: Builds voice pools filtered by locale/gender (ru-*, en-*, multilingual voices).

### State Management (`src/state/`)

Uses Preact Signals for reactive state.

**appState.ts**:
- Settings: `voice`, `rate`, `pitch`, `maxThreads`, `mergeFiles`
- Processing: `isProcessing`, `processedCount`, `totalCount`, `statusLines`
- Data: `dictionary`, `textContent`, `book`

**llmState.ts** (LLM voice assignment):
- Settings: `llmEnabled`, `llmApiKey`, `llmApiUrl`, `llmModel`
- Processing: `llmProcessingStatus`, `llmCurrentBlock`, `llmTotalBlocks`
- Data: `detectedCharacters`, `characterVoiceMap`

Settings persist to localStorage.

### Components Structure

- `VoiceSelector`: 340+ voices across 80+ locales (hardcoded in `voices.ts`)
- `SettingsPanel`: Rate/pitch/volume sliders, merge settings
- `FileHandlers`: File upload and .lexx dictionary upload
- `ConvertButton`: Triggers conversion via `useTTSConversion` hook

### useTTSConversion Hook

Main orchestration hook in `src/hooks/useTTSConversion.ts`:
1. Creates `TextProcessor` with current settings
2. Spawns `TTSWorkerPool` with callback handlers
3. Queues all sentence tasks
4. Merges audio on completion

## Build Configuration

- Webpack with ts-loader
- Production builds output to `/EdgeTTS/` path (for GitHub Pages)
- Path alias: `@/` maps to `src/`
- React/ReactDOM aliased to Preact

## Dictionary Format (.lexx files)

```
word=replacement           # Word boundary match
"exact"="replacement"      # Exact string match
regex"pattern"="replace"   # Regex pattern
```
