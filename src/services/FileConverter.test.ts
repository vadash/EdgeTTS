import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  convertEpubToTxt,
  convertFb2ToTxt,
  convertFileToTxt,
  convertZipToTxt,
} from './FileConverter';

describe('FileConverter', () => {
  describe('convertFb2ToTxt', () => {
    it('extracts text from FB2 sections', () => {
      const fb2Content = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook>
  <body>
    <section>
      <p>First paragraph.</p>
      <p>Second paragraph.</p>
    </section>
    <section>
      <p>Third paragraph.</p>
    </section>
  </body>
</FictionBook>`;

      const result = convertFb2ToTxt(fb2Content);

      expect(result).toContain('First paragraph.');
      expect(result).toContain('Second paragraph.');
      expect(result).toContain('Third paragraph.');
    });

    it('handles missing body gracefully', () => {
      const fb2Content = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook>
  <description>No body here</description>
</FictionBook>`;

      const result = convertFb2ToTxt(fb2Content);

      expect(result).toBe('');
    });

    it('handles empty sections', () => {
      const fb2Content = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook>
  <body>
    <section></section>
    <section>
      <p>Content.</p>
    </section>
  </body>
</FictionBook>`;

      const result = convertFb2ToTxt(fb2Content);

      expect(result).toContain('Content.');
    });
  });

  describe('convertEpubToTxt', () => {
    it('extracts text from EPUB via toc.ncx', async () => {
      const zip = new JSZip();

      // Add toc.ncx
      zip.file(
        'OEBPS/toc.ncx',
        `<?xml version="1.0" encoding="UTF-8"?>
<ncx>
  <navMap>
    <navPoint>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`,
      );

      // Add chapter content
      zip.file(
        'OEBPS/chapter1.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <p>Chapter one content.</p>
  </body>
</html>`,
      );

      const epubData = await zip.generateAsync({ type: 'arraybuffer' });
      const result = await convertEpubToTxt(epubData);

      expect(result).toContain('Chapter one content.');
    });

    it('throws when toc.ncx missing', async () => {
      const zip = new JSZip();
      zip.file('OEBPS/content.xhtml', '<html><body>Content</body></html>');

      const epubData = await zip.generateAsync({ type: 'arraybuffer' });

      await expect(convertEpubToTxt(epubData)).rejects.toThrow('Could not find toc.ncx in EPUB');
    });

    it('handles multiple chapters', async () => {
      const zip = new JSZip();

      zip.file(
        'OEBPS/toc.ncx',
        `<?xml version="1.0" encoding="UTF-8"?>
<ncx>
  <navMap>
    <navPoint>
      <content src="ch1.xhtml"/>
    </navPoint>
    <navPoint>
      <content src="ch2.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`,
      );

      zip.file(
        'OEBPS/ch1.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>Chapter 1</p></body>
</html>`,
      );

      zip.file(
        'OEBPS/ch2.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>Chapter 2</p></body>
</html>`,
      );

      const epubData = await zip.generateAsync({ type: 'arraybuffer' });
      const result = await convertEpubToTxt(epubData);

      expect(result).toContain('Chapter 1');
      expect(result).toContain('Chapter 2');
    });
  });

  describe('convertZipToTxt', () => {
    it('processes TXT files in ZIP', async () => {
      const zip = new JSZip();
      zip.file('book1.txt', 'Content of book one.');
      zip.file('book2.txt', 'Content of book two.');

      const zipData = await zip.generateAsync({ type: 'arraybuffer' });
      const results = await convertZipToTxt(zipData);

      expect(results).toHaveLength(2);
      expect(results.find((r) => r.filename === 'book1')?.content).toBe('Content of book one.');
      expect(results.find((r) => r.filename === 'book2')?.content).toBe('Content of book two.');
    });

    it('processes FB2 files in ZIP', async () => {
      const zip = new JSZip();
      zip.file(
        'book.fb2',
        `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook>
  <body>
    <section><p>FB2 content.</p></section>
  </body>
</FictionBook>`,
      );

      const zipData = await zip.generateAsync({ type: 'arraybuffer' });
      const results = await convertZipToTxt(zipData);

      expect(results).toHaveLength(1);
      expect(results[0].filename).toBe('book');
      expect(results[0].content).toContain('FB2 content.');
    });

    it('ignores unsupported file types', async () => {
      const zip = new JSZip();
      zip.file('image.jpg', 'fake image data');
      zip.file('book.txt', 'Text content.');

      const zipData = await zip.generateAsync({ type: 'arraybuffer' });
      const results = await convertZipToTxt(zipData);

      expect(results).toHaveLength(1);
      expect(results[0].filename).toBe('book');
    });
  });

  describe('convertFileToTxt', () => {
    // Helper to create a File-like object with text() method
    const createMockFile = (content: string, name: string): File => {
      const blob = new Blob([content], { type: 'text/plain' });
      const file = new File([blob], name);
      // Add text() method since jsdom File doesn't have it
      (file as unknown as { text: () => Promise<string> }).text = () => Promise.resolve(content);
      return file;
    };

    it('routes TXT files correctly', async () => {
      const file = createMockFile('Plain text content.', 'test.txt');
      const results = await convertFileToTxt(file);

      expect(results).toHaveLength(1);
      expect(results[0].filename).toBe('test');
      expect(results[0].content).toBe('Plain text content.');
    });

    it('routes INI files as text', async () => {
      const file = createMockFile('[section]\nkey=value', 'config.ini');
      const results = await convertFileToTxt(file);

      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('[section]');
    });

    it('routes FB2 files correctly', async () => {
      const fb2Content = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook>
  <body>
    <section><p>FB2 text.</p></section>
  </body>
</FictionBook>`;
      const file = createMockFile(fb2Content, 'book.fb2');
      const results = await convertFileToTxt(file);

      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('FB2 text.');
    });

    it('handles unknown file types as text', async () => {
      const file = createMockFile('Unknown format content.', 'file.unknown');
      const results = await convertFileToTxt(file);

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Unknown format content.');
    });
  });
});
