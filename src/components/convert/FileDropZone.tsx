import { useRef, useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { useData, useLogs } from '@/stores';
import { convertFileToTxt } from '@/services/FileConverter';

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
        const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
        sentenceIndex += sentences.length;
      }

      // Create a book with the original filenames
      const fullText = dataStore.textContent.value;
      const allSentences = fullText.split(/[.!?]+/).filter(s => s.trim().length > 0);
      dataStore.setBook({
        fileNames,
        allSentences,
        fullText,
      });
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
      const rules = text.split('\n').filter(line => line.trim() && !line.startsWith('#'));
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
        const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
        sentenceIndex += sentences.length;
      }

      // Create a book with the original filenames
      const fullText = dataStore.textContent.value;
      const allSentences = fullText.split(/[.!?]+/).filter(s => s.trim().length > 0);
      dataStore.setBook({
        fileNames,
        allSentences,
        fullText,
      });
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
          ${isDragging
            ? 'border-accent bg-accent/10'
            : 'border-border hover:border-gray-500'
          }`}
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
        <p className="text-xs text-gray-500 mt-1">
          TXT, FB2, EPUB, ZIP
        </p>
      </div>

      {/* Dictionary Upload */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => dictInputRef.current?.click()}
          className="flex-1 btn text-sm"
        >
          <span>📖</span>
          <Text id="files.dictionary">Dictionary</Text>
          {dictRulesCount > 0 && (
            <span className="text-accent">({dictRulesCount})</span>
          )}
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
