// Service Context for Preact
// Provides React-like context for dependency injection

import { createContext, ComponentChildren } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import { ServiceContainer, ServiceTypes, createContainer } from './ServiceContainer';
import { defaultConfig, type AppConfig } from '@/config';

// Import service implementations
// Note: EdgeTTSService, TTSWorkerPool, AudioMerger, LLMVoiceService, TextProcessor,
// VoiceAssigner, and FileConverter are created per-conversion by the orchestrator,
// not pre-registered in the container.
import { ffmpegService } from '@/services/FFmpegService';
import { encryptValue, decryptValue } from '@/services/SecureStorage';
import { LoggerService } from '@/services/LoggerService';
import { TextBlockSplitter } from '@/services/TextBlockSplitter';
import { VoicePoolBuilder } from '@/services/VoicePoolBuilder';
import { LLMVoiceService } from '@/services/LLMVoiceService';
import { TTSWorkerPool } from '@/services/TTSWorkerPool';
import { AudioMerger } from '@/services/AudioMerger';
import { VoiceAssigner } from '@/services/VoiceAssigner';
import { PipelineRunner } from '@/services/pipeline/PipelineRunner';
import type { LogStore } from '@/stores/LogStore';

import type {
  ILogger,
  ISecureStorage,
  IFFmpegService,
  ITextBlockSplitter,
  IVoicePoolBuilder,
  ILLMServiceFactory,
  IWorkerPoolFactory,
  IAudioMergerFactory,
  LLMServiceFactoryOptions,
  WorkerPoolOptions,
  MergerConfig,
} from '@/services/interfaces';
import type { IPipelineRunner } from '@/services/pipeline/types';

// ============================================================================
// Context Definition
// ============================================================================

const ServiceContext = createContext<ServiceContainer | null>(null);

interface ServiceProviderProps {
  container: ServiceContainer;
  children: ComponentChildren;
}

/**
 * Provider component that makes the service container available to all children
 */
