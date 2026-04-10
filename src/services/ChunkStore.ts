export class ChunkStore {
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private dataHandle: FileSystemFileHandle | null = null;
  private indexHandle: FileSystemFileHandle | null = null;
  private index = new Map<number, { offset: number; length: number }>();
  private currentOffset = 0;
  private currentIndexOffset = 0;
  private cachedFile: File | null = null;
  private textEncoder = new TextEncoder();

  private queue: Array<{ index: number; data: Uint8Array; resolve: () => void }> = [];
  private draining = false;

  async init(directoryHandle: FileSystemDirectoryHandle): Promise<void> {
    this.directoryHandle = directoryHandle;
    this.dataHandle = await directoryHandle.getFileHandle('chunks_data.bin', { create: true });
    this.indexHandle = await directoryHandle.getFileHandle('chunks_index.jsonl', { create: true });
    await this.parseExistingIndex();
  }

  private async parseExistingIndex(): Promise<void> {
    let maxValidOffset = 0;
    let validIndexBytes = 0;

    try {
      const indexFile = await this.indexHandle!.getFile();
      const text = await indexFile.text();
      const lines = text.split('\n');
      let bytePosition = 0;

      for (const line of lines) {
        const lineBytes = this.textEncoder.encode(line + '\n').byteLength;

        if (line.trim().length === 0) {
          bytePosition += lineBytes;
          continue;
        }

        try {
          const entry = JSON.parse(line);
          if (typeof entry.i === 'number' && typeof entry.o === 'number' && typeof entry.l === 'number') {
            this.index.set(entry.i, { offset: entry.o, length: entry.l });
            maxValidOffset = Math.max(maxValidOffset, entry.o + entry.l);
            validIndexBytes = bytePosition + lineBytes;
          }
        } catch {
          break;
        }

        bytePosition += lineBytes;
      }
    } catch {
      // Fresh start
    }

    this.currentOffset = maxValidOffset;
    this.currentIndexOffset = validIndexBytes;

    // Truncate to known-good sizes
    if (this.currentOffset > 0 || this.currentIndexOffset > 0) {
      const dataTruncate = await this.dataHandle!.createWritable({ keepExistingData: true });
      await dataTruncate.truncate(this.currentOffset);
      await dataTruncate.close();

      const indexTruncate = await this.indexHandle!.createWritable({ keepExistingData: true });
      await indexTruncate.truncate(this.currentIndexOffset);
      await indexTruncate.close();
    }
  }

  async writeChunk(index: number, data: Uint8Array): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ index, data, resolve });
      if (!this.draining) {
        void this.drain();
      }
    });
  }

  private async drain(): Promise<void> {
    this.draining = true;

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.queue.length);

      const dataStream = await this.dataHandle!.createWritable({ keepExistingData: true });
      const indexStream = await this.indexHandle!.createWritable({ keepExistingData: true });

      await dataStream.seek(this.currentOffset);
      await indexStream.seek(this.currentIndexOffset);

      for (const item of batch) {
        const offset = this.currentOffset;
        // Ensure we have a regular ArrayBuffer (not SharedArrayBuffer) for File System Access API
        const buffer = new ArrayBuffer(item.data.byteLength);
        new Uint8Array(buffer).set(item.data);
        await dataStream.write(new Uint8Array(buffer));

        const indexLine = JSON.stringify({ i: item.index, o: offset, l: item.data.byteLength }) + '\n';
        await indexStream.write(indexLine);

        this.index.set(item.index, { offset, length: item.data.byteLength });
        this.currentOffset += item.data.byteLength;
        this.currentIndexOffset += this.textEncoder.encode(indexLine).byteLength;
      }

      await dataStream.close();
      await indexStream.close();

      for (const item of batch) {
        item.resolve();
      }
    }

    this.draining = false;
  }

  async prepareForRead(): Promise<void> {
    this.cachedFile = await this.dataHandle!.getFile();
  }

  async readChunk(index: number): Promise<Uint8Array> {
    const entry = this.index.get(index);
    if (!entry) {
      throw new Error(`Chunk ${index} not found`);
    }
    if (!this.cachedFile) {
      throw new Error('Call prepareForRead() before reading');
    }

    const blob = this.cachedFile.slice(entry.offset, entry.offset + entry.length);
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  getExistingIndices(): Set<number> {
    return new Set(this.index.keys());
  }

  async close(): Promise<void> {
    // Drain any pending writes
    if (this.queue.length > 0 && !this.draining) {
      await this.drain();
    }
    this.cachedFile = null;
    this.dataHandle = null;
    this.indexHandle = null;
    this.directoryHandle = null;
  }
}
