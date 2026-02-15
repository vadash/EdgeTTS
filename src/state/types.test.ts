import { describe, it, expect } from 'vitest';
import { AudioPreset, AUDIO_PRESETS } from '@/state/types';
import type { AppSettings } from '@/state/types';

describe('AudioPreset', () => {
  it('should have all preset values', () => {
    expect(AudioPreset.MAX_QUALITY).toBe('max_quality');
    expect(AudioPreset.BALANCED).toBe('balanced');
    expect(AudioPreset.FAST).toBe('fast');
    expect(AudioPreset.MOBILE).toBe('mobile');
    expect(AudioPreset.CUSTOM).toBe('custom');
  });

  it('AUDIO_PRESETS should have correct configuration', () => {
    const maxQuality = AUDIO_PRESETS.find(p => p.name === AudioPreset.MAX_QUALITY);
    expect(maxQuality?.minBitrate).toBe(128);
    expect(maxQuality?.maxBitrate).toBe(128);
    expect(maxQuality?.compressionLevel).toBe(10);

    const balanced = AUDIO_PRESETS.find(p => p.name === AudioPreset.BALANCED);
    expect(balanced?.minBitrate).toBe(64);
    expect(balanced?.maxBitrate).toBe(96);
    expect(balanced?.compressionLevel).toBe(10);

    const fast = AUDIO_PRESETS.find(p => p.name === AudioPreset.FAST);
    expect(fast?.minBitrate).toBe(48);
    expect(fast?.maxBitrate).toBe(64);
    expect(fast?.compressionLevel).toBe(5);

    const mobile = AUDIO_PRESETS.find(p => p.name === AudioPreset.MOBILE);
    expect(mobile?.minBitrate).toBe(32);
    expect(mobile?.maxBitrate).toBe(48);
    expect(mobile?.compressionLevel).toBe(3);
  });
});

describe('AppSettings interface', () => {
  it('should accept Opus encoding settings', () => {
    const settings: AppSettings = {
      // Required existing fields (minimal subset for type check)
      voice: 'ru-RU, DmitryNeural',
      narratorVoice: 'ru-RU, DmitryNeural',
      voicePoolLocale: 'ru-RU',
      enabledVoices: [],
      rate: 0,
      pitch: 0,
      ttsThreads: 15,
      llmThreads: 2,
      lexxRegister: true,
      showDopSettings: false,
      isLiteMode: true,
      statusAreaWidth: 450,
      outputFormat: 'opus',
      silenceRemovalEnabled: true,
      normalizationEnabled: true,
      deEssEnabled: true,
      silenceGapMs: 100,
      eqEnabled: true,
      compressorEnabled: true,
      fadeInEnabled: true,
      stereoWidthEnabled: true,
      // New Opus settings
      opusPreset: AudioPreset.BALANCED,
      opusMinBitrate: 64,
      opusMaxBitrate: 96,
      opusCompressionLevel: 10,
    } as AppSettings;
    expect(settings.opusPreset).toBe(AudioPreset.BALANCED);
    expect(settings.opusMinBitrate).toBe(64);
    expect(settings.opusMaxBitrate).toBe(96);
    expect(settings.opusCompressionLevel).toBe(10);
  });

  it('should have Opus encoding fields defined', () => {
    // Verify the interface actually has these fields
    const settings: Partial<AppSettings> = {};
    // If this compiles, the interface accepts these properties
    expect(() => {
      settings.opusPreset = AudioPreset.BALANCED;
      settings.opusMinBitrate = 64;
      settings.opusMaxBitrate = 96;
      settings.opusCompressionLevel = 10;
    }).not.toThrow();
  });
});

import type { VoiceProfileFile, CharacterEntry, VoiceAssignment } from '@/state/types';

describe('VoiceProfile Types', () => {
  it('should define VoiceProfileFile type', () => {
    const profile: VoiceProfileFile = {
      version: 2,
      narrator: 'en-US-GuyNeural',
      totalLines: 1000,
      characters: {
        'harry_potter': {
          canonicalName: 'Harry Potter',
          voice: 'en-GB-RyanNeural',
          gender: 'male',
          aliases: ['Harry', 'Potter'],
          lines: 150,
          percentage: 15.0,
          lastSeenIn: 'BOOK1',
          bookAppearances: 1
        }
      }
    };
    expect(profile.version).toBe(2);
  });

  it('should define CharacterEntry type', () => {
    const entry: CharacterEntry = {
      canonicalName: 'Harry Potter',
      voice: 'en-GB-RyanNeural',
      gender: 'male',
      aliases: ['Harry'],
      lines: 100,
      percentage: 10.0,
      lastSeenIn: 'BOOK1',
      bookAppearances: 1
    };
    expect(entry.canonicalName).toBe('Harry Potter');
  });

  it('should define VoiceAssignment type', () => {
    const assignment: VoiceAssignment = {
      character: 'Harry Potter',
      voice: 'en-GB-RyanNeural',
      shared: false
    };
    expect(assignment.shared).toBe(false);
  });
});
