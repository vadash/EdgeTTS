/**
 * DialogueParser - Detects dialogue and speaker attribution in text
 * Supports both quotation marks ("...") and em-dash (—) Russian-style dialogue
 */

import { inferGender, extractFirstName } from './GenderInference';
import type { DialogueSegment, CharacterInfo, ParsedDialogue } from '../state/types';

export interface DialogueParserOptions {
  language?: 'ru' | 'en' | 'auto';
}

// Attribution verbs in English
const EN_SPEECH_VERBS = [
  'said', 'says', 'asked', 'replied', 'answered', 'whispered', 'shouted',
  'yelled', 'screamed', 'murmured', 'muttered', 'exclaimed', 'declared',
  'announced', 'stated', 'added', 'continued', 'responded', 'called',
  'cried', 'demanded', 'insisted', 'suggested', 'admitted', 'agreed',
  'argued', 'began', 'begged', 'complained', 'confessed', 'confirmed',
];

// Attribution verbs in Russian (with gender variations)
const RU_SPEECH_VERBS = [
  'сказал', 'сказала', 'сказали',
  'ответил', 'ответила', 'ответили',
  'спросил', 'спросила', 'спросили',
  'прошептал', 'прошептала', 'прошептали',
  'воскликнул', 'воскликнула', 'воскликнули',
  'произнёс', 'произнесла', 'произнесли',
  'произнес', 'произнесла', 'произнесли',
  'закричал', 'закричала', 'закричали',
  'пробормотал', 'пробормотала', 'пробормотали',
  'добавил', 'добавила', 'добавили',
  'продолжил', 'продолжила', 'продолжили',
  'начал', 'начала', 'начали',
  'заметил', 'заметила', 'заметили',
  'объяснил', 'объяснила', 'объяснили',
  'подтвердил', 'подтвердила', 'подтвердили',
  'возразил', 'возразила', 'возразили',
  'согласился', 'согласилась', 'согласились',
];

export class DialogueParser {
  private options: DialogueParserOptions;
  private characters: Map<string, CharacterInfo> = new Map();
  private lastSpeakers: string[] = []; // Track recent speakers for alternating dialogue

  constructor(options: DialogueParserOptions = {}) {
    this.options = {
      language: options.language ?? 'auto',
    };
  }

  /**
   * Parse text into dialogue segments with speaker attribution
   */
  parse(text: string): ParsedDialogue {
    this.characters.clear();
    this.lastSpeakers = [];

    const segments: DialogueSegment[] = [];
    let currentIndex = 0;
    let lastMatchEnd = 0;

    // Detect language
    const language: 'ru' | 'en' = this.options.language === 'auto' || !this.options.language
      ? this.detectLanguage(text)
      : this.options.language;

    // Find all dialogue instances
    const dialogueMatches = this.findAllDialogue(text, language);

    for (const match of dialogueMatches) {
      // Add narration before this dialogue
      if (match.start > lastMatchEnd) {
        const narrationText = text.slice(lastMatchEnd, match.start).trim();
        if (narrationText) {
          segments.push({
            text: narrationText,
            speaker: 'narrator',
            speakerType: 'narrator',
            gender: 'unknown',
            originalIndex: currentIndex++,
          });
        }
      }

      // Add the dialogue segment
      const speaker = match.speaker || this.guessAlternatingSpeaker();
      const gender = speaker !== 'unknown' ? this.getOrCreateCharacter(speaker).gender : 'unknown';

      segments.push({
        text: match.dialogue,
        speaker: speaker,
        speakerType: 'character',
        gender: gender,
        originalIndex: currentIndex++,
      });

      // Track speaker for alternating dialogue
      if (speaker !== 'unknown') {
        this.trackSpeaker(speaker);
      }

      lastMatchEnd = match.end;
    }

    // Add remaining narration
    if (lastMatchEnd < text.length) {
      const narrationText = text.slice(lastMatchEnd).trim();
      if (narrationText) {
        segments.push({
          text: narrationText,
          speaker: 'narrator',
          speakerType: 'narrator',
          gender: 'unknown',
          originalIndex: currentIndex++,
        });
      }
    }

    return {
      segments,
      characters: this.characters,
    };
  }

  /**
   * Find all dialogue instances in text
   */
  private findAllDialogue(text: string, language: 'ru' | 'en'): DialogueMatch[] {
    const matches: DialogueMatch[] = [];

    // Find quoted dialogue
    const quotedMatches = this.findQuotedDialogue(text, language);
    matches.push(...quotedMatches);

    // Find em-dash dialogue (Russian style)
    if (language === 'ru' || this.options.language === 'auto') {
      const dashMatches = this.findDashDialogue(text);
      matches.push(...dashMatches);
    }

    // Sort by position and remove overlaps
    matches.sort((a, b) => a.start - b.start);
    return this.removeOverlaps(matches);
  }

  /**
   * Find dialogue in quotation marks with attribution
   */
  private findQuotedDialogue(text: string, language: 'ru' | 'en'): DialogueMatch[] {
    const matches: DialogueMatch[] = [];

    // Match "dialogue" or «dialogue» with optional attribution
    // Supports: "Hello," said John. | "Hello," John said. | John said, "Hello."
    const quotePattern = /["«]([^"»]+)["»]/g;

    let match: RegExpExecArray | null;
    while ((match = quotePattern.exec(text)) !== null) {
      const dialogue = match[1].trim();
      const fullMatchStart = match.index;
      const fullMatchEnd = match.index + match[0].length;

      // Look for attribution after the quote
      const afterText = text.slice(fullMatchEnd, fullMatchEnd + 100);
      const speaker = this.findAttributionAfter(afterText, language) ||
                     this.findAttributionBefore(text.slice(Math.max(0, fullMatchStart - 100), fullMatchStart), language);

      matches.push({
        dialogue,
        speaker: speaker || 'unknown',
        start: fullMatchStart,
        end: fullMatchEnd,
      });
    }

    return matches;
  }

