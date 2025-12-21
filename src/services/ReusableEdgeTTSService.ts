// ReusableEdgeTTSService - WebSocket-based TTS with connection reuse
// Implements state machine for connection management

import { sha256 } from '../utils/sha256';
import { generateConnectionId } from '../utils/uuid';
import { defaultConfig } from '@/config';
import { RetriableError } from '@/errors';
import type { TTSConfig } from '../state/types';
import type { ILogger } from './interfaces';

// Windows epoch for Sec-MS-GEC generation
const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;

// Connection states
export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'READY' | 'BUSY';

// Keep-alive interval (30 seconds)
const KEEP_ALIVE_INTERVAL = 30000;

// Connection timeout (10 seconds)
const CONNECTION_TIMEOUT = 10000;

// Request timeout (60 seconds)
const REQUEST_TIMEOUT = 60000;

export interface TTSSendOptions {
  text: string;
  config: TTSConfig;
  requestId?: string;
}

/**
 * ReusableEdgeTTSService - Maintains a persistent WebSocket connection
 * to the Edge TTS API for multiple requests.
 *
 * State Machine:
 * - DISCONNECTED: No active WebSocket connection
 * - CONNECTING: WebSocket connecting, speech.config handshake in progress
 * - READY: Connection established, ready to accept requests
 * - BUSY: Processing a TTS request
 */
export class ReusableEdgeTTSService {
  private socket: WebSocket | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private bytesDataSeparator: Uint8Array;
  private logger?: ILogger;

  // Connection management
  private connectPromise: Promise<void> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private connectionId: string = '';

  // Request state
  private currentRequestId: string = '';
  private audioChunks: Blob[] = [];
  private requestResolve: ((data: Uint8Array) => void) | null = null;
  private requestReject: ((error: Error) => void) | null = null;
  private requestTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(logger?: ILogger) {
    this.bytesDataSeparator = new TextEncoder().encode('Path:audio\r\n');
    this.logger = logger;
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Connect to the Edge TTS WebSocket API
   * Returns a Promise that resolves when the connection is ready
   */
  async connect(): Promise<void> {
    // Already connected or connecting
    if (this.state === 'READY') {
      return;
    }

    if (this.state === 'CONNECTING' && this.connectPromise) {
      return this.connectPromise;
    }

    if (this.state === 'BUSY') {
      throw new Error('Cannot connect while busy processing a request');
    }

    this.connectPromise = this.doConnect();
    return this.connectPromise;
  }

  private async doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.state = 'CONNECTING';

      const secMsGec = this.generateSecMsGec();
      this.connectionId = generateConnectionId();

      const url = `${defaultConfig.edgeTtsApi.baseUrl}?TrustedClientToken=${defaultConfig.edgeTtsApi.trustedClientToken}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${defaultConfig.edgeTtsApi.secMsGecVersion}&ConnectionId=${this.connectionId}`;

      const timeoutId = setTimeout(() => {
        this.cleanup();
        reject(new RetriableError('Connection timeout'));
      }, CONNECTION_TIMEOUT);

      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        clearTimeout(timeoutId);
        this.sendConfig();
        this.state = 'READY';
        this.startKeepAlive();
        this.logger?.debug('WebSocket connected');
        resolve();
      };

      this.socket.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.socket.onclose = (event) => {
        clearTimeout(timeoutId);
        this.handleClose(event, reject);
      };

