import { useRef, useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { convertFileToTxt } from '@/services/FileConverter';
import { useData, useLogs } from '@/stores';

// Extract unique 2-letter language codes from supported voices
const AVAILABLE_LOCALES = [
  'af',
  'am',
  'ar',
  'az',
  'bg',
  'bn',
  'bs',
  'ca',
  'cs',
  'cy',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fa',
  'fi',
  'fil',
  'fr',
  'ga',
  'gl',
  'gu',
  'he',
  'hi',
  'hr',
  'hu',
  'id',
  'is',
  'it',
  'iu',
  'ja',
  'jv',
  'ka',
  'kk',
  'km',
  'kn',
  'ko',
  'lo',
  'lt',
  'lv',
  'mk',
  'ml',
  'mn',
  'mr',
  'ms',
  'mt',
  'my',
  'nb',
  'ne',
  'nl',
  'pl',
  'ps',
  'pt',
  'ro',
  'ru',
  'si',
  'sk',
  'sl',
  'so',
  'sq',
  'sr',
  'su',
  'sv',
  'sw',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'ur',
  'uz',
  'vi',
  'zh',
  'zu',
];

function LanguageBadge() {
  const dataStore = useData();
  const lang = dataStore.detectedLanguage.value;
  const bookLoaded = dataStore.bookLoaded.value;
  const fileName = dataStore.loadedFileName.value;

  if (!bookLoaded || !lang) return null;

  return (
    <div className="flex items-center justify-between mt-3 px-2 py-1.5 bg-primary/50 rounded border border-border">
      <span className="text-xs text-gray-400 truncate mr-2 language-badge-filename">
        {fileName}
      </span>
      <select
        value={lang}
        onChange={(e) => {
          e.stopPropagation();
          dataStore.setDetectedLanguage((e.target as HTMLSelectElement).value);
        }}
        onClick={(e) => e.stopPropagation()}
        className="bg-primary border border-border rounded px-2 py-0.5 text-xs text-accent font-mono cursor-pointer"
      >
        {AVAILABLE_LOCALES.map((code) => (
          <option key={code} value={code}>
            {code.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FileDropZone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const dictInputRef = useRef<HTMLInputElement>(null);
  const dataStore = useData();
  const logs = useLogs();
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    try {
      // Clear previous language detection
      dataStore.clearDetectedLanguage();

      const allConverted: Array<{ filename: string; content: string }> = [];

      for (const file of Array.from(files)) {
        const converted = await convertFileToTxt(file);
        allConverted.push(...converted);

        for (const { content } of converted) {
          const currentText = dataStore.textContent.value;
          dataStore.setTextContent(currentText + (currentText ? '\n\n' : '') + content);
        }

        if (converted.length === 1) {
          logs.info(`Loaded: ${file.name}`);
        } else {
          logs.info(`Loaded: ${file.name} (${converted.length} files)`);
        }
      }

      // Build fileNames array with sentence boundaries
      const fileNames: Array<[string, number]> = [];
      let sentenceIndex = 0;
      for (const { filename, content } of allConverted) {
        fileNames.push([filename, sentenceIndex]);
        // Estimate sentence count by splitting on sentence-ending punctuation
        const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
        sentenceIndex += sentences.length;
      }

      // Create a book with the original filenames
      const fullText = dataStore.textContent.value;
      const allSentences = fullText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
      dataStore.setBook({
        fileNames,
        allSentences,
        fullText,
      });

      // Detect language from loaded content
      const result = dataStore.detectLanguageFromContent();

      // Store the display filename
      const displayName =
        files.length === 1
          ? (files[0] as File).name
          : `${(files[0] as File).name} (+${files.length - 1})`;
      dataStore.setLoadedFileName(displayName);

      // Log if detection was uncertain
      if (result.confidence === 'low') {
        logs.warn(`Could not reliably detect book language, falling back to EN`);
      } else {
        logs.info(`Detected book language: ${result.language.toUpperCase()}`);
      }
    } catch (err) {
      logs.error(`Error loading file: ${(err as Error).message}`);
    }

    input.value = '';
  };

  const handleDictChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const rules = text.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
      dataStore.setDictionaryRaw(rules);
      logs.info(`Loaded dictionary: ${file.name} (${rules.length} rules)`);
    } catch (err) {
      logs.error(`Error loading dictionary: ${(err as Error).message}`);
    }

    input.value = '';
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    try {
      // Clear previous language detection
      dataStore.clearDetectedLanguage();

      const allConverted: Array<{ filename: string; content: string }> = [];

      for (const file of Array.from(files)) {
        const converted = await convertFileToTxt(file);
        allConverted.push(...converted);

        for (const { content } of converted) {
          const currentText = dataStore.textContent.value;
          dataStore.setTextContent(currentText + (currentText ? '\n\n' : '') + content);
        }

        logs.info(`Loaded: ${file.name}`);
      }

      // Build fileNames array with sentence boundaries
      const fileNames: Array<[string, number]> = [];
      let sentenceIndex = 0;
      for (const { filename, content } of allConverted) {
        fileNames.push([filename, sentenceIndex]);
        // Estimate sentence count by splitting on sentence-ending punctuation
        const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
        sentenceIndex += sentences.length;
      }

      // Create a book with the original filenames
      const fullText = dataStore.textContent.value;
      const allSentences = fullText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
      dataStore.setBook({
        fileNames,
        allSentences,
        fullText,
      });

      // Detect language from loaded content
      const result = dataStore.detectLanguageFromContent();

      // Store the display filename
      const displayName =
        files.length === 1 ? files[0].name : `${files[0].name} (+${files.length - 1})`;
      dataStore.setLoadedFileName(displayName);

      // Log if detection was uncertain
      if (result.confidence === 'low') {
        logs.warn(`Could not reliably detect book language, falling back to EN`);
      } else {
        logs.info(`Detected book language: ${result.language.toUpperCase()}`);
      }
    } catch (err) {
      logs.error(`Error loading file: ${(err as Error).message}`);
    }
  };

  const dictRulesCount = dataStore.dictionaryRaw.value.length;

  return (
    <div className="space-y-3">
      {/* File Drop Zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
          ${isDragging ? 'border-accent bg-accent/10' : 'border-border hover:border-gray-500'}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.fb2,.epub,.ini,.zip"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="text-3xl mb-2">📄</div>
        <p className="text-sm text-gray-400">
          <Text id="files.dropzone">Drop files here or click to upload</Text>
        </p>
        <p className="text-xs text-gray-500 mt-1">TXT, FB2, EPUB, ZIP</p>
      </div>

      {/* Language Badge - shown after book loaded */}
      <LanguageBadge />

      {/* Dictionary Upload */}
      <div className="flex items-center gap-2">
        <button onClick={() => dictInputRef.current?.click()} className="flex-1 btn text-sm">
          <span>📖</span>
          <Text id="files.dictionary">Dictionary</Text>
          {dictRulesCount > 0 && <span className="text-accent">({dictRulesCount})</span>}
        </button>
        <input
          ref={dictInputRef}
          type="file"
          accept=".lexx,.txt"
          onChange={handleDictChange}
          className="hidden"
        />
      </div>
    </div>
  );
}
