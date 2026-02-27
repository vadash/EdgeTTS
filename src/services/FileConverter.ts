// FileConverter Service - File format converters (FB2, EPUB, ZIP)
// Migrated from texts_converter.js

import JSZip from 'jszip';
import type { ConvertedFile } from '../state/types';

/**
 * Convert FB2 (FictionBook) format to plain text
 */
export function convertFb2ToTxt(fb2String: string): string {
  const parser = new DOMParser();
  const fb2Doc = parser.parseFromString(fb2String.replace(/<p>/g, '\n<p>'), 'application/xml');

  let textContent = '';
  const bodyNode = fb2Doc.getElementsByTagName('body')[0];

  if (bodyNode) {
    const sectionNodes = bodyNode.getElementsByTagName('section');
    for (let i = 0; i < sectionNodes.length; i++) {
      const sectionNode = sectionNodes[i];
      const sectionText = sectionNode.textContent;
      textContent += `${sectionText}\n\n`;
    }
  }

  return textContent.trim();
}

/**
 * Convert EPUB format to plain text
 */
export async function convertEpubToTxt(epubBinary: ArrayBuffer | Blob | File): Promise<string> {
  const zip = await JSZip.loadAsync(epubBinary);
  const textFiles: JSZip.JSZipObject[] = [];
  let tocPath = '';

  // Find TOC path
  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.name.endsWith('.ncx')) {
      tocPath = relativePath.slice(0, relativePath.lastIndexOf('toc.ncx'));
    }
  });

  // Parse TOC
  const tocFile = zip.file(`${tocPath}toc.ncx`);
  if (!tocFile) {
    throw new Error('Could not find toc.ncx in EPUB');
  }

  const toc = await tocFile.async('text');
  const parser = new DOMParser();
  const tocDoc = parser.parseFromString(toc, 'application/xml');
  const navPoints = tocDoc.getElementsByTagName('navPoint');

  for (let i = 0; i < navPoints.length; i++) {
    const contentElement = navPoints[i].getElementsByTagName('content')[0];
    const srcAttr = contentElement?.getAttribute('src');
    if (srcAttr) {
      const src = tocPath + srcAttr.split('#')[0];
      const file = zip.file(src);
      if (file) {
        textFiles.push(file);
      }
    }
  }

  // Extract text from HTML files
  let textContent = '';
  for (const file of textFiles) {
    const fileText = await file.async('text');
    const htmlDoc = parser.parseFromString(fileText, 'application/xhtml+xml');
    const bodyNode = htmlDoc.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'body')[0];

    if (bodyNode) {
      const textNodes = bodyNode.childNodes;
      for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes[i];
        if (node.textContent?.trim() !== '') {
          textContent += `${node.textContent?.trim()}\n`;
        }
      }
      textContent += '\n\n';
    }
  }

  return textContent.trim();
}

/**
 * Process a ZIP archive and extract text files
 */
export async function convertZipToTxt(
  zipFile: File | Blob | ArrayBuffer,
): Promise<ConvertedFile[]> {
  const results: ConvertedFile[] = [];
  const zip = await JSZip.loadAsync(zipFile);

  const promises: Promise<void>[] = [];

  zip.forEach((_relativePath, file) => {
    const fileNameLower = file.name.toLowerCase();
    const baseName = file.name.slice(0, file.name.lastIndexOf('.'));

    if (fileNameLower.endsWith('.txt')) {
      promises.push(
        file.async('text').then((content) => {
          results.push({ filename: baseName, content });
        }),
      );
    } else if (fileNameLower.endsWith('.fb2')) {
      promises.push(
        file.async('text').then((content) => {
          results.push({ filename: baseName, content: convertFb2ToTxt(content) });
        }),
      );
    } else if (fileNameLower.endsWith('.epub')) {
      promises.push(
        file.async('arraybuffer').then(async (content) => {
          const text = await convertEpubToTxt(content);
          results.push({ filename: baseName, content: text });
        }),
      );
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Detect file type and convert to text
 */
export async function convertFileToTxt(file: File): Promise<ConvertedFile[]> {
  const fileName = file.name.toLowerCase();
  const baseName = file.name.slice(0, file.name.lastIndexOf('.'));

  if (fileName.endsWith('.txt') || fileName.endsWith('.ini')) {
    const content = await file.text();
    return [{ filename: baseName, content }];
  }

  if (fileName.endsWith('.fb2')) {
    const content = await file.text();
    return [{ filename: baseName, content: convertFb2ToTxt(content) }];
  }

  if (fileName.endsWith('.epub')) {
    const content = await convertEpubToTxt(file);
    return [{ filename: baseName, content }];
  }

  if (fileName.endsWith('.zip')) {
    return convertZipToTxt(file);
  }

  // Default: try to read as text
  const content = await file.text();
  return [{ filename: baseName, content }];
}
