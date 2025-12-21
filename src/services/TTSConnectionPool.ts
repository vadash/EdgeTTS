// TTSConnectionPool - Manages a pool of reusable WebSocket connections
// Reduces rate-limiting by reusing connections instead of creating new ones
// Includes CircuitBreaker pattern for rate limiting protection

import { ReusableEdgeTTSService, type ConnectionState } from './ReusableEdgeTTSService';
import { isRetriableError, RetriableError } from '@/errors';
import type { TTSConfig } from '@/state/types';
import type { ILogger } from './interfaces';

export interface PooledConnection {
  id: number;
  service: ReusableEdgeTTSService;
  inUse: boolean;
  lastUsed: number;
  errorCount: number;
  createdAt: number;
}

export interface ConnectionPoolOptions {
  maxConnections: number;
  logger?: ILogger;
}

export interface SendRequest {
  text: string;
  config: TTSConfig;
  requestId?: string;
}

/**
 * CircuitBreaker states
 */
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * CircuitBreaker configuration
 */
interface CircuitBreakerConfig {
  failureThreshold: number;   // Failures before opening (default 30)
  successThreshold: number;   // Successes to close from half-open (default 3)
  openDuration: number;       // How long to stay open (default 5 minutes)
}

/**
 * Pending connection request for event-driven queue
 */
interface PendingRequest {
  resolve: (connection: PooledConnection) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * TTSConnectionPool - Manages a pool of reusable WebSocket connections
 *
 * Benefits:
 * - Reduces handshake latency (connections are pre-established)
 * - Prevents rate-limiting (fewer new connections)
 * - Efficient resource usage (connections are reused)
 * - CircuitBreaker pattern for rate limiting protection
 * - Event-driven connection queue (no polling)
 */
export class TTSConnectionPool {
  private connections: PooledConnection[] = [];
  private maxConnections: number;
  private nextId = 0;
  private logger?: ILogger;
  private isShuttingDown = false;

  // Refresh connections after 30 minutes to prevent staleness
  private readonly MAX_CONNECTION_AGE = 30 * 60 * 1000;

  // CircuitBreaker state
  private circuitState: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private circuitOpenUntil = 0;
  private readonly circuitConfig: CircuitBreakerConfig = {
    failureThreshold: 30,
    successThreshold: 3,
    openDuration: 300000, // 5 minutes
  };

  // Event-driven connection queue
  private pendingRequests: PendingRequest[] = [];
  private readonly CONNECTION_TIMEOUT = 30000; // 30 seconds

  constructor(options: ConnectionPoolOptions) {
    this.maxConnections = options.maxConnections;
    this.logger = options.logger;
  }

  /**
   * Get current circuit breaker state
   */
  getCircuitState(): CircuitState {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.circuitState === 'OPEN' && Date.now() >= this.circuitOpenUntil) {
      this.circuitState = 'HALF_OPEN';
      this.successCount = 0;
      this.logger?.debug('CircuitBreaker: OPEN -> HALF_OPEN');
    }
    return this.circuitState;
  }

  /**
   * Check if circuit is open (blocking requests)
   */
  isCircuitOpen(): boolean {
    return this.getCircuitState() === 'OPEN';
  }

  /**
   * Get time remaining until circuit closes (0 if not open)
   */
  getCircuitWaitTime(): number {
    if (this.circuitState !== 'OPEN') return 0;
    return Math.max(0, this.circuitOpenUntil - Date.now());
  }

