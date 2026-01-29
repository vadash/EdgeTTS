import { describe, it, expect } from 'vitest';
import { sortVoicesByPriority } from './VoiceMappingService';
import type { VoiceOption } from '@/state/types';

describe('sortVoicesByPriority', () => {
  const voices: VoiceOption[] = [
    { locale: 'de-DE', name: 'ConradNeural', fullValue: 'de-DE, ConradNeural', gender: 'male' },
    { locale: 'en-US', name: 'GuyNeural', fullValue: 'en-US, GuyNeural', gender: 'male' },
    { locale: 'ru-RU', name: 'DmitryNeural', fullValue: 'ru-RU, DmitryNeural', gender: 'male' },
    { locale: 'en-GB', name: 'RyanNeural', fullValue: 'en-GB, RyanNeural', gender: 'male' },
  ];

  it('puts book language voices first for English book', () => {
    const sorted = sortVoicesByPriority(voices, 'en', 'de-DE, ConradNeural');
    expect(sorted[0].locale).toBe('en-GB');
    expect(sorted[1].locale).toBe('en-US');
  });

  it('puts book language voices first for Russian book', () => {
    const sorted = sortVoicesByPriority(voices, 'ru', 'de-DE, ConradNeural');
    expect(sorted[0].locale).toBe('ru-RU');
  });

  it('excludes narrator voice from the list', () => {
    const sorted = sortVoicesByPriority(voices, 'en', 'en-US, GuyNeural');
    expect(sorted.find(v => v.fullValue === 'en-US, GuyNeural')).toBeUndefined();
  });
});
