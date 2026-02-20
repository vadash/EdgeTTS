/**
 * VoiceAssigner - Assigns unique voices to characters based on gender
 */

import type { VoicePool, CharacterInfo, LLMCharacter } from '../state/types';
import type { DetectedLanguage } from '../utils/languageDetection';
import type { IVoiceAssigner, IVoicePoolBuilder, VoiceAssignerOptions as IVoiceAssignerOptions } from './interfaces';

export interface VoiceAssignment {
  character: string;
  voice: string;
  gender: 'male' | 'female' | 'unknown';
}

export interface VoiceAssignerOptions {
  narratorVoice: string;
  locale?: string;
  voicePool?: VoicePool;
}

/**
 * VoiceAssigner - Implements IVoiceAssigner interface
 * Receives IVoicePoolBuilder via constructor for testability
 */
export class VoiceAssigner implements IVoiceAssigner {
  private voicePoolBuilder: IVoicePoolBuilder;
  private assignments: Map<string, VoiceAssignment> = new Map();
  private usedVoices: Set<string> = new Set();
  private options: VoiceAssignerOptions;
  private voicePool: VoicePool;

  constructor(voicePoolBuilder: IVoicePoolBuilder, options: VoiceAssignerOptions) {
    this.voicePoolBuilder = voicePoolBuilder;
    this.options = options;
    this.voicePool = options.voicePool ?? this.voicePoolBuilder.buildPool(options.locale ?? 'en');

    // Reserve narrator voice
    this.usedVoices.add(options.narratorVoice);
  }

  /**
   * Assign a voice to a character
   */
  assignVoice(character: string, gender: 'male' | 'female' | 'unknown'): string {
    // Check if already assigned
    const existing = this.assignments.get(character);
    if (existing) {
      return existing.voice;
    }

    // Select a voice based on gender
    const voice = this.selectVoiceByGender(gender);

    // Store assignment
    this.assignments.set(character, {
      character,
      voice,
      gender,
    });

    this.usedVoices.add(voice);
    return voice;
  }

  /**
   * Get the voice for a character (assigns if not exists)
   */
  getVoiceForCharacter(character: string, gender: 'male' | 'female' | 'unknown' = 'unknown'): string {
    const existing = this.assignments.get(character);
    if (existing) {
      return existing.voice;
    }
    return this.assignVoice(character, gender);
  }

  /**
   * Get narrator voice
   */
  getNarratorVoice(): string {
    return this.options.narratorVoice;
  }

  /**
   * Get all voice assignments
   */
  getAllAssignments(): Map<string, string> {
    const result = new Map<string, string>();
    for (const [character, assignment] of this.assignments) {
      result.set(character, assignment.voice);
    }
    return result;
  }

  /**
   * Assign voices to characters from LLM extraction result
   * Returns a map of canonical name -> voice ID
   */
  assignVoicesFromLLMCharacters(characters: LLMCharacter[]): Map<string, string> {
    const result = new Map<string, string>();

    // Sort by number of variations (more variations = more prominent character)
    const sorted = [...characters].sort((a, b) => b.variations.length - a.variations.length);

    for (const char of sorted) {
      const voice = this.assignVoice(char.canonicalName, char.gender);
      result.set(char.canonicalName, voice);

      // Also map all variations to the same voice
      for (const variation of char.variations) {
        if (variation !== char.canonicalName) {
          result.set(variation, voice);
        }
      }
    }

    // Add unnamed speaker voices
    this.addUnnamedSpeakerVoices(result);

    return result;
  }

  /**
   * Add voices for unnamed speakers (MALE_UNNAMED, FEMALE_UNNAMED, UNKNOWN_UNNAMED)
   */
  private addUnnamedSpeakerVoices(voiceMap: Map<string, string>): void {
    // Assign 3 voices for each gender category (for variety)
    const maleVoices: string[] = [];
    const femaleVoices: string[] = [];
    const unknownVoices: string[] = [];

    for (let i = 0; i < 3; i++) {
      maleVoices.push(this.selectVoiceByGender('male'));
      femaleVoices.push(this.selectVoiceByGender('female'));
      unknownVoices.push(this.selectVoiceByGender('unknown'));
    }

    // Use first voice for the unnamed categories
    voiceMap.set('MALE_UNNAMED', maleVoices[0]);
    voiceMap.set('FEMALE_UNNAMED', femaleVoices[0]);
    voiceMap.set('UNKNOWN_UNNAMED', unknownVoices[0]);
  }

  /**
   * Create a VoiceAssigner with filtered pool (detected language + multilingual)
   */
  static createWithFilteredPool(
    voicePoolBuilder: IVoicePoolBuilder,
    narratorVoice: string,
    language: string = 'en',
    enabledVoices?: string[]
  ): VoiceAssigner {
    return new VoiceAssigner(voicePoolBuilder, {
      narratorVoice,
      voicePool: voicePoolBuilder.buildPool(language, enabledVoices),
    });
  }

  /**
   * Select a voice based on gender, avoiding already used voices
   */
  private selectVoiceByGender(gender: 'male' | 'female' | 'unknown'): string {
    let pool: string[];

    switch (gender) {
      case 'male':
        pool = this.voicePool.male;
        break;
      case 'female':
        pool = this.voicePool.female;
        break;
      default:
        // For unknown gender, alternate between male and female
        const maleAssigned = Array.from(this.assignments.values()).filter(a => a.gender === 'male').length;
        const femaleAssigned = Array.from(this.assignments.values()).filter(a => a.gender === 'female').length;
        pool = maleAssigned <= femaleAssigned ? this.voicePool.male : this.voicePool.female;
    }

    // Filter out used voices
    const available = pool.filter(v => !this.usedVoices.has(v));

    // If all voices used, reuse from full pool
    if (available.length === 0) {
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // Return random available voice
    return available[Math.floor(Math.random() * available.length)];
  }

  /**
   * Reset all assignments
   */
  reset(): void {
    this.assignments.clear();
    this.usedVoices.clear();
    this.usedVoices.add(this.options.narratorVoice);
  }

  /**
   * Override a voice assignment
   */
  overrideVoice(character: string, voice: string): void {
    const existing = this.assignments.get(character);
    if (existing) {
      // Remove old voice from used
      this.usedVoices.delete(existing.voice);
    }

    this.assignments.set(character, {
      character,
      voice,
      gender: existing?.gender ?? 'unknown',
    });

    this.usedVoices.add(voice);
  }
}
