## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at http://localhost:3000
npm run type-check   # TypeScript type checking
npm run test         # Run all tests once (Vitest)
```

## Architecture

A Preact + TypeScript web app that converts text files to MP3 audio using Microsoft Edge's TTS WebSocket API.

### Core Flow

1. **File Input** → `FileConverter` parses TXT/FB2/EPUB/ZIP files
2. **Pipeline** → `ConversionOrchestrator` runs 10 discrete pipeline steps:
   - Extract (LLM character detection)
   - Merge (LLM character deduplication)
   - Voice Assignment
   - Voice Remapping
   - Assign (LLM speaker assignment)   
   - Text Sanitization
   - Dictionary Processing
   - TTS Conversion (parallel WebSocket connections)
   - Audio Merge
   - Save
3. **Audio Output** → `AudioMerger` combines MP3 chunks and saves/downloads

### Pipeline Architecture (`src/services/pipeline/`)

The conversion pipeline uses composable steps:
- **PipelineRunner**: Executes steps in sequence with progress tracking and cancellation
- **PipelineContext**: Immutable context passed between steps (text, characters, voiceMap, audioMap, etc.)
- **BasePipelineStep**: Abstract base with progress reporting and cancellation helpers
- Each step is independently testable via factory injection

### Key Services (`src/services/`)

- **ConversionOrchestrator**: Builds and runs the pipeline, handles progress updates to stores
- **EdgeTTSService**: WebSocket client for Edge TTS API. Sends SSML via WebSocket, receives binary audio chunks, handles reconnection on failure.
- **TTSWorkerPool**: Queue-based worker pool with retry logic (3 retries, exponential backoff). Manages concurrent TTS requests.
- **FileConverter**: Converts FB2 (XML parser), EPUB (JSZip + NCX navigation), ZIP archives to plain text.
- **AudioMerger**: Merges audio by ~30min duration, supports Opus encoding via FFmpeg.
- **FFmpegService**: Singleton for FFmpeg WASM loading from CDN (jsdelivr/unpkg/cdnjs fallback). Handles Opus encoding, silence removal, and normalization.
- **SecureStorage**: Encrypts sensitive data (API keys) using Web Crypto API. Uses non-extractable AES-256 key stored in IndexedDB, making exported data useless on other machines/browsers.

### LLM Voice Assignment System

Optional feature for multi-voice audiobooks using LLM-based character detection:

- **TextBlockSplitter**: Splits text into paragraphs and blocks for LLM processing. Uses 16k token blocks for extract, 8k for assign. Large paragraphs (>3000 chars) are split by sentence boundaries.
- **LLMVoiceService** (`src/services/llm/`): Three-pass LLM system using OpenAI-compatible API:
  - **Extract**: Extracts characters from text blocks (sequential processing, detects gender/name variations)
  - **Merge**: Deduplicates characters across blocks using LLM (identifies same person with different names)
  - **Assign**: Assigns speakers to paragraphs (parallel, up to 20 concurrent). Uses 0-based relative indexing per block (0, 1, 2...) instead of absolute indices to improve LLM accuracy. Paragraphs without speech symbols are auto-assigned to narrator, skipping LLM call.
  - Uses sparse output format with character codes (A-Z, 0-9, a-z) for token reduction
  - Infinite retry with exponential backoff
  - Logs requests/responses to: `logs/extract_*.json`, `logs/merge_*.json`, `logs/assign_*.json`
- **SPEECH_SYMBOLS_REGEX**: Regex matching dialogue symbols (" « » ‹ › — " " „ ' ' ') used to detect paragraphs with speech.
- **VoiceAssigner**: Assigns unique voices to characters based on detected gender, avoiding duplicates.
- **VoicePoolBuilder**: Builds voice pools filtered by locale/gender (ru-*, en-*, multilingual voices).

### State Management (`src/stores/`)

Modern state management using Preact Signals with typed stores:

- **SettingsStore**: Voice settings (voice, rate, pitch, maxThreads), output format (MP3/Opus), audio processing toggles (silence removal, normalization)
- **ConversionStore**: Conversion progress (isProcessing, processedCount, totalCount), status lines, save path handle
- **DataStore**: Dictionary, text content, book metadata
- **LLMStore**: LLM settings (enabled, API key, URL, model), processing status, detected characters, voice mappings
- **LogStore**: Centralized logging service. Stores info/warn/error logs with color-coded display (gray/yellow/red). Debug logs go to browser console only (F12).
- **LanguageStore**: UI language preferences

Settings persist to localStorage.

### UI Architecture

**Styling**: Tailwind CSS v3 with custom dark theme colors defined in `tailwind.config.js`

**Routing**: Hash-based routing (`#/`, `#/settings`, `#/logs`) for GitHub Pages compatibility
- `src/router/` - Router component and useRoute hook