export function ServiceProvider({ container, children }: ServiceProviderProps) {
  return (
    <ServiceContext.Provider value={container}>
      {children}
    </ServiceContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to get the service container
 * @throws Error if used outside ServiceProvider
 */
export function useServices(): ServiceContainer {
  const container = useContext(ServiceContext);
  if (!container) {
    throw new Error('useServices must be used within a ServiceProvider');
  }
  return container;
}

/**
 * Hook to get a specific service by token
 * @throws Error if service not registered
 */
export function useService<T>(token: symbol): T {
  const container = useServices();
  return useMemo(() => container.get<T>(token), [container, token]);
}

/**
 * Hook to get the app configuration
 */
export function useConfig(): AppConfig {
  return useService<AppConfig>(ServiceTypes.Config);
}

/**
 * Hook to get the logger service
 */
export function useLogger(): ILogger {
  return useService<ILogger>(ServiceTypes.Logger);
}

// ============================================================================
// Console Logger (Default Implementation)
// ============================================================================

/**
 * Simple console logger implementation
 * Used as default before LogStore is available
 */
class ConsoleLogger implements ILogger {
  debug(message: string, data?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[DEBUG] ${message}`, data ?? '');
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    console.log(`[INFO] ${message}`, data ?? '');
  }

  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(`[WARN] ${message}`, data ?? '');
  }

  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    console.error(`[ERROR] ${message}`, error ?? '', data ?? '');
  }
}

// ============================================================================
// Secure Storage Adapter
// ============================================================================

/**
 * Adapter wrapping the existing SecureStorage functions
 */
class SecureStorageAdapter implements ISecureStorage {
  private static readonly STORAGE_KEY = 'llm_api_key_encrypted';
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger;
  }

  async saveApiKey(key: string): Promise<void> {
    const encrypted = await encryptValue(key);
    localStorage.setItem(SecureStorageAdapter.STORAGE_KEY, encrypted);
  }

  async loadApiKey(): Promise<string> {
    const encrypted = localStorage.getItem(SecureStorageAdapter.STORAGE_KEY);
    if (!encrypted) return '';
    return decryptValue(encrypted, this.logger);
  }

  async clearApiKey(): Promise<void> {
    localStorage.removeItem(SecureStorageAdapter.STORAGE_KEY);
  }
}

// ============================================================================
// FFmpeg Service Adapter
// ============================================================================

/**
 * Adapter wrapping the singleton FFmpegService
 */
class FFmpegServiceAdapter implements IFFmpegService {
  load(onProgress?: (message: string) => void): Promise<boolean> {
    return ffmpegService.load(onProgress);
  }

  isAvailable(): boolean {
    return ffmpegService.isAvailable();
  }

  getLoadError(): string | null {
    return ffmpegService.getLoadError();
  }

  processAudio(
    chunks: Uint8Array[],
    config: { silenceRemoval: boolean; normalization: boolean },
    onProgress?: (message: string) => void
  ): Promise<Uint8Array> {
    return ffmpegService.processAudio(chunks, config, onProgress);
  }

  terminate(): void {
    ffmpegService.terminate();
  }
}

// ============================================================================
// Container Factories
// ============================================================================

/**
 * Create a production service container with all real implementations
 */
export function createProductionContainer(
  logStore?: LogStore,
  config: AppConfig = defaultConfig
): ServiceContainer {
  const container = createContainer();

  // Register configuration
  container.registerInstance(ServiceTypes.Config, config);

  // Register logger (singleton) - use LoggerService if logStore provided
  if (logStore) {
    container.registerSingleton(ServiceTypes.Logger, () => new LoggerService(logStore));
  } else {
    container.registerSingleton(ServiceTypes.Logger, () => new ConsoleLogger());
  }

  // Register secure storage (singleton) - needs logger
  container.registerSingleton(ServiceTypes.SecureStorage, () => {
    const logger = container.get<ILogger>(ServiceTypes.Logger);
    return new SecureStorageAdapter(logger);
  });

  // Register FFmpeg service (singleton - wraps existing singleton)
  container.registerSingleton(ServiceTypes.FFmpegService, () => new FFmpegServiceAdapter());

  // Register TextBlockSplitter (singleton)
  container.registerSingleton<ITextBlockSplitter>(
    ServiceTypes.TextBlockSplitter,
    () => new TextBlockSplitter()
  );

  // Register VoicePoolBuilder (singleton)
  container.registerSingleton<IVoicePoolBuilder>(
    ServiceTypes.VoicePoolBuilder,
    () => new VoicePoolBuilder()
  );

  // Register PipelineRunner (transient - new instance per conversion)
  container.registerTransient<IPipelineRunner>(
    ServiceTypes.PipelineRunner,
    () => new PipelineRunner(container.get<ILogger>(ServiceTypes.Logger))
  );

  // Register factories for per-conversion services
  container.registerSingleton<ILLMServiceFactory>(
    ServiceTypes.LLMServiceFactory,
    () => ({
      create: (options: LLMServiceFactoryOptions) => new LLMVoiceService(options),
    })
  );

  container.registerSingleton<IWorkerPoolFactory>(
    ServiceTypes.WorkerPoolFactory,
    () => ({
      create: (options: WorkerPoolOptions) => new TTSWorkerPool(options),
    })
  );

  container.registerSingleton<IAudioMergerFactory>(
    ServiceTypes.AudioMergerFactory,
    () => ({
      create: (cfg: MergerConfig) => new AudioMerger(cfg),
    })
  );

  return container;
}

/**
 * Service map for test overrides
 */
export interface ServiceOverrides {
  config?: AppConfig;
  logger?: ILogger;
  secureStorage?: ISecureStorage;
  ffmpegService?: IFFmpegService;
  // Add more as needed
}

/**
 * Create a test service container with optional mock overrides
 */
export function createTestContainer(overrides: ServiceOverrides = {}): ServiceContainer {
  const container = createContainer();

  // Register configuration
  container.registerInstance(
    ServiceTypes.Config,
    overrides.config ?? defaultConfig
  );

  // Register logger
  if (overrides.logger) {
    container.registerInstance(ServiceTypes.Logger, overrides.logger);
  } else {
    container.registerSingleton(ServiceTypes.Logger, () => new ConsoleLogger());
  }

  // Register secure storage
  if (overrides.secureStorage) {
    container.registerInstance(ServiceTypes.SecureStorage, overrides.secureStorage);
  } else {
    container.registerSingleton(ServiceTypes.SecureStorage, () => {
      const logger = container.get<ILogger>(ServiceTypes.Logger);
      return new SecureStorageAdapter(logger);
    });
  }

  // Register FFmpeg service
  if (overrides.ffmpegService) {
    container.registerInstance(ServiceTypes.FFmpegService, overrides.ffmpegService);
  } else {
    container.registerSingleton(ServiceTypes.FFmpegService, () => new FFmpegServiceAdapter());
  }

  return container;
}

// Re-export types and tokens
export { ServiceTypes } from './ServiceContainer';
export type { ServiceContainer } from './ServiceContainer';