  /**
   * Find Russian-style em-dash dialogue
   * Format: — Dialogue text, — said Character.
   */
  private findDashDialogue(text: string): DialogueMatch[] {
    const matches: DialogueMatch[] = [];

    // Match lines starting with em-dash
    const dashPattern = /(?:^|\n)\s*[—–-]\s*([^—–\n]+?)(?:\s*[—–-]\s*([^.\n]+[^\s]))?(?:\.|$)/gm;

    let match: RegExpExecArray | null;
    while ((match = dashPattern.exec(text)) !== null) {
      const dialogue = match[1].trim();
      const attribution = match[2]?.trim();

      // Extract speaker from attribution
      let speaker = 'unknown';
      if (attribution) {
        speaker = this.extractSpeakerFromAttribution(attribution, 'ru');
      }

      matches.push({
        dialogue,
        speaker,
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return matches;
  }

  /**
   * Find speaker attribution after dialogue
   */
  private findAttributionAfter(text: string, language: 'ru' | 'en'): string | null {
    const verbs = language === 'ru' ? RU_SPEECH_VERBS : EN_SPEECH_VERBS;
    const verbPattern = verbs.join('|');

    // Pattern: ", said Name" or ", Name said"
    const patterns = [
      new RegExp(`^[,.]?\\s*(?:${verbPattern})\\s+([A-ZА-ЯЁ][a-zа-яё]+)`, 'i'),
      new RegExp(`^[,.]?\\s*([A-ZА-ЯЁ][a-zа-яё]+)\\s+(?:${verbPattern})`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return extractFirstName(match[1]);
      }
    }

    return null;
  }

  /**
   * Find speaker attribution before dialogue
   */
  private findAttributionBefore(text: string, language: 'ru' | 'en'): string | null {
    const verbs = language === 'ru' ? RU_SPEECH_VERBS : EN_SPEECH_VERBS;
    const verbPattern = verbs.join('|');

    // Pattern: "Name said," or "said Name,"
    const patterns = [
      new RegExp(`([A-ZА-ЯЁ][a-zа-яё]+)\\s+(?:${verbPattern})[,:]?\\s*$`, 'i'),
      new RegExp(`(?:${verbPattern})\\s+([A-ZА-ЯЁ][a-zа-яё]+)[,:]?\\s*$`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return extractFirstName(match[1]);
      }
    }

    return null;
  }

  /**
   * Extract speaker name from attribution text
   */
  private extractSpeakerFromAttribution(attribution: string, language: 'ru' | 'en'): string {
    const verbs = language === 'ru' ? RU_SPEECH_VERBS : EN_SPEECH_VERBS;
    const verbPattern = verbs.join('|');

    // Try "verb Name" pattern
    const pattern1 = new RegExp(`(?:${verbPattern})\\s+([A-ZА-ЯЁ][a-zа-яё]+)`, 'i');
    const match1 = attribution.match(pattern1);
    if (match1) return extractFirstName(match1[1]);

    // Try "Name verb" pattern
    const pattern2 = new RegExp(`([A-ZА-ЯЁ][a-zа-яё]+)\\s+(?:${verbPattern})`, 'i');
    const match2 = attribution.match(pattern2);
    if (match2) return extractFirstName(match2[1]);

    return 'unknown';
  }

  /**
   * Guess speaker for alternating dialogue (no explicit attribution)
   */
  private guessAlternatingSpeaker(): string {
    if (this.lastSpeakers.length < 2) return 'unknown';

    // Return the speaker who didn't speak last
    return this.lastSpeakers[this.lastSpeakers.length - 2] || 'unknown';
  }

  /**
   * Track a speaker for alternating dialogue detection
   */
  private trackSpeaker(speaker: string): void {
    this.lastSpeakers.push(speaker);
    // Keep only last 2 speakers
    if (this.lastSpeakers.length > 2) {
      this.lastSpeakers.shift();
    }
  }

  /**
   * Get or create character info
   */
  private getOrCreateCharacter(name: string): CharacterInfo {
    if (name === 'unknown' || name === 'narrator') {
      return { name, gender: 'unknown', occurrences: 0 };
    }

    let character = this.characters.get(name);
    if (!character) {
      const gender = inferGender(name);
      character = {
        name,
        gender,
        occurrences: 0,
      };
      this.characters.set(name, character);
    }
    character.occurrences++;
    return character;
  }

  /**
   * Detect primary language of text
   */
  private detectLanguage(text: string): 'ru' | 'en' {
    const cyrillicCount = (text.match(/[А-Яа-яЁё]/g) || []).length;
    const latinCount = (text.match(/[A-Za-z]/g) || []).length;
    return cyrillicCount > latinCount ? 'ru' : 'en';
  }

  /**
   * Remove overlapping matches, keeping earlier ones
   */
  private removeOverlaps(matches: DialogueMatch[]): DialogueMatch[] {
    const result: DialogueMatch[] = [];
    let lastEnd = 0;

    for (const match of matches) {
      if (match.start >= lastEnd) {
        result.push(match);
        lastEnd = match.end;
      }
    }

    return result;
  }
}

interface DialogueMatch {
  dialogue: string;
  speaker: string;
  start: number;
  end: number;
}
