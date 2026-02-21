// Service Context for Preact
// Provides React-like context for dependency injection

import { createContext, ComponentChildren } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import { ServiceContainer, ServiceTypes, createContainer } from './ServiceContainer';
import { defaultConfig, type AppConfig } from '@/config';
import { StorageKeys } from '@/config/storage';

// Import service implementations
// Note: EdgeTTSService, TTSWorkerPool, AudioMerger, LLMVoiceService,
// and FileConverter are created per-conversion by the orchestrator,
// not pre-registered in the container.
import { FFmpegService } from '@/services/FFmpegService';
import { encryptValue, decryptValue } from '@/services/SecureStorage';
import { LoggerService, type ILogger } from '@/services/LoggerService';
import { TextBlockSplitter } from '@/services/TextBlockSplitter';
import { VoicePoolBuilder } from '@/services/VoicePoolBuilder';
import { LLMVoiceService } from '@/services/llm';
import { TTSWorkerPool, type WorkerPoolOptions } from '@/services/TTSWorkerPool';
import { AudioMerger, type MergerConfig } from '@/services/AudioMerger';
import { ReusableEdgeTTSService } from '@/services/ReusableEdgeTTSService';
import type { LogStore } from '@/stores/LogStore';
import type { LLMServiceFactoryOptions } from '@/services/llm/LLMVoiceService';
import type { ConversionOrchestratorServices } from '@/services/ConversionOrchestrator';

// ============================================================================
// Factory Types
// ============================================================================

export interface ISecureStorage {
  saveApiKey(key: string): Promise<void>;
  loadApiKey(): Promise<string>;
  clearApiKey(): Promise<void>;
}

export interface ILLMServiceFactory {
  create(options: LLMServiceFactoryOptions): LLMVoiceService;
}

export interface IWorkerPoolFactory {
  create(options: WorkerPoolOptions): TTSWorkerPool;
}

export interface IAudioMergerFactory {
  create(config: MergerConfig): AudioMerger;
}

export interface IReusableTTSServiceFactory {
  create(): ReusableEdgeTTSService;
}

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
export function useLogger(): LoggerService {
  return useService<LoggerService>(ServiceTypes.Logger);
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
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger;
  }

  async saveApiKey(key: string): Promise<void> {
    const encrypted = await encryptValue(key);
    localStorage.setItem(StorageKeys.encryptedApiKey, encrypted);
  }

  async loadApiKey(): Promise<string> {
    const encrypted = localStorage.getItem(StorageKeys.encryptedApiKey);
    if (!encrypted) return '';
    return decryptValue(encrypted, this.logger);
  }

  async clearApiKey(): Promise<void> {
    localStorage.removeItem(StorageKeys.encryptedApiKey);
  }
}

// Note: FFmpegServiceAdapter removed - FFmpegService now implements IFFmpegService directly

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

  // Register FFmpeg service (singleton)
  container.registerSingleton<FFmpegService>(ServiceTypes.FFmpegService, () => {
    const logger = container.get<LoggerService>(ServiceTypes.Logger);
    return new FFmpegService(logger);
  });

  // Register TextBlockSplitter (singleton)
  container.registerSingleton<TextBlockSplitter>(
    ServiceTypes.TextBlockSplitter,
    () => new TextBlockSplitter()
  );

  // Register VoicePoolBuilder (singleton)
  container.registerSingleton<VoicePoolBuilder>(
    ServiceTypes.VoicePoolBuilder,
    () => new VoicePoolBuilder()
  );

  // Register TTS Preview Service (singleton for UI voice samples)
  // Uses ReusableEdgeTTSService to avoid rate limiting from repeated sample plays
  container.registerSingleton<ReusableEdgeTTSService>(
    ServiceTypes.TTSPreviewService,
    () => {
      const logger = container.get<LoggerService>(ServiceTypes.Logger);
      return new ReusableEdgeTTSService(logger);
    }
  );

  // Register factories for per-conversion services
  container.registerSingleton<ILLMServiceFactory>(
    ServiceTypes.LLMServiceFactory,
    () => {
      const logger = container.get<LoggerService>(ServiceTypes.Logger);
      return {
        create: (options: LLMServiceFactoryOptions) => new LLMVoiceService({ ...options, logger }),
      };
    }
  );

  // Register worker pool factory
  container.registerSingleton<IWorkerPoolFactory>(
    ServiceTypes.WorkerPoolFactory,
    () => ({
      create: (options: WorkerPoolOptions) => new TTSWorkerPool(options),
    })
  );

  // Register audio merger factory (injects FFmpegService)
  container.registerSingleton<IAudioMergerFactory>(
    ServiceTypes.AudioMergerFactory,
    () => {
      const ffmpeg = container.get<FFmpegService>(ServiceTypes.FFmpegService);
      return {
        create: (cfg: MergerConfig) => new AudioMerger(ffmpeg, cfg),
      };
    }
  );

  // Register ConversionOrchestrator services bundle (for easy injection)
  container.registerSingleton<ConversionOrchestratorServices>(
    ServiceTypes.ConversionOrchestratorServices,
    () => ({
      logger: container.get<LoggerService>(ServiceTypes.Logger),
      textBlockSplitter: container.get<TextBlockSplitter>(ServiceTypes.TextBlockSplitter),
      llmServiceFactory: container.get<ILLMServiceFactory>(ServiceTypes.LLMServiceFactory),
      workerPoolFactory: container.get<IWorkerPoolFactory>(ServiceTypes.WorkerPoolFactory),
      audioMergerFactory: container.get<IAudioMergerFactory>(ServiceTypes.AudioMergerFactory),
      voicePoolBuilder: container.get<VoicePoolBuilder>(ServiceTypes.VoicePoolBuilder),
      ffmpegService: container.get<FFmpegService>(ServiceTypes.FFmpegService),
    })
  );

  return container;
}

/**
 * Service map for test overrides
 */
export interface ServiceOverrides {
  config?: AppConfig;
  logger?: LoggerService;
  secureStorage?: ISecureStorage;
  ffmpegService?: FFmpegService;
  voicePoolBuilder?: VoicePoolBuilder;
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
    container.registerSingleton<FFmpegService>(ServiceTypes.FFmpegService, () => {
      const logger = container.get<LoggerService>(ServiceTypes.Logger);
      return new FFmpegService(logger);
    });
  }

  // Register VoicePoolBuilder
  if (overrides.voicePoolBuilder) {
    container.registerInstance(ServiceTypes.VoicePoolBuilder, overrides.voicePoolBuilder);
  } else {
    container.registerSingleton<VoicePoolBuilder>(
      ServiceTypes.VoicePoolBuilder,
      () => new VoicePoolBuilder()
    );
  }

  return container;
}

// Re-export types and tokens
export { ServiceTypes } from './ServiceContainer';
export type { ServiceContainer } from './ServiceContainer';
