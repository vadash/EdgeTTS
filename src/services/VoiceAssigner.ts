/**
 * VoiceAssigner - Assigns unique voices to characters based on gender
 */

import { buildVoicePool, getRandomVoice } from './VoicePoolBuilder';
import type { VoicePool, CharacterInfo } from '../state/types';

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

export class VoiceAssigner {
  private assignments: Map<string, VoiceAssignment> = new Map();
  private usedVoices: Set<string> = new Set();
  private options: VoiceAssignerOptions;
  private voicePool: VoicePool;

  constructor(options: VoiceAssignerOptions) {
    this.options = options;
    this.voicePool = options.voicePool ?? buildVoicePool(options.locale);

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
   * Assign voices to all characters from parsed dialogue
   */
  assignVoicesFromCharacters(characters: Map<string, CharacterInfo>): void {
    // Sort by occurrences (more frequent characters get assigned first for better variety)
    const sorted = Array.from(characters.entries())
      .sort((a, b) => b[1].occurrences - a[1].occurrences);

    for (const [name, info] of sorted) {
      this.assignVoice(name, info.gender);
    }
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
