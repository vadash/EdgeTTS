// Test Service Container
// Factory for creating test containers with mock services

import { ServiceContainer, ServiceTypes } from '@/di/ServiceContainer';
import { MockTTSService, createMockTTSService } from './mocks/MockTTSService';
import { MockWorkerPool, createMockWorkerPool } from './mocks/MockWorkerPool';
import { MockLLMService, createMockLLMService } from './mocks/MockLLMService';
import { MockFFmpegService, createMockFFmpegService } from './mocks/MockFFmpegService';
import { MockLogger, createMockLogger } from './mocks/MockLogger';
import { MockSecureStorage, createMockSecureStorage } from './mocks/MockSecureStorage';
import { defaultConfig } from '@/config';
import { TextBlockSplitter } from '@/services/TextBlockSplitter';
import { VoicePoolBuilder } from '@/services/VoicePoolBuilder';
import type { ConversionOrchestratorServices } from '@/services/ConversionOrchestrator';
import { LLMVoiceService } from '@/services/llm/LLMVoiceService';
import { TTSWorkerPool } from '@/services/TTSWorkerPool';
import { AudioMerger } from '@/services/AudioMerger';
import type { WorkerPoolOptions } from '@/services/TTSWorkerPool';
import type { MergerConfig } from '@/services/AudioMerger';
import type { LLMServiceFactoryOptions } from '@/services/llm/LLMVoiceService';

export interface MockServices {
  tts: MockTTSService;
  workerPool: MockWorkerPool;
  llm: MockLLMService;
  ffmpeg: MockFFmpegService;
  logger: MockLogger;
  secureStorage: MockSecureStorage;
}

export interface TestContainerOptions {
  tts?: MockTTSService;
  workerPool?: MockWorkerPool;
  llm?: MockLLMService;
  ffmpeg?: MockFFmpegService;
  logger?: MockLogger;
  secureStorage?: MockSecureStorage;
}

/**
 * Create a service container with mock services for testing
 */
export function createTestContainer(options: TestContainerOptions = {}): {
  container: ServiceContainer;
  mocks: MockServices;
} {
  const container = new ServiceContainer();

  const mocks: MockServices = {
    tts: options.tts || createMockTTSService(),
    workerPool: options.workerPool || createMockWorkerPool(),
    llm: options.llm || createMockLLMService(),
    ffmpeg: options.ffmpeg || createMockFFmpegService(),
    logger: options.logger || createMockLogger(),
    secureStorage: options.secureStorage || createMockSecureStorage(),
  };

  // Core services
  container.registerInstance(ServiceTypes.Config, defaultConfig);
  container.registerInstance(ServiceTypes.Logger, mocks.logger);
  container.registerInstance(ServiceTypes.SecureStorage, mocks.secureStorage);
  container.registerInstance(ServiceTypes.FFmpegService, mocks.ffmpeg);

  // Utility services
  container.registerSingleton<TextBlockSplitter>(
    ServiceTypes.TextBlockSplitter,
    () => new TextBlockSplitter()
  );
  container.registerSingleton<VoicePoolBuilder>(
    ServiceTypes.VoicePoolBuilder,
    () => new VoicePoolBuilder()
  );

  // Factories - return mock services
  container.registerSingleton<{ create: (options: LLMServiceFactoryOptions) => LLMVoiceService }>(
    ServiceTypes.LLMServiceFactory,
    () => ({
      create: () => mocks.llm,
    })
  );

  container.registerSingleton<{ create: (options: WorkerPoolOptions) => TTSWorkerPool }>(
    ServiceTypes.WorkerPoolFactory,
    () => ({
      create: () => mocks.workerPool,
    })
  );

  container.registerSingleton<{ create: (config: MergerConfig) => AudioMerger }>(
    ServiceTypes.AudioMergerFactory,
    () => ({
      create: () => ({
        calculateMergeGroups: () => [],
        mergeAndSave: async () => 0,
      }),
    })
  );

  // Orchestrator services bundle
  container.registerSingleton<ConversionOrchestratorServices>(
    ServiceTypes.ConversionOrchestratorServices,
    () => ({
      logger: mocks.logger,
      textBlockSplitter: new TextBlockSplitter(),
      llmServiceFactory: {
        create: () => mocks.llm,
      },
      workerPoolFactory: {
        create: () => mocks.workerPool,
      },
      audioMergerFactory: {
        create: () => ({
          calculateMergeGroups: () => [],
          mergeAndSave: async () => 0,
        }),
      },
      voicePoolBuilder: new VoicePoolBuilder(),
      ffmpegService: mocks.ffmpeg,
    })
  );

  return { container, mocks };
}