**Layout**:
- Desktop: Header navigation + side-by-side text editor/status panel
- Mobile (<768px): Bottom tab navigation with separate logs view

### Components Structure (`src/components/`)

```
components/
├── common/           # Reusable UI primitives
│   ├── Button.tsx    # Button with variants (primary, default) and sizes
│   ├── Input.tsx     # Text input with label
│   ├── Select.tsx    # Dropdown select
│   ├── Toggle.tsx    # Switch toggle
│   ├── Slider.tsx    # Range slider with label
│   ├── Tabs.tsx      # Tab container and TabPanel
│   └── Card.tsx      # Card container
│
├── layout/           # App shell components
│   ├── AppShell.tsx  # Main layout wrapper
│   ├── Header.tsx    # Top navigation (desktop)
│   └── BottomNav.tsx # Bottom navigation (mobile)
│
├── convert/          # Convert view components
│   ├── ConvertView.tsx     # Main convert page layout
│   ├── FileDropZone.tsx    # Drag-and-drop file upload
│   ├── TextEditor.tsx      # Main text textarea
│   ├── QuickVoiceSelect.tsx # Voice selector with preview
│   └── ConvertButton.tsx   # Conversion trigger button
│
├── settings/         # Settings view with tabbed interface
│   ├── SettingsView.tsx    # Settings page with tabs
│   └── tabs/
│       ├── GeneralTab.tsx      # Language, speed, pitch, threads
│       ├── VoicePoolTab.tsx    # Enable/disable voices
│       ├── LLMTab.tsx          # LLM API configuration
│       ├── AudioTab.tsx        # Output format, silence removal
│       ├── DictionaryTab.tsx   # Dictionary upload and rules
│       └── ExportImportTab.tsx # Settings backup/restore
│
├── status/           # Status/logs components
│   ├── StatusPanel.tsx   # Color-coded log display (info=gray, warn=yellow, error=red)
│   ├── StatusView.tsx    # Full-page logs (mobile)
│   └── ProgressBar.tsx   # Progress indicator
│
└── VoiceSelector/    # Voice data
    └── voices.ts     # Hardcoded Microsoft Edge voices list
```

### useTTSConversion Hook

Main hook in `src/hooks/useTTSConversion.ts`:
- Creates `ConversionOrchestrator` instance per conversion
- Provides startConversion, cancel, and selectDirectory methods
- Exposes isProcessing and progress state

### Configuration (`src/config/`)

Centralized configuration system with type-safe defaults:
- **TTS Config**: Worker limits, retry strategies, rate limits
- **Audio Config**: Processing parameters, FFmpeg settings, silence removal thresholds
- **LLM Config**: Token limits, concurrency settings, retry delays
- **FFmpeg Config**: WASM version, CDN mirrors
- **EdgeTTS API Config**: WebSocket URLs, authentication tokens
- **Text Processing Config**: Chunk sizes, default thread counts

### Dependency Injection (`src/di/`)

