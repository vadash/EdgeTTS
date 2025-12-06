// Default Step Registry
// Registers all built-in pipeline steps

import { StepRegistry, createStepRegistry } from './StepRegistry';
import {
  CharacterExtractionStep,
  type CharacterExtractionStepOptions,
  VoiceAssignmentStep,
  type VoiceAssignmentStepOptions,
  SpeakerAssignmentStep,
  type SpeakerAssignmentStepOptions,
  VoiceRemappingStep,
  type VoiceRemappingStepOptions,
  TextSanitizationStep,
  DictionaryProcessingStep,
  type DictionaryProcessingStepOptions,
  TTSConversionStep,
  type TTSConversionStepOptions,
  AudioMergeStep,
  type AudioMergeStepOptions,
  SaveStep,
  type SaveStepOptions,
} from './steps';

/**
 * Step names as constants for type-safety
 */
export const StepNames = {
  CHARACTER_EXTRACTION: 'character-extraction',
  VOICE_ASSIGNMENT: 'voice-assignment',
  SPEAKER_ASSIGNMENT: 'speaker-assignment',
  VOICE_REMAPPING: 'voice-remapping',
  TEXT_SANITIZATION: 'text-sanitization',
  DICTIONARY_PROCESSING: 'dictionary-processing',
  TTS_CONVERSION: 'tts-conversion',
  AUDIO_MERGE: 'audio-merge',
  SAVE: 'save',
} as const;

export type StepName = typeof StepNames[keyof typeof StepNames];

/**
 * Create a step registry with all built-in steps registered
 */
export function createDefaultStepRegistry(): StepRegistry {
  const registry = createStepRegistry();

  registry.register<CharacterExtractionStepOptions>(
    StepNames.CHARACTER_EXTRACTION,
    (options) => new CharacterExtractionStep(options),
    'Extracts characters from text using LLM (Extract)'
  );

  registry.register<VoiceAssignmentStepOptions>(
    StepNames.VOICE_ASSIGNMENT,
    (options) => new VoiceAssignmentStep(options),
    'Assigns voices to detected characters'
  );

  registry.register<SpeakerAssignmentStepOptions>(
    StepNames.SPEAKER_ASSIGNMENT,
    (options) => new SpeakerAssignmentStep(options),
    'Assigns speakers to sentences using LLM (Assign)'
  );

  registry.register<VoiceRemappingStepOptions>(
    StepNames.VOICE_REMAPPING,
    (options) => new VoiceRemappingStep(options),
    'Remaps voices based on speaking frequency'
  );

  registry.register<Record<string, never>>(
    StepNames.TEXT_SANITIZATION,
    () => new TextSanitizationStep(),
    'Sanitizes text by removing non-speakable symbols'
  );

  registry.register<DictionaryProcessingStepOptions>(
    StepNames.DICTIONARY_PROCESSING,
    (options) => new DictionaryProcessingStep(options),
    'Applies dictionary rules to text'
  );

  registry.register<TTSConversionStepOptions>(
    StepNames.TTS_CONVERSION,
    (options) => new TTSConversionStep(options),
    'Converts text to audio using TTS'
  );

  registry.register<AudioMergeStepOptions>(
    StepNames.AUDIO_MERGE,
    (options) => new AudioMergeStep(options),
    'Merges audio chunks into final files'
  );

  registry.register<SaveStepOptions>(
    StepNames.SAVE,
    (options) => new SaveStep(options),
    'Saves merged files to disk'
  );

  return registry;
}