  /**
   * Record a successful request (for circuit breaker)
   */
  private recordSuccess(): void {
    this.failureCount = 0;

    if (this.circuitState === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.circuitConfig.successThreshold) {
        this.circuitState = 'CLOSED';
        this.successCount = 0;
        this.logger?.debug('CircuitBreaker: HALF_OPEN -> CLOSED');
      }
    }
  }

  /**
   * Record a failed request (for circuit breaker)
   */
  private recordFailure(): void {
    this.failureCount++;

    if (this.circuitState === 'HALF_OPEN') {
      // Any failure in half-open immediately reopens
      this.circuitState = 'OPEN';
      this.circuitOpenUntil = Date.now() + this.circuitConfig.openDuration;
      this.logger?.warn('CircuitBreaker: HALF_OPEN -> OPEN (failure during test)');
    } else if (this.circuitState === 'CLOSED' && this.failureCount >= this.circuitConfig.failureThreshold) {
      this.circuitState = 'OPEN';
      this.circuitOpenUntil = Date.now() + this.circuitConfig.openDuration;
      this.logger?.warn(`CircuitBreaker: CLOSED -> OPEN (${this.failureCount} consecutive failures)`);
    }
  }

  /**
   * Execute a TTS request using an available connection from the pool
   * Automatically handles connection acquisition, retry on failure, and release
   */
  async execute(request: SendRequest): Promise<Uint8Array> {
    if (this.isShuttingDown) {
      throw new Error('Connection pool is shutting down');
    }

    // Check circuit breaker
    if (this.isCircuitOpen()) {
      const waitTime = this.getCircuitWaitTime();
      throw new RetriableError(`Circuit breaker open, retry in ${Math.round(waitTime / 1000)}s`);
    }

    const connection = await this.acquireConnection();

    try {
      const result = await connection.service.send({
        text: request.text,
        config: request.config,
        requestId: request.requestId,
      });

      connection.lastUsed = Date.now();
      connection.errorCount = 0;
      this.releaseConnection(connection);
      this.recordSuccess();

      return result;
    } catch (error) {
      connection.errorCount++;
      this.recordFailure();

      // If it's a retriable error, disconnect and let caller retry
      if (isRetriableError(error)) {
        this.logger?.debug(`Connection ${connection.id} failed with retriable error, disconnecting`);
        connection.service.disconnect();
        this.releaseConnection(connection);
        throw error;
      }

      // For non-retriable errors, release connection and rethrow
      this.releaseConnection(connection);
      throw error;
    }
  }

  /**
   * Get a connection from the pool
   * If no ready connection is available, creates a new one or waits
   */
  private async acquireConnection(): Promise<PooledConnection> {
    // Try to find an available ready connection
    const available = this.connections.find(
      (c) => !c.inUse && c.service.isReady()
    );

    if (available) {
      // Check if connection is too old and needs refresh
      if (Date.now() - available.createdAt > this.MAX_CONNECTION_AGE) {
        this.logger?.debug(`Connection ${available.id} expired (age: ${Math.round((Date.now() - available.createdAt) / 60000)}min), reconnecting`);
        available.service.disconnect();
        available.inUse = true;
        await available.service.connect();
        available.createdAt = Date.now();
        return available;
      }

      available.inUse = true;
      this.logger?.debug(`Acquired existing connection ${available.id}`);
      return available;
    }

    // Try to find a disconnected connection to reconnect
    const disconnected = this.connections.find(
      (c) => !c.inUse && c.service.getState() === 'DISCONNECTED'
    );

    if (disconnected) {
      disconnected.inUse = true;
      disconnected.createdAt = Date.now(); // Reset age on reconnect
      this.logger?.debug(`Reconnecting connection ${disconnected.id}`);
      await disconnected.service.connect();
      return disconnected;
    }

    // Create a new connection if under limit
    if (this.connections.length < this.maxConnections) {
      const connection = this.createConnection();
      connection.inUse = true;
      this.logger?.debug(`Created new connection ${connection.id}`);
      await connection.service.connect();
      return connection;
    }

    // Wait for a connection to become available
    return this.waitForConnection();
  }

  /**
   * Wait for a connection to become available (event-driven, no polling)
   */
  private waitForConnection(): Promise<PooledConnection> {
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        // Remove from pending queue
        const index = this.pendingRequests.findIndex((r) => r.timeoutId === timeoutId);
        if (index !== -1) {
          this.pendingRequests.splice(index, 1);
        }
        reject(new RetriableError('Timed out waiting for available connection'));
      }, this.CONNECTION_TIMEOUT);

      // Add to pending queue - will be resolved when a connection is released
      this.pendingRequests.push({ resolve, reject, timeoutId });
    });
  }

  /**
   * Release a connection back to the pool
   * Notifies pending requests if any are waiting
   */
  private releaseConnection(connection: PooledConnection): void {
    connection.inUse = false;

    // If there are pending requests, fulfill the first one
    this.fulfillPendingRequest();
  }

  /**
   * Try to fulfill a pending request with an available connection
   */
  private async fulfillPendingRequest(): Promise<void> {
    if (this.pendingRequests.length === 0) return;

    // Find an available connection
    const available = this.connections.find(
      (c) => !c.inUse && (c.service.isReady() || c.service.getState() === 'DISCONNECTED')
    );

    if (!available) return;

    // Get the first pending request
    const pending = this.pendingRequests.shift();
    if (!pending) return;

    // Clear the timeout
    clearTimeout(pending.timeoutId);

    // Mark as in use
    available.inUse = true;

    // If disconnected, reconnect
    if (available.service.getState() === 'DISCONNECTED') {
      try {
        await available.service.connect();
        pending.resolve(available);
      } catch (error) {
        available.inUse = false;
        pending.reject(error as Error);
        // Try to fulfill next pending request
        this.fulfillPendingRequest();
      }
    } else {
      pending.resolve(available);
    }
  }

  /**
   * Create a new connection and add to pool
   */
  private createConnection(): PooledConnection {
    const connection: PooledConnection = {
      id: this.nextId++,
      service: new ReusableEdgeTTSService(this.logger),
      inUse: false,
      lastUsed: 0,
      errorCount: 0,
      createdAt: Date.now(),
    };

    this.connections.push(connection);
    return connection;
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    total: number;
    ready: number;
    busy: number;
    disconnected: number;
    circuitState: CircuitState;
    failureCount: number;
    pendingRequests: number;
  } {
    let ready = 0;
    let busy = 0;
    let disconnected = 0;

    for (const conn of this.connections) {
      const state = conn.service.getState();
      if (state === 'READY' && !conn.inUse) ready++;
      else if (state === 'BUSY' || conn.inUse) busy++;
      else if (state === 'DISCONNECTED') disconnected++;
    }

    return {
      total: this.connections.length,
      ready,
      busy,
      disconnected,
      circuitState: this.getCircuitState(),
      failureCount: this.failureCount,
      pendingRequests: this.pendingRequests.length,
    };
  }

  /**
   * Pre-warm connections
   * Creates and connects specified number of connections upfront
   */
  async warmup(count: number): Promise<void> {
    const toCreate = Math.min(count, this.maxConnections);

    const promises: Promise<void>[] = [];
    for (let i = 0; i < toCreate; i++) {
      const connection = this.createConnection();
      promises.push(connection.service.connect());
    }

    await Promise.allSettled(promises);
    this.logger?.debug(`Warmed up ${this.connections.length} connections`);
  }

  /**
   * Shutdown the pool and disconnect all connections
   */
  shutdown(): void {
    this.isShuttingDown = true;

    // Reject all pending requests
    for (const pending of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Connection pool is shutting down'));
    }
    this.pendingRequests = [];

    // Disconnect all connections
    for (const connection of this.connections) {
      connection.service.disconnect();
    }

    this.connections = [];
    this.logger?.debug('Connection pool shut down');
  }
}
