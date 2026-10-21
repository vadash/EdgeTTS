import { describe, expect, it, vi } from 'vitest';
import { ReusableEdgeTTSService } from '../ReusableEdgeTTSService';
import type { TTSConfig } from '@/state/types';

describe('ReusableEdgeTTSService', () => {
  describe('makeSSML', () => {
    const getMakeSSML = (service: ReusableEdgeTTSService) => {
      return (service as any).makeSSML.bind(service);
    };

    const defaultConfig: TTSConfig = {
      voice: 'en-US, JennyNeural',
      pitch: '+0%',
      rate: '+0%',
      volume: '+0%',
    };

    it('escapes all 5 XML special characters', () => {
      const service = new ReusableEdgeTTSService();
      const makeSSML = getMakeSSML(service);

      const result = makeSSML('Test < > & " \'', defaultConfig);

      expect(result).toContain('Test &lt; &gt; &amp; &quot; &apos;');
    });

    it('escapes & first to avoid double-escaping', () => {
      const service = new ReusableEdgeTTSService();
      const makeSSML = getMakeSSML(service);

      const result = makeSSML('A & B < C', defaultConfig);

      expect(result).toContain('A &amp; B &lt; C');
      expect(result).not.toContain('&amp;amp;');
      expect(result).not.toContain('&amp;lt;');
    });

    it('passes normal text through unchanged', () => {
      const service = new ReusableEdgeTTSService();
      const makeSSML = getMakeSSML(service);

      const result = makeSSML('Hello world', defaultConfig);

      expect(result).toContain("'>\nHello world</prosody>");
    });

    it('handles already-escaped text without breaking (redundant but valid)', () => {
      const service = new ReusableEdgeTTSService();
      const makeSSML = getMakeSSML(service);

      const result = makeSSML('&lt;tag&gt;', defaultConfig);

      // The & in &lt; and &gt; escapes again to &amp;
      expect(result).toContain('&amp;lt;tag&amp;gt;</prosody>');
    });

    it('passes international characters through unchanged', () => {
      const service = new ReusableEdgeTTSService();
      const makeSSML = getMakeSSML(service);

      let result = makeSSML('Привет', defaultConfig);
      expect(result).toContain("'>\nПривет</prosody>");

      result = makeSSML('你好', defaultConfig);
      expect(result).toContain("'>\n你好</prosody>");

      result = makeSSML('こんにちは', defaultConfig);
      expect(result).toContain("'>\nこんにちは</prosody>");

      result = makeSSML('مرحبا', defaultConfig);
      expect(result).toContain("'>\nمرحبا</prosody>");

      result = makeSSML('Hello 👋', defaultConfig);
      expect(result).toContain("'>\nHello 👋</prosody>");
    });

    it('handles empty string', () => {
      const service = new ReusableEdgeTTSService();
      const makeSSML = getMakeSSML(service);

      const result = makeSSML('', defaultConfig);

      // Empty text still yields valid SSML with no content between the prosody tags
      expect(result).toContain('</prosody></voice></speak>');
      expect(result).toMatch(/<prosody[^>]*>\s*<\/prosody>/);
    });

    it('escapes multiple occurrences of special characters', () => {
      const service = new ReusableEdgeTTSService();
      const makeSSML = getMakeSSML(service);

      const result = makeSSML('<<test>> & "quoted" & \'single\'', defaultConfig);

      expect(result).toContain('&lt;&lt;test&gt;&gt;');
      expect(result).toContain('&amp;');
      expect(result).toContain('&quot;quoted&quot;');
      expect(result).toContain('&apos;single&apos;');
    });

    it('preserves newlines and whitespace in text', () => {
      const service = new ReusableEdgeTTSService();
      const makeSSML = getMakeSSML(service);

      const result = makeSSML('Line 1\nLine 2\nLine 3', defaultConfig);

      expect(result).toContain("'>\nLine 1\nLine 2\nLine 3</prosody>");
    });
  });

  describe('handleClose error detail', () => {
    // Regression: the server aborts cold-cache syntheses with a bare close
    // (1006/1007); retry logs must carry the close code, not a generic
    // message. See docs/adr/0019.
    const closeEvent = (code: number, reason = '') =>
      ({ code, reason, wasClean: false }) as CloseEvent;

    type CloseHandler = (event: CloseEvent, connectReject?: (error: Error) => void) => void;
    const handleCloseOf = (service: ReusableEdgeTTSService): CloseHandler => {
      // Test seam: handleClose is private; the cast keeps the real signature.
      const exposed = service as unknown as { handleClose: CloseHandler };
      return exposed.handleClose.bind(service);
    };

    it('includes close code when closed during connection', () => {
      const service = new ReusableEdgeTTSService();
      // Production precondition: connectReject is wired only while CONNECTING.
      const internals = service as unknown as { state: string };
      internals.state = 'CONNECTING';
      const reject = vi.fn();
      handleCloseOf(service)(closeEvent(1006), reject);

      expect(reject).toHaveBeenCalledTimes(1);
      expect(reject.mock.calls[0]?.[0]?.message).toBe(
        'WebSocket closed during connection (code 1006)',
      );
    });

    it('includes close reason when the server provides one', () => {
      const service = new ReusableEdgeTTSService();
      // Production precondition: connectReject is wired only while CONNECTING.
      const internals = service as unknown as { state: string };
      internals.state = 'CONNECTING';
      const reject = vi.fn();
      handleCloseOf(service)(closeEvent(1007, 'bad payload'), reject);

      expect(reject.mock.calls[0]?.[0]?.message).toBe(
        'WebSocket closed during connection (code 1007: bad payload)',
      );
    });

    it('includes close code when closed during a request', () => {
      const service = new ReusableEdgeTTSService();
      const requestReject = vi.fn();
      const internals = service as unknown as {
        state: string;
        requestReject: ((error: Error) => void) | null;
      };
      internals.state = 'BUSY';
      internals.requestReject = requestReject;

      handleCloseOf(service)(closeEvent(1006));

      expect(requestReject).toHaveBeenCalledTimes(1);
      expect(requestReject.mock.calls[0]?.[0]?.message).toBe(
        'WebSocket closed during request (code 1006)',
      );
      expect(internals.state).toBe('DISCONNECTED');
    });
  });
});
