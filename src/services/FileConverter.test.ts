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

    it('extracts content without toc.ncx via OPF spine (EPUB 3)', async () => {
      const zip = new JSZip();

      zip.file('mimetype', 'application/epub+zip');
      zip.file(
        'META-INF/container.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      );
      zip.file(
        'OEBPS/content.opf',
        `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Regressor</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`,
      );
      zip.file(
        'OEBPS/nav.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Ch1</a></li><li><a href="chapter2.xhtml">Ch2</a></li></ol></nav></body>
</html>`,
      );
      zip.file(
        'OEBPS/chapter1.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>Chapter one content.</p></body>
</html>`,
      );
      zip.file(
        'OEBPS/chapter2.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>Chapter two content.</p></body>
</html>`,
      );

      const epubData = await zip.generateAsync({ type: 'arraybuffer' });
      const result = await convertEpubToTxt(epubData);

      expect(result).toContain('Chapter one content.');
      expect(result).toContain('Chapter two content.');
      // Reading order follows the spine, not the nav document or filename.
      expect(result.indexOf('Chapter one content.')).toBeLessThan(
        result.indexOf('Chapter two content.'),
      );
    });

    it('extracts content when both toc.ncx and OPF spine are missing', async () => {
      const zip = new JSZip();
      zip.file(
        'OEBPS/chapter2.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Second content.</p></body></html>`,
      );
      zip.file(
        'OEBPS/chapter10.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Tenth content.</p></body></html>`,
      );

      const epubData = await zip.generateAsync({ type: 'arraybuffer' });
      const result = await convertEpubToTxt(epubData);

      // Numeric-aware path order puts chapter2 before chapter10.
      expect(result).toContain('Second content.');
      expect(result).toContain('Tenth content.');
      expect(result.indexOf('Second content.')).toBeLessThan(result.indexOf('Tenth content.'));
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
    it('excludes the navigation document from the spine', async () => {
      const zip = new JSZip();

      zip.file('mimetype', 'application/epub+zip');
      zip.file(
        'META-INF/container.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      );
      zip.file(
        'OEBPS/content.opf',
        `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Regressor</dc:title>
  </metadata>
  <manifest>
    <item id="chaplist" href="chaplist.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chaplist"/>
    <itemref idref="ch1"/>
  </spine>
</package>`,
      );
      zip.file(
        'OEBPS/chaplist.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Chapter 1 - The Partner I</a></li></ol></nav></body>
</html>`,
      );
      zip.file(
        'OEBPS/chapter1.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>Chapter one content.</p></body>
</html>`,
      );

      const epubData = await zip.generateAsync({ type: 'arraybuffer' });
      const result = await convertEpubToTxt(epubData);

      expect(result).toContain('Chapter one content.');
      expect(result).not.toContain('Chapter 1 - The Partner I');
    });

    it('excludes a toc nav document in the fallback html sweep', async () => {
      // No container.xml / OPF: forces the htmlDocuments() last-resort sweep.
      const zip = new JSZip();
      zip.file(
        'OEBPS/nav.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Ch1</a></li></ol></nav></body>
</html>`,
      );
      zip.file(
        'OEBPS/chapter1.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>Chapter one content.</p></body>
</html>`,
      );

      const epubData = await zip.generateAsync({ type: 'arraybuffer' });
      const result = await convertEpubToTxt(epubData);

      expect(result).toContain('Chapter one content.');
      expect(result).not.toContain('Ch1');
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
