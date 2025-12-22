# Changelog

## 22/12/25

1) New feature: Voice Review & Export/Import

2) One more rewrite for character merging

3) Refactor to battle-tested libraries: p-retry, p-queue, generic-pool

## 20/12/25

1) Add max retry limit with fallback for LLM assign step

2) Add hierarchical chunked merge for large character lists

## 08/12/25

LLM settings menu improved. Handles thinking/no thinking. 
Improved LLM response parsing.
Edge TTS is much faster now.
You can pick older version now.
Added optional DeEss. 

## 04/12/25

### LLM Voice Assignment System
- **Character Detection**: AI-powered extraction of characters from text
- **Character Merging**: Deduplicates same characters with different names (e.g., "John" and "Mr. Smith")
- **Multi-Voice Audiobooks**: Each character automatically assigned a unique voice
- **Gender Detection**: Male/female voice assignment based on character analysis
- **Sparse Output Format**: 95% token reduction using character codes (A-Z, 0-9, a-z)
- **Free LLM Support**: Works with Google Gemini, OpenRouter, and 15+ free providers
- **Thinking Tag Removal**: Handles `<think>` tags from reasoning models

### Audio Processing (FFmpeg)
- **FFmpeg Integration**: WASM-based audio processing
- **Opus Format**: Better quality at smaller file sizes
- **Silence Removal**: Removes long pauses from audio
- **Audio Normalization**: Balanced audio levels
- **CDN Fallback**: Automatic fallback between jsdelivr, unpkg, cdnjs

### Pipeline Architecture
- **Composable Steps**: Modular pipeline with discrete stages
- **Progress Tracking**: Real-time status and ETA display
- **Cancellation Support**: Stop conversion at any time
- **Retry Logic**: Exponential backoff for failed requests

### Security
- **Encrypted API Keys**: AES-256 encryption using Web Crypto API
- **Non-Extractable Keys**: IndexedDB storage, data useless on other machines
- **Settings Export**: API keys excluded from exports

### User Experience
- **Internationalization**: English and Russian language support
- **Responsive Design**: Mobile-friendly with bottom navigation
- **Keep Awake**: Prevents screen sleep during conversion
- **Close Warning**: Confirmation dialog when closing during conversion
- **Dictionary Support**: .lexx files for custom pronunciations
- **Settings Export/Import**: Backup and restore configuration

### Voice Pool
- **94 Microsoft Voices**: Full Edge TTS voice catalog
- **Voice Preview**: Test voices with custom sample text
- **Voice Filtering**: Enable/disable voices by preference
- **Language Detection**: Auto-detect text language for voice selection

### File Support
- **TXT**: Plain text files
- **FB2**: FictionBook format (XML parser)
- **EPUB**: E-book format (JSZip + NCX navigation)
- **ZIP**: Archive containing multiple files
- **Drag & Drop**: Simple file upload interface

### Technical Improvements
- **Preact + TypeScript**: Modern reactive architecture
- **Signals State Management**: Efficient reactive stores
- **Worker Pool**: Queue-based parallel TTS requests
- **WebSocket Client**: Direct Edge TTS API connection
- **Dependency Injection**: Clean service architecture
- **Comprehensive Testing**: Vitest with jsdom environment

---

## [Initial Release]

Basic TTS functionality with single voice output.

https://edgetts.github.io/ <3