Lightweight DI container for service management:
- **ServiceContainer**: Registers and resolves service dependencies
- **ServiceContext**: React context provider for accessing services in components
- **ServiceLifecycle**: Manages singleton services (FFmpeg, logging)

### Audio Processing (FFmpeg)

- **Format**: Opus or MP3 fallback
- **Merge**: Duration-based, respects file boundaries
- **Silence removal**
- **Normalization**
- **CDN loading**

## Testing

The project uses **Vitest** as the test runner with **jsdom** environment for DOM testing.

### Test Setup (`src/test/setup.ts`)

Comprehensive test environment with mocked browser APIs:
- **localStorage/IndexedDB**: Full mock implementation for storage testing
- **WebSocket**: Mocked WebSocket class for TTS service testing
- **Audio API**: Mocked Audio class and audio-related APIs
- **Browser APIs**: Mocked ResizeObserver, IntersectionObserver, clipboard APIs
- **File APIs**: Mocked URL.createObjectURL/revokeObjectURL for blob handling

### Test Configuration (`vitest.config.ts`)

- **Environment**: jsdom with Preact aliases (react/preact → preact/compat)
- **Path Resolution**: `@/` alias maps to `src/`
- **Coverage**: V8 provider with text, HTML, and LCOV reporters
- **Test Files**: `src/**/*.test.ts` and `src/**/*.test.tsx`
- **Exclusions**: Test files, setup files, and entry point excluded from coverage

### Testing Dependencies

- **@testing-library/preact**: Preact testing utilities
- **jsdom**: DOM environment for testing
- **@vitest/coverage-v8**: Coverage reporting

## TypeScript Configuration

- **Target**: ES2020 with ESNext modules
- **JSX**: React JSX with Preact as import source
- **Strict Mode**: Enabled with all strict type checking options
- **Path Aliases**: `@/*` maps to `src/*`
- **Output**: Declarations and source maps to `dist/`
- **Module Resolution**: Node with ES2021 lib support
- **Test Exclusions**: `*.test.ts`, `*.test.tsx`, `src/test/**/*` excluded from main build

## Build Configuration

- Webpack with ts-loader and postcss-loader (for Tailwind)
- Production builds output to `/EdgeTTS/` path (for GitHub Pages)
- Path alias: `@/` maps to `src/`
- React/ReactDOM aliased to Preact

## Dictionary Format (.lexx files)

```
word=replacement           # Word boundary match
"exact"="replacement"      # Exact string match
regex"pattern"="replace"   # Regex pattern
```

## Key File Structure

```
src/
├── config/          # Centralized configuration
├── di/              # Dependency injection system
├── services/        # Business logic and API clients
│   └── pipeline/    # Pipeline runner and steps
├── stores/          # Preact Signals state management
├── hooks/           # React hooks
├── components/      # Preact UI components (see Components Structure above)
├── router/          # Hash-based routing
├── styles/          # Tailwind CSS entry point
├── i18n/            # Internationalization (en.json, ru.json)
├── state/types.ts   # Shared TypeScript types
├── utils/           # Utility functions
├── errors/          # Error handling
└── test/            # Test utilities and factories
```

## Styling

Tailwind CSS v3 with custom configuration:
- **Dark theme**: Custom colors (primary, accent, border)
- **Component classes**: `.btn`, `.input-field`, `.select-field`, `.toggle`, `.card`, `.tabs-list`, `.tab-trigger`
- **Config**: `tailwind.config.js` with extended theme
- **PostCSS**: `postcss.config.js` with tailwindcss and autoprefixer

## Multiple builds

New structure:
dist/
├── index.html      ← version picker
├── latest/         ← current build
└── v1/             ← stable v1

Commands:
npm run build              # builds to dist/latest/
npm run build:version v1   # builds to dist/v1/
npm run build:version v2   # builds to dist/v2/

Each build:version automatically adds/updates the entry in dist/index.html.

## CRITICAL

1. USE bash commands for Windows!
2. NO FALLBACKS! If you want to add one ask user first.
