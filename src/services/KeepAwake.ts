// KeepAwake Service
// Prevents browser from throttling background tabs using multiple strategies:
// 1. AudioContext with silent oscillator - prevents timer/WebSocket throttling
// 2. Web Locks API - prevents tab from being discarded
// 3. Screen Wake Lock - prevents screen dimming (mobile)

/**
 * KeepAwake uses multiple strategies to keep the browser active:
 * - AudioContext: Tricks browser into treating tab as "playing audio"
 * - Web Locks: Prevents tab from being discarded by browser
 * - Screen Wake Lock: Prevents screen from dimming (useful on mobile)
 */
export class KeepAwake {
  private audioContext: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private lockResolver: (() => void) | null = null;
  private active = false;

  async start(): Promise<void> {
    if (this.active) return;

    this.active = true;

    // Strategy 1: AudioContext (prevents timer/WebSocket throttling)
    this.startAudioContext();

    // Strategy 2: Web Locks API (prevents tab discard)
    this.startWebLock();

    // Strategy 3: Screen Wake Lock (prevents screen dimming)
    await this.startScreenWakeLock();
  }

  stop(): void {
    if (!this.active) return;
    this.cleanup();
  }

  isActive(): boolean {
    return this.active;
  }

  private startAudioContext(): void {
    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

      // Create oscillator (generates tone)
      this.oscillator = this.audioContext.createOscillator();
      this.oscillator.frequency.value = 1; // Very low frequency
      this.oscillator.type = 'sine';

      // Create gain node to make it inaudible
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 0.001; // Nearly silent

      // Connect: oscillator -> gain -> destination
      this.oscillator.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      // Start the oscillator
      this.oscillator.start();
    } catch {
      // AudioContext not supported, silently fail
    }
  }

  private startWebLock(): void {
    if (!navigator.locks) return;

    // Request a lock that stays held until we release it
    navigator.locks.request('tts-conversion-active', { mode: 'exclusive' }, () => {
      return new Promise<void>((resolve) => {
        this.lockResolver = resolve;
      });
    }).catch(() => {
      // Lock request failed or was aborted
    });
  }

  private async startScreenWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return;

    // Register visibility listener regardless — it will acquire lock
    // when tab becomes visible
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    // Only request if currently visible; browser rejects when hidden
    if (document.visibilityState !== 'visible') return;

    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Wake lock not supported or permission denied
    }
  }

  private handleVisibilityChange = async (): Promise<void> => {
    if (document.visibilityState === 'visible' && this.active && !this.wakeLock) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch {
        // Failed to re-acquire
      }
    }
  };

  private cleanup(): void {
    // Stop AudioContext
    try {
      this.oscillator?.stop();
    } catch {
      // Already stopped
    }

    try {
      this.oscillator?.disconnect();
      this.gainNode?.disconnect();
    } catch {
      // Already disconnected
    }

    try {
      void this.audioContext?.close();
    } catch {
      // Already closed
    }

    // Release Web Lock
    if (this.lockResolver) {
      this.lockResolver();
      this.lockResolver = null;
    }

    // Release Screen Wake Lock
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    this.oscillator = null;
    this.gainNode = null;
    this.audioContext = null;
    this.active = false;
  }
}

// Singleton instance
let keepAwakeInstance: KeepAwake | null = null;

export function getKeepAwake(): KeepAwake {
  if (!keepAwakeInstance) {
    keepAwakeInstance = new KeepAwake();
  }
  return keepAwakeInstance;
}
