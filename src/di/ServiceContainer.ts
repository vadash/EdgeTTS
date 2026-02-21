// Dependency Injection Container (InversifyJS-lite pattern)
// Provides service registration and resolution with symbol-based tokens

/**
 * Service tokens for dependency injection
 */
export const ServiceTypes = {
  // Core singleton services
  FFmpegService: Symbol.for('IFFmpegService'),
  Logger: Symbol.for('ILogger'),
  SecureStorage: Symbol.for('ISecureStorage'),
  FileConverter: Symbol.for('IFileConverter'),
  TextBlockSplitter: Symbol.for('ITextBlockSplitter'),
  VoicePoolBuilder: Symbol.for('IVoicePoolBuilder'),
  TTSPreviewService: Symbol.for('ITTSPreviewService'),

  // Orchestrator services bundle
  ConversionOrchestratorServices: Symbol.for('ConversionOrchestratorServices'),

  // Factories (for creating per-conversion instances)
  LLMServiceFactory: Symbol.for('ILLMServiceFactory'),
  WorkerPoolFactory: Symbol.for('IWorkerPoolFactory'),
  AudioMergerFactory: Symbol.for('IAudioMergerFactory'),
  EdgeTTSServiceFactory: Symbol.for('IEdgeTTSServiceFactory'),

  // Configuration
  Config: Symbol.for('AppConfig'),
} as const;

/**
 * Factory function type for creating service instances
 */
export type ServiceFactory<T> = (container: ServiceContainer) => T;

/**
 * Registration entry in the container
 */
interface ServiceRegistration<T = unknown> {
  /** Singleton instance (if registered) */
  instance?: T;
  /** Factory function (if registered) */
  factory?: ServiceFactory<T>;
  /** Whether this is a singleton (instance is cached) */
  isSingleton: boolean;
}

/**
 * Lightweight DI container inspired by InversifyJS
 *
 * Supports:
 * - Singleton registration (single instance for lifetime of container)
 * - Factory registration (new instance on each get)
 * - Transient registration (factory that creates new instance each time)
 * - Type-safe service resolution via symbols
 */
export class ServiceContainer {
  private registrations = new Map<symbol, ServiceRegistration>();
  private resolving = new Set<symbol>(); // Circular dependency detection

  /**
   * Register a singleton instance
   * The same instance is returned on every get()
   */
  registerInstance<T>(token: symbol, instance: T): this {
    this.registrations.set(token, {
      instance,
      isSingleton: true,
    });
    return this;
  }

  /**
   * Register a singleton factory
   * Factory is called once, then instance is cached
   */
  registerSingleton<T>(token: symbol, factory: ServiceFactory<T>): this {
    this.registrations.set(token, {
      factory,
      isSingleton: true,
    });
    return this;
  }

  /**
   * Register a transient factory
   * Factory is called on every get(), creating new instances
   */
  registerTransient<T>(token: symbol, factory: ServiceFactory<T>): this {
    this.registrations.set(token, {
      factory,
      isSingleton: false,
    });
    return this;
  }

  /**
   * Get a service by its token
   * @throws Error if service not registered or circular dependency detected
   */
  get<T>(token: symbol): T {
    const registration = this.registrations.get(token);

    if (!registration) {
      throw new Error(`Service not registered: ${token.toString()}`);
    }

    // Return cached singleton instance
    if (registration.isSingleton && registration.instance !== undefined) {
      return registration.instance as T;
    }

    // No factory means it was registered as instance-only but instance is missing
    if (!registration.factory) {
      throw new Error(`Service has no factory and no instance: ${token.toString()}`);
    }

    // Circular dependency detection
    if (this.resolving.has(token)) {
      throw new Error(`Circular dependency detected: ${token.toString()}`);
    }

    this.resolving.add(token);

    try {
      const instance = registration.factory(this) as T;

      // Cache singleton instances
      if (registration.isSingleton) {
        registration.instance = instance;
      }

      return instance;
    } finally {
      this.resolving.delete(token);
    }
  }

  /**
   * Check if a service is registered
   */
  has(token: symbol): boolean {
    return this.registrations.has(token);
  }

  /**
   * Unregister a service
   */
  unregister(token: symbol): boolean {
    return this.registrations.delete(token);
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.registrations.clear();
    this.resolving.clear();
  }
}

/**
 * Create a new service container
 */
export function createContainer(): ServiceContainer {
  return new ServiceContainer();
}
