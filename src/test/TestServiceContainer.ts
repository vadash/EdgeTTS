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

  // Register mock services using the actual ServiceContainer API
  container.registerTransient(ServiceTypes.TTSService, () => mocks.tts);
  container.registerTransient(ServiceTypes.WorkerPool, () => mocks.workerPool);
  container.registerInstance(ServiceTypes.LLMService, mocks.llm);
  container.registerInstance(ServiceTypes.FFmpegService, mocks.ffmpeg);
  container.registerInstance(ServiceTypes.Logger, mocks.logger);
  container.registerInstance(ServiceTypes.SecureStorage, mocks.secureStorage);
  container.registerInstance(ServiceTypes.Config, defaultConfig);

  return { container, mocks };
}
