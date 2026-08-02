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

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Index non-directory zip entries by lowercased path for case-insensitive lookup. */
function indexEntries(zip: JSZip): Map<string, JSZip.JSZipObject> {
  const index = new Map<string, JSZip.JSZipObject>();
  zip.forEach((relativePath, entry) => {
    if (!entry.dir) {
      index.set(relativePath.replace(/\\/g, '/').toLowerCase(), entry);
    }
  });
  return index;
}

function lookup(index: Map<string, JSZip.JSZipObject>, path: string) {
  return index.get(path.replace(/\\/g, '/').toLowerCase()) ?? null;
}

/** Directory portion of a zip path, with trailing slash ('' for root-level files). */
function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut + 1);
}

/** Resolve an EPUB href (relative, possibly percent-encoded, possibly fragmented). */
function resolveHref(baseDir: string, href: string): string {
  const withoutFragment = href.split('#')[0];
  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // Malformed escapes: fall back to the raw href.
  }

  const out: string[] = [];
  for (const segment of `${baseDir}${decoded}`.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/**
 * Content documents in reading order from the OPF spine.
 * The spine is mandatory in both EPUB 2 and EPUB 3, unlike the deprecated toc.ncx.
 */
async function spineDocuments(
  index: Map<string, JSZip.JSZipObject>,
  parser: DOMParser,
): Promise<JSZip.JSZipObject[]> {
  const containerEntry = lookup(index, 'META-INF/container.xml');
  if (!containerEntry) return [];

  const container = parser.parseFromString(await containerEntry.async('text'), 'application/xml');
  const opfPath = container.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) return [];

  const opfEntry = lookup(index, opfPath);
  if (!opfEntry) return [];

  const opf = parser.parseFromString(await opfEntry.async('text'), 'application/xml');
  const baseDir = dirOf(opfPath);

  const manifest = new Map<string, string>();
  const items = opf.getElementsByTagNameNS('*', 'item');
  for (let i = 0; i < items.length; i++) {
    const id = items[i].getAttribute('id');
    const href = items[i].getAttribute('href');
    if (id && href) manifest.set(id, href);
  }

  const documents: JSZip.JSZipObject[] = [];
  const itemrefs = opf.getElementsByTagNameNS('*', 'itemref');
  for (let i = 0; i < itemrefs.length; i++) {
    const idref = itemrefs[i].getAttribute('idref');
    const href = idref ? manifest.get(idref) : undefined;
    if (!href) continue;
    const entry = lookup(index, resolveHref(baseDir, href));
    if (entry) documents.push(entry);
  }
  return documents;
}

/** Legacy EPUB 2 navigation, for archives missing META-INF/container.xml. */
async function ncxDocuments(
  index: Map<string, JSZip.JSZipObject>,
  parser: DOMParser,
): Promise<JSZip.JSZipObject[]> {
  let ncxPath: string | undefined;
  for (const path of index.keys()) {
    if (path.endsWith('.ncx')) {
      ncxPath = path;
      break;
    }
  }
  const ncxEntry = ncxPath ? lookup(index, ncxPath) : null;
  if (!ncxPath || !ncxEntry) return [];

  const ncx = parser.parseFromString(await ncxEntry.async('text'), 'application/xml');
  const baseDir = dirOf(ncxPath);

  const documents: JSZip.JSZipObject[] = [];
  const navPoints = ncx.getElementsByTagNameNS('*', 'navPoint');
  for (let i = 0; i < navPoints.length; i++) {
    const src = navPoints[i].getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src');
    if (!src) continue;
    const entry = lookup(index, resolveHref(baseDir, src));
    if (entry) documents.push(entry);
  }
  return documents;
}

/** Last resort: every markup document, in numeric-aware path order. */
function htmlDocuments(index: Map<string, JSZip.JSZipObject>): JSZip.JSZipObject[] {
  return [...index.entries()]
    .filter(([path]) => /\.(?:xhtml|html|htm)$/.test(path))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, entry]) => entry);
}

async function extractBodyText(entry: JSZip.JSZipObject, parser: DOMParser): Promise<string> {
  const raw = await entry.async('text');

  let body: Element | undefined = parser
    .parseFromString(raw, 'application/xhtml+xml')
    .getElementsByTagNameNS(XHTML_NS, 'body')[0];
  if (!body) {
    // Not well-formed XML (or no XHTML namespace): retry with the lenient HTML parser.
    body = parser.parseFromString(raw, 'text/html').getElementsByTagName('body')[0];
  }
  if (!body) return '';

  let text = '';
  for (const node of Array.from(body.childNodes)) {
    const trimmed = node.textContent?.trim();
    if (trimmed) text += `${trimmed}\n`;
  }
  return text;
}

/**
 * Convert EPUB format to plain text.
 *
 * Reading order is taken from the OPF spine, so EPUB 3 files that omit the
 * deprecated toc.ncx convert normally. Falls back to toc.ncx, then to a sorted
 * sweep of every markup document.
 */
export async function convertEpubToTxt(epubBinary: ArrayBuffer | Blob | File): Promise<string> {
  const zip = await JSZip.loadAsync(epubBinary);
  const index = indexEntries(zip);
  const parser = new DOMParser();

  let documents = await spineDocuments(index, parser);
  if (documents.length === 0) documents = await ncxDocuments(index, parser);
  if (documents.length === 0) documents = htmlDocuments(index);
  if (documents.length === 0) {
    throw new Error('No readable content found in EPUB');
  }

  const seen = new Set<string>();
  let textContent = '';
  for (const entry of documents) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);

    const text = await extractBodyText(entry, parser);
    if (text) textContent += `${text}\n\n`;
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

  // Collect matching entries first, then process sequentially to avoid OOM
  const entries: Array<{
    file: JSZip.JSZipObject;
    baseName: string;
    type: 'txt' | 'fb2' | 'epub';
  }> = [];

  zip.forEach((_relativePath, file) => {
    const fileNameLower = file.name.toLowerCase();
    const dotIndex = file.name.lastIndexOf('.');
    if (dotIndex === -1) return;
    const baseName = file.name.slice(0, dotIndex);

    if (fileNameLower.endsWith('.txt')) {
      entries.push({ file, baseName, type: 'txt' });
    } else if (fileNameLower.endsWith('.fb2')) {
      entries.push({ file, baseName, type: 'fb2' });
    } else if (fileNameLower.endsWith('.epub')) {
      entries.push({ file, baseName, type: 'epub' });
    }
  });

  for (const { file, baseName, type } of entries) {
    if (type === 'txt') {
      const content = await file.async('text');
      results.push({ filename: baseName, content });
    } else if (type === 'fb2') {
      const content = convertFb2ToTxt(await file.async('text'));
      results.push({ filename: baseName, content });
    } else if (type === 'epub') {
      const content = await convertEpubToTxt(await file.async('arraybuffer'));
      results.push({ filename: baseName, content });
    }
  }

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
