import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ReusableEdgeTTSService } from '../ReusableEdgeTTSService';
import type { TTSConfig } from '@/state/types';

describe('ReusableEdgeTTSService Integration', () => {
  let service: ReusableEdgeTTSService;
  let originalWebSocket: typeof WebSocket;

  const defaultConfig: TTSConfig = {
    voice: 'en-US-JennyNeural',
    pitch: '+0%',
    rate: '+0%',
    volume: '+0%',
  };

  beforeEach(() => {
    originalWebSocket = window.WebSocket;
    service = new ReusableEdgeTTSService();
  });

  afterEach(() => {
    service.disconnect();
    // Restore original WebSocket
    Object.defineProperty(window, 'WebSocket', {
      value: originalWebSocket,
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
  });

  /**
   * Creates a mock WebSocket that captures sent messages and simulates
   * the connection handshake and audio response.
   *
   * The audio blob must contain the 'Path:audio\r\n' separator followed by
   * actual audio data, as the service extracts audio after this marker.
   */
  function createMockWebSocket() {
    const sentMessages: string[] = [];
    let onopenHandler: ((event: Event) => void) | null = null;
    let onmessageHandler: ((event: MessageEvent) => void) | null = null;
    let oncloseHandler: ((event: CloseEvent) => void) | null = null;
    // biome-ignore lint/correctness/noUnusedVariables: Intentionally captured for potential future error handling
    let onerrorHandler: ((event: Event) => void) | null = null;

    const mockWs = vi.fn().mockImplementation(function (this: WebSocket, url: string | URL) {
      (this as any).url = url.toString();
      (this as any).readyState = 0; // CONNECTING

      // Capture handlers
      Object.defineProperty(this, 'onopen', {
        set: (handler: (event: Event) => void) => {
          onopenHandler = handler;
        },
      });
      Object.defineProperty(this, 'onmessage', {
        set: (handler: (event: MessageEvent) => void) => {
          onmessageHandler = handler;
        },
      });
      Object.defineProperty(this, 'onclose', {
        set: (handler: (event: CloseEvent) => void) => {
          oncloseHandler = handler;
        },
      });
      Object.defineProperty(this, 'onerror', {
        set: (handler: (event: Event) => void) => {
          onerrorHandler = handler;
        },
      });

      (this as any).send = vi.fn().mockImplementation((data: string | Blob) => {
        if (typeof data === 'string') {
          sentMessages.push(data);

          // Simulate the speech.config response (first message after connection)
          if (data.includes('Path:speech.config')) {
            // Connection is established, move to OPEN state
            (this as any).readyState = 1; // OPEN
            setTimeout(() => {
              onopenHandler?.(new Event('open'));
            }, 0);
          }

          // Simulate audio response for SSML messages
          if (data.includes('Path:ssml')) {
            // Simulate receiving audio data with the Path:audio separator
            setTimeout(() => {
              const separator = new TextEncoder().encode('Path:audio\r\n');
              const audioData = new Uint8Array([0x00, 0x01, 0x02, 0x03]); // Mock audio bytes
              const combined = new Uint8Array(separator.length + audioData.length);
              combined.set(separator, 0);
              combined.set(audioData, separator.length);
              const mockAudioBlob = new Blob([combined]);
              onmessageHandler?.(new MessageEvent('message', { data: mockAudioBlob }));

              // Simulate turn.end to complete the request
              setTimeout(() => {
                onmessageHandler?.(
                  new MessageEvent('message', {
                    data: 'Path:turn.end\r\n',
                  }),
                );
              }, 10);
            }, 0);
          }
        }
      });

      (this as any).close = vi.fn().mockImplementation(() => {
        (this as any).readyState = 3; // CLOSED
        setTimeout(() => {
          oncloseHandler?.(new CloseEvent('close', { code: 1000, reason: '' }));
        }, 0);
      });

      // Simulate connection opening after a brief delay
      setTimeout(() => {
        (this as any).readyState = 1; // OPEN
        onopenHandler?.(new Event('open'));
      }, 0);

      return this;
    });

    (mockWs as any).CONNECTING = 0;
    (mockWs as any).OPEN = 1;
    (mockWs as any).CLOSING = 2;
    (mockWs as any).CLOSED = 3;

    return { MockWebSocket: mockWs, sentMessages };
  }

  describe('XML escaping in full TTS pipeline', () => {
    it('escapes less-than and greater-than in text sent to WebSocket', async () => {
      const { MockWebSocket, sentMessages } = createMockWebSocket();
      Object.defineProperty(window, 'WebSocket', {
        value: MockWebSocket,
        configurable: true,
        writable: true,
      });

      // Connect and send
      await service.connect();
      await service.send({ text: '5 < 10 and 20 > 15', config: defaultConfig });

      // Find the SSML message
      const ssmlMessage = sentMessages.find((m) => m.includes('Path:ssml'));
      expect(ssmlMessage).toBeDefined();

      // Verify the text is escaped in the SSML
      expect(ssmlMessage).toContain('5 &lt; 10 and 20 &gt; 15');
      expect(ssmlMessage).not.toContain('5 < 10 and 20 > 15');
    });

    it('escapes ampersand in company names like AT&T', async () => {
      const { MockWebSocket, sentMessages } = createMockWebSocket();
      Object.defineProperty(window, 'WebSocket', {
        value: MockWebSocket,
        configurable: true,
        writable: true,
      });

      await service.connect();
      await service.send({ text: 'AT&T is a company', config: defaultConfig });

      const ssmlMessage = sentMessages.find((m) => m.includes('Path:ssml'));
      expect(ssmlMessage).toBeDefined();
      expect(ssmlMessage).toContain('AT&amp;T is a company');
      expect(ssmlMessage).not.toContain('AT&T is a company');
    });

    it('escapes quotes and apostrophes', async () => {
      const { MockWebSocket, sentMessages } = createMockWebSocket();
      Object.defineProperty(window, 'WebSocket', {
        value: MockWebSocket,
        configurable: true,
        writable: true,
      });

      await service.connect();
      await service.send({ text: 'O\'Connor said "Hello"', config: defaultConfig });

      const ssmlMessage = sentMessages.find((m) => m.includes('Path:ssml'));
      expect(ssmlMessage).toBeDefined();
      expect(ssmlMessage).toContain('O&apos;Connor said &quot;Hello&quot;');
    });

    it('escapes all 5 XML special characters in a complex sentence', async () => {
      const { MockWebSocket, sentMessages } = createMockWebSocket();
      Object.defineProperty(window, 'WebSocket', {
        value: MockWebSocket,
        configurable: true,
        writable: true,
      });

      await service.connect();
      await service.send({
        text: 'if (x < 0 && y > 100) { result = "it\'s done"; }',
        config: defaultConfig,
      });

      const ssmlMessage = sentMessages.find((m) => m.includes('Path:ssml'));
      expect(ssmlMessage).toBeDefined();

      // All special characters should be escaped in the SSML content
      expect(ssmlMessage).toContain('&lt;');
      expect(ssmlMessage).toContain('&gt;');
      expect(ssmlMessage).toContain('&amp;&amp;'); // both & chars are escaped
      expect(ssmlMessage).toContain('&quot;');
      expect(ssmlMessage).toContain('&apos;');

      // Extract the text content between prosody tags to verify escaping
      const textMatch = ssmlMessage?.match(/<prosody[^>]*>([\s\S]*?)<\/prosody>/);
      expect(textMatch).toBeTruthy();
      const textContent = textMatch?.[1].trim();

      // The text content should be the escaped version
      expect(textContent).toBe(
        'if (x &lt; 0 &amp;&amp; y &gt; 100) { result = &quot;it&apos;s done&quot;; }',
      );

      // Should not contain any unescaped special chars
      expect(textContent).not.toContain('<');
      expect(textContent).not.toContain('>');
      expect(textContent).not.toContain('"');
      expect(textContent).not.toContain("'");
    });

    it('handles already-escaped entities without double-escaping', async () => {
      const { MockWebSocket, sentMessages } = createMockWebSocket();
      Object.defineProperty(window, 'WebSocket', {
        value: MockWebSocket,
        configurable: true,
        writable: true,
      });

      await service.connect();
      // Text that already contains XML entities
      await service.send({ text: 'Already escaped: &lt;tag&gt;', config: defaultConfig });

      const ssmlMessage = sentMessages.find((m) => m.includes('Path:ssml'));
      expect(ssmlMessage).toBeDefined();

      // The & in &lt; and &gt; should be escaped, but &amp; should not be double-escaped
      expect(ssmlMessage).toContain('&amp;lt;tag&amp;gt;');
      expect(ssmlMessage).not.toContain('&amp;amp;'); // Should not double-escape
    });

    it('preserves international characters while escaping XML specials', async () => {
      const { MockWebSocket, sentMessages } = createMockWebSocket();
      Object.defineProperty(window, 'WebSocket', {
        value: MockWebSocket,
        configurable: true,
        writable: true,
      });

      await service.connect();
      await service.send({
        text: 'Привет <мир> & 你好 "test"',
        config: defaultConfig,
      });

      const ssmlMessage = sentMessages.find((m) => m.includes('Path:ssml'));
      expect(ssmlMessage).toBeDefined();

      // International characters preserved
      expect(ssmlMessage).toContain('Привет');
      expect(ssmlMessage).toContain('мир');
      expect(ssmlMessage).toContain('你好');

      // XML specials escaped
      expect(ssmlMessage).toContain('&lt;мир&gt;');
      expect(ssmlMessage).toContain('&amp;');
      expect(ssmlMessage).toContain('&quot;test&quot;');
    });

    it('completes request without RetriableError for properly escaped XML', async () => {
      const { MockWebSocket, sentMessages } = createMockWebSocket();
      Object.defineProperty(window, 'WebSocket', {
        value: MockWebSocket,
        configurable: true,
        writable: true,
      });

      await service.connect();

      // These texts previously could cause malformed XML errors
      const problematicTexts = [
        '5 < 10 and 20 > 15',
        'AT&T is a company',
        'O\'Connor said "Hello"',
        'if (x < 0 && y > 100) { result = "done"; }',
      ];

      for (const text of problematicTexts) {
        const result = await service.send({ text, config: defaultConfig });
        expect(result).toBeInstanceOf(Uint8Array);

        // Verify the message was sent with escaped content
        const ssmlMessage = sentMessages.find((m) =>
          m.includes(
            text.replace(/[<&>"']/g, (c) => {
              const map: Record<string, string> = {
                '<': '&lt;',
                '>': '&gt;',
                '&': '&amp;',
                '"': '&quot;',
                "'": '&apos;',
              };
              return map[c] || c;
            }),
          ),
        );
        expect(ssmlMessage).toBeDefined();
      }
    });

    it('produces valid SSML structure with escaped content', async () => {
      const { MockWebSocket, sentMessages } = createMockWebSocket();
      Object.defineProperty(window, 'WebSocket', {
        value: MockWebSocket,
        configurable: true,
        writable: true,
      });

      await service.connect();
      await service.send({ text: 'A < B & C > D', config: defaultConfig });

      const ssmlMessage = sentMessages.find((m) => m.includes('Path:ssml'));
      expect(ssmlMessage).toBeDefined();

      // Extract the SSML content from the message
      const ssmlMatch = ssmlMessage?.match(/<speak[\s\S]*<\/speak>/);
      expect(ssmlMatch).toBeTruthy();

      const ssml = ssmlMatch?.[0] ?? '';

      // Basic structure validation
      expect(ssml).toMatch(/^<speak version='1\.0'/);
      expect(ssml).toMatch(/<voice name='/);
      expect(ssml).toMatch(/<prosody/);
      expect(ssml).toMatch(/<\/prosody><\/voice><\/speak>$/);

      // Verify escaped content is inside prosody tag
      expect(ssml).toMatch(/<prosody[^>]*>\s*A &lt; B &amp; C &gt; D\s*<\/prosody>/);
    });
  });
});
