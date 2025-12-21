// TTSConnectionPool - Manages a pool of reusable WebSocket connections
// Reduces rate-limiting by reusing connections instead of creating new ones

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
 * TTSConnectionPool - Manages a pool of reusable WebSocket connections
 *
 * Benefits:
 * - Reduces handshake latency (connections are pre-established)
 * - Prevents rate-limiting (fewer new connections)
 * - Efficient resource usage (connections are reused)
 */
export class TTSConnectionPool {
  private connections: PooledConnection[] = [];
  private maxConnections: number;
  private nextId = 0;
  private logger?: ILogger;
  private isShuttingDown = false;

  // Refresh connections after 30 minutes to prevent staleness
  private readonly MAX_CONNECTION_AGE = 30 * 60 * 1000;

  constructor(options: ConnectionPoolOptions) {
    this.maxConnections = options.maxConnections;
    this.logger = options.logger;
  }

  /**
   * Execute a TTS request using an available connection from the pool
   * Automatically handles connection acquisition, retry on failure, and release
   */
  async execute(request: SendRequest): Promise<Uint8Array> {
    if (this.isShuttingDown) {
      throw new Error('Connection pool is shutting down');
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

      return result;
    } catch (error) {
      connection.errorCount++;

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
   * Wait for a connection to become available
   */
  private waitForConnection(): Promise<PooledConnection> {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(async () => {
        if (this.isShuttingDown) {
          clearInterval(checkInterval);
          reject(new Error('Connection pool is shutting down'));
          return;
        }

        // Check for available connection
        const available = this.connections.find(
          (c) => !c.inUse && (c.service.isReady() || c.service.getState() === 'DISCONNECTED')
        );

        if (available) {
          clearInterval(checkInterval);
          available.inUse = true;

          if (available.service.getState() === 'DISCONNECTED') {
            try {
              await available.service.connect();
            } catch (error) {
              available.inUse = false;
              reject(error);
              return;
            }
          }

          resolve(available);
        }
      }, 50);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new RetriableError('Timed out waiting for available connection'));
      }, 30000);
    });
  }

  /**
   * Release a connection back to the pool
   */
  private releaseConnection(connection: PooledConnection): void {
    connection.inUse = false;
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

    for (const connection of this.connections) {
      connection.service.disconnect();
    }

    this.connections = [];
    this.logger?.debug('Connection pool shut down');
  }
}
