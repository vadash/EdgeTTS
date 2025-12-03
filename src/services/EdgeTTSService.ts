// EdgeTTS Service - WebSocket-based Text-to-Speech
// Migrated from socket_edge_tts.js

import { sha256 } from '../utils/sha256';
import { generateConnectionId } from '../utils/uuid';
import { defaultConfig, WIN_EPOCH, S_TO_NS } from '@/config';
import type { TTSConfig, StatusUpdate } from '../state/types';

export interface TTSWorkerOptions {
  indexPart: number;
  filename: string;
  filenum: string;
  config: TTSConfig;
  text: string;
  onStatusUpdate?: (update: StatusUpdate) => void;
  onComplete?: (audioData: Uint8Array) => void;
  onError?: (error: Error) => void;
}

export class EdgeTTSService {
  private bytesDataSeparator: Uint8Array;
  private audioData: Uint8Array;
  private audioChunks: Blob[];
  private socket: WebSocket | null = null;
  private mp3Saved = false;
  private endMessageReceived = false;

  private indexPart: number;
  private filename: string;
  private filenum: string;
  private config: TTSConfig;
  private text: string;
  private onStatusUpdate?: (update: StatusUpdate) => void;
  private onComplete?: (audioData: Uint8Array) => void;
  private onError?: (error: Error) => void;

  constructor(options: TTSWorkerOptions) {
    this.bytesDataSeparator = new TextEncoder().encode('Path:audio\r\n');
    this.audioData = new Uint8Array(0);
    this.audioChunks = [];

    this.indexPart = options.indexPart;
    this.filename = options.filename;
    this.filenum = options.filenum;
    this.config = options.config;
    this.text = options.text;
    this.onStatusUpdate = options.onStatusUpdate;
    this.onComplete = options.onComplete;
    this.onError = options.onError;
  }

  start(): void {
    if (!('WebSocket' in window)) {
      this.onError?.(new Error('WebSocket not supported'));
      return;
    }

    const secMsGec = this.generateSecMsGec();
    const connectionId = generateConnectionId();

    const url = `${defaultConfig.edgeTtsApi.baseUrl}?TrustedClientToken=${defaultConfig.edgeTtsApi.trustedClientToken}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${defaultConfig.edgeTtsApi.secMsGecVersion}&ConnectionId=${connectionId}`;

    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', this.handleOpen.bind(this));
    this.socket.addEventListener('message', this.handleMessage.bind(this));
    this.socket.addEventListener('close', this.handleClose.bind(this));
    this.socket.addEventListener('error', this.handleError.bind(this));
  }

  clear(): void {
    this.endMessageReceived = false;
    this.audioData = new Uint8Array(0);
    this.audioChunks = [];
  }

  private dateToString(): string {
    const date = new Date();
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    };
    const dateString = date.toLocaleString('en-US', options);
    return dateString.replace(/\u200E/g, '') + ' GMT+0000 (Coordinated Universal Time)';
  }

  private handleOpen(): void {
    this.endMessageReceived = false;
    this.updateStatus('Started');

    const timestamp = this.dateToString();

    // Send config
    this.socket?.send(
      `X-Timestamp:${timestamp}\r\n` +
      'Content-Type:application/json; charset=utf-8\r\n' +
      'Path:speech.config\r\n\r\n' +
      `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":true},"outputFormat":"${defaultConfig.edgeTtsApi.audioFormat}"}}}}\r\n`
    );

    // Send SSML
    this.socket?.send(
      this.ssmlHeadersPlusData(generateConnectionId(), timestamp, this.makeSSML())
    );
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    const data = event.data;

    if (typeof data === 'string') {
      if (data.includes('Path:turn.end')) {
        this.endMessageReceived = true;
        await this.processAudioChunks();
        this.saveMP3();
      }
    }

    if (data instanceof Blob) {
      this.audioChunks.push(data);
    }
  }

  private handleClose(): void {
    if (!this.mp3Saved) {
      if (this.endMessageReceived) {
        this.updateStatus('Processing');
      } else {
        this.onError?.(new Error('WebSocket closed unexpectedly'));
      }
    }
  }

  private handleError(event: Event): void {
    this.onError?.(new Error('WebSocket error'));
  }

  private async processAudioChunks(): Promise<void> {
    for (const chunk of this.audioChunks) {
      const buffer = await chunk.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);

      const posIndex = this.findIndex(uint8Array, this.bytesDataSeparator);
      if (posIndex !== -1) {
        const partBlob = chunk.slice(posIndex + this.bytesDataSeparator.length);
        const partBuffer = await partBlob.arrayBuffer();
        const partUint8Array = new Uint8Array(partBuffer);

        const combined = new Uint8Array(this.audioData.length + partUint8Array.length);
        combined.set(this.audioData, 0);
        combined.set(partUint8Array, this.audioData.length);
        this.audioData = combined;
      }
    }
  }

  private async saveMP3(): Promise<void> {
    if (this.audioData.length === 0) {
      console.error('No audio data to save');
      return;
    }

    this.mp3Saved = true;

    // Don't save individual chunks - AudioMerger handles merging and saving
    // Just pass audio data to callback
    this.updateStatus('Complete');
    this.onComplete?.(this.audioData);
  }

  private makeSSML(): string {
    return (
      "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\n" +
      `<voice name='${this.config.voice}'><prosody pitch='${this.config.pitch}' rate='${this.config.rate}' volume='${this.config.volume}'>\n` +
      this.text +
      '</prosody></voice></speak>'
    );
  }

  private ssmlHeadersPlusData(requestId: string, timestamp: string, ssml: string): string {
    return (
      `X-RequestId:${requestId}\r\n` +
      'Content-Type:application/ssml+xml\r\n' +
      `X-Timestamp:${timestamp}Z\r\n` +
      'Path:ssml\r\n\r\n' +
      ssml
    );
  }

  private generateSecMsGec(): string {
    let ticks = Date.now() / 1000;
    ticks -= 30 + Math.floor(Math.random() * 61);
    ticks += WIN_EPOCH;
    ticks -= ticks % 300;
    ticks *= S_TO_NS / 100;

    const strToHash = Math.floor(ticks) + defaultConfig.edgeTtsApi.trustedClientToken;
    return sha256(strToHash).toUpperCase();
  }

  private findIndex(uint8Array: Uint8Array, separator: Uint8Array): number {
    for (let i = 0; i <= uint8Array.length - separator.length; i++) {
      let found = true;
      for (let j = 0; j < separator.length; j++) {
        if (uint8Array[i + j] !== separator[j]) {
          found = false;
          break;
        }
      }
      if (found) return i;
    }
    return -1;
  }

  private updateStatus(message: string): void {
    this.onStatusUpdate?.({
      partIndex: this.indexPart,
      message: `Part ${String(this.indexPart + 1).padStart(4, '0')}: ${message}`,
      isComplete: this.mp3Saved,
    });
  }
}
