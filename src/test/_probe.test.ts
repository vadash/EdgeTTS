import { describe, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertEpubToTxt } from '@/services/FileConverter';
import { TextBlockSplitter } from '@/services/TextBlockSplitter';
import { detectLanguage } from '@/utils/languageDetection';
import { assignSpeakersHeuristic } from '@/services/HeuristicSpeakerService';

describe('probe', () => {
  it('traces', async () => {
    const buf = readFileSync(join('test-books', 'Sublight_Drive.epub'));
    const text = await convertEpubToTxt(new Uint8Array(buf).buffer as ArrayBuffer);
    const { language } = detectLanguage(text);
    const { sentences, paragraphIds } = new TextBlockSplitter().splitIntoParagraphsDetailed(
      text,
      language,
    );
    const { assignments, characters } = await assignSpeakersHeuristic(
      sentences,
      language,
      paragraphIds,
    );
    const targets = [842, 1930];
    let out = '';
    const byC = new Map(characters.map((c) => [c.canonicalName, c]));
    out += `REGISTERED: ${characters.map((c) => `${c.canonicalName}[${c.gender}]`).join(', ')}\n\n`;
    for (const i of targets) {
      out += `--- idx ${i} ---\n`;
      for (let j = i - 10; j <= Math.min(sentences.length - 1, i + 1); j++) {
        out += `  [${j}] p=${paragraphIds[j]} sp=${assignments[j].speaker}  ${sentences[j].slice(0, 100)}\n`;
      }
    }
    writeFileSync('logs/_probe.txt', out);
  }, 600_000);
});