      this.socket.onerror = () => {
        clearTimeout(timeoutId);
        this.cleanup();
        reject(new RetriableError('WebSocket connection error'));
      };
    });
  }

  /**
   * Send TTS request and receive audio data
   * Returns a Promise that resolves with the audio Uint8Array
   */
  async send(options: TTSSendOptions): Promise<Uint8Array> {
    const { text, config, requestId } = options;

    // Ensure connected
    if (this.state === 'DISCONNECTED' || this.state === 'CONNECTING') {
      await this.connect();
    }

    if (this.state === 'BUSY') {
      throw new Error('Connection is busy processing another request');
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new RetriableError('WebSocket not connected');
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      this.state = 'BUSY';
      this.currentRequestId = requestId ?? generateConnectionId();
      this.audioChunks = [];
      this.requestResolve = resolve;
      this.requestReject = reject;

      // Set request timeout
      this.requestTimeout = setTimeout(() => {
        this.rejectRequest(new RetriableError('Request timeout'));
      }, REQUEST_TIMEOUT);

      // Send SSML
      const timestamp = this.dateToString();
      const ssml = this.makeSSML(text, config);
      const message = this.ssmlHeadersPlusData(this.currentRequestId, timestamp, ssml);

      try {
        this.socket!.send(message);
      } catch (error) {
        this.rejectRequest(new RetriableError('Failed to send SSML', error as Error));
      }
    });
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    this.cleanup();
  }

  /**
   * Check if connection is available for use
   */
  isReady(): boolean {
    return this.state === 'READY' && this.socket?.readyState === WebSocket.OPEN;
  }

  private sendConfig(): void {
    const timestamp = this.dateToString();
    const configMessage =
      `X-Timestamp:${timestamp}\r\n` +
      'Content-Type:application/json; charset=utf-8\r\n' +
      'Path:speech.config\r\n\r\n' +
      `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":true},"outputFormat":"${defaultConfig.edgeTtsApi.audioFormat}"}}}}\r\n`;

    this.socket?.send(configMessage);
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    const data = event.data;

    if (typeof data === 'string') {
      if (data.includes('Path:turn.end')) {
        await this.completeRequest();
      }
    }

    if (data instanceof Blob) {
      this.audioChunks.push(data);
    }
  }

  private handleClose(event: CloseEvent, connectReject?: (error: Error) => void): void {
    this.logger?.debug(`WebSocket closed: code=${event.code}, reason=${event.reason}`);

    const wasConnecting = this.state === 'CONNECTING';
    const wasBusy = this.state === 'BUSY';

    this.stopKeepAlive();

    if (wasConnecting && connectReject) {
      connectReject(new RetriableError('WebSocket closed during connection'));
    } else if (wasBusy && this.requestReject) {
      this.rejectRequest(new RetriableError('WebSocket closed during request'));
    }

    this.state = 'DISCONNECTED';
    this.socket = null;
    this.connectPromise = null;
  }

  private async completeRequest(): Promise<void> {
    if (this.requestTimeout) {
      clearTimeout(this.requestTimeout);
      this.requestTimeout = null;
    }

    const audioData = await this.processAudioChunks();
    this.audioChunks = [];
    this.state = 'READY';

    if (audioData.length === 0) {
      this.rejectRequest(new Error('No audio data received'));
      return;
    }

    if (this.requestResolve) {
      this.requestResolve(audioData);
      this.requestResolve = null;
      this.requestReject = null;
    }
  }

  private rejectRequest(error: Error): void {
    if (this.requestTimeout) {
      clearTimeout(this.requestTimeout);
      this.requestTimeout = null;
    }

    this.audioChunks = [];
    this.state = this.socket?.readyState === WebSocket.OPEN ? 'READY' : 'DISCONNECTED';

    if (this.requestReject) {
      this.requestReject(error);
      this.requestResolve = null;
      this.requestReject = null;
    }
  }

  private async processAudioChunks(): Promise<Uint8Array> {
    let audioData = new Uint8Array(0);

    for (const chunk of this.audioChunks) {
      const buffer = await chunk.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);

      const posIndex = this.findIndex(uint8Array, this.bytesDataSeparator);
      if (posIndex !== -1) {
        const partBlob = chunk.slice(posIndex + this.bytesDataSeparator.length);
        const partBuffer = await partBlob.arrayBuffer();
        const partUint8Array = new Uint8Array(partBuffer);

        const combined = new Uint8Array(audioData.length + partUint8Array.length);
        combined.set(audioData, 0);
        combined.set(partUint8Array, audioData.length);
        audioData = combined;
      }
    }

    return audioData;
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.state === 'READY' && this.socket?.readyState === WebSocket.OPEN) {
        // Send speech.config as keep-alive (harmless re-send)
        this.sendConfig();
        this.logger?.debug('Sent keep-alive');
      }
    }, KEEP_ALIVE_INTERVAL);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private cleanup(): void {
    this.stopKeepAlive();

    if (this.requestTimeout) {
      clearTimeout(this.requestTimeout);
      this.requestTimeout = null;
    }

    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close();
      }
      this.socket = null;
    }

    this.state = 'DISCONNECTED';
    this.connectPromise = null;
    this.audioChunks = [];
    this.requestResolve = null;
    this.requestReject = null;
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

  private makeSSML(text: string, config: TTSConfig): string {
    return (
      "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\n" +
      `<voice name='${config.voice}'><prosody pitch='${config.pitch}' rate='${config.rate}' volume='${config.volume}'>\n` +
      text +
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
}
