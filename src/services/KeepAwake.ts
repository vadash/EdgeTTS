/**
 * Keeps the browser active in a background tab, where timer and WebSocket
 * throttling would otherwise stall a Conversion. Three strategies:
 * - A silent AudioContext makes the browser treat the tab as playing audio,
 *   so timers and WebSockets are not throttled.
 * - A Web Lock keeps the tab from being discarded.
 * - A Screen Wake Lock keeps the screen from dimming (mobile).
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

    this.startAudioContext();

    this.startWebLock();

    await this.startScreenWakeLock();
  }

  stop(): void {
    if (!this.active) return;
    this.cleanup();
  }

  isActive(): boolean {
    return this.active;
  }

  static async isConversionRunning(): Promise<boolean> {
    if (!navigator.locks) return false;
    const state = await navigator.locks.query();
    return state.held?.some((lock) => lock.name === 'tts-conversion-active') ?? false;
  }

  private startAudioContext(): void {
    try {
      this.audioContext = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();

      // A 1 Hz oscillator at near-zero gain keeps the tab "playing audio"
      // without producing audible sound.
      this.oscillator = this.audioContext.createOscillator();
      this.oscillator.frequency.value = 1;
      this.oscillator.type = 'sine';

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 0.001;

      this.oscillator.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      this.oscillator.start();
    } catch {
      // AudioContext may be unsupported; run without it.
    }
  }

  private startWebLock(): void {
    if (!navigator.locks) return;

    // The request promise stays pending until cleanup() resolves it, so
    // the lock is held for as long as the service is active.
    navigator.locks
      .request('tts-conversion-active', { mode: 'exclusive' }, () => {
        return new Promise<void>((resolve) => {
          this.lockResolver = resolve;
        });
      })
      .catch(() => {
        // Lock request failed or was aborted
      });
  }

  private async startScreenWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return;

    // Register the listener regardless of visibility; it re-acquires the
    // lock when the tab becomes visible again.
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    // The browser rejects a wake-lock request while the tab is hidden.
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

    if (this.lockResolver) {
      this.lockResolver();
      this.lockResolver = null;
    }

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

let keepAwakeInstance: KeepAwake | null = null;

export function getKeepAwake(): KeepAwake {
  if (!keepAwakeInstance) {
    keepAwakeInstance = new KeepAwake();
  }
  return keepAwakeInstance;
}
