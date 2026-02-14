# Edge TTS Web

Convert text files to high-quality audiobooks using Microsoft Edge's TTS engine — entirely in your browser.

---

## What It Does

Upload a book (TXT, FB2, EPUB, or ZIP) and get back an MP3 or Opus audio file. For fiction, an LLM detects characters and assigns each one a unique voice — producing multi-voice audiobooks automatically.

**Example output:** [Sample (Opus)](https://files.catbox.moe/x6boa8.opus)

---

## Features

| | |
|---|---|
| **Multi-Format Input** | TXT, FB2, EPUB, ZIP archives |
| **Audio Output** | MP3 or Opus with configurable bitrate |
| **Multi-Voice** | LLM-powered character detection and voice assignment |
| **Gender-Aware** | Male/female voices matched to detected characters |
| **Parallel Processing** | Multi-threaded TTS conversion |
| **Audio Processing** | Silence removal & normalization via FFmpeg |
| **Dictionary Support** | Custom pronunciation rules (.lexx files) |
| **Drag & Drop** | Simple file upload or paste text directly |
| **Progress Tracking** | Real-time status with ETA |
| **Settings Backup** | Export/import your configuration |

---

## How It Works

1. **Text Splitting** — Input is split into paragraphs, then sentences, then grouped into blocks for efficient LLM processing
2. **Character Extraction** — LLM identifies characters and their genders from the text
3. **Speaker Assignment** — Each sentence gets assigned to a character (dialogue) or narrator (non-dialogue)
4. **Voice Mapping** — Top characters get unique voices; rare speakers share generic voices by gender
5. **TTS Conversion** — Sentences are sent to Edge TTS via WebSocket in parallel
6. **Audio Merge** — FFmpeg combines chunks into a single MP3/Opus file

---

## Quick Start

1. **Upload** — Drop a file or paste text
2. **Configure** — Pick voice, speed, pitch in Settings
3. **Enable LLM** *(optional)* — For multi-voice books, add an API key in Settings → LLM
4. **Convert** — Click "Save to MP3" and pick an output folder

---

## LLM Setup

For multi-voice audiobooks, you need an OpenAI-compatible API:

- **Google Gemini** — free tier available
- **OpenRouter** — many free models
- **Any OpenAI-compatible provider**

Go to **Settings → LLM** → enable "LLM Voice Assignment" → enter API URL and key.

See the **?** button in LLM settings for detailed provider options.

---

## Tech Stack

- **UI:** Preact + TypeScript + Tailwind CSS
- **TTS:** Microsoft Edge WebSocket API
- **Audio:** FFmpeg WASM
- **LLM:** OpenAI-compatible API
- **Storage:** IndexedDB + File System Access API
- **State:** @preact/signals
- **Build:** Vite

---

*Everything runs locally in your browser. No server, no uploads, no tracking.*
