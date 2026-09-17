import { ZodError } from 'zod';

// Structured Error Types
// provides typed errors with codes for consistent error handling

/**
 * Error codes for the application
 */
export type ErrorCode =
  // TTS errors
  | 'TTS_WEBSOCKET_FAILED'
  | 'TTS_WEBSOCKET_CLOSED'
  | 'TTS_TIMEOUT'
  | 'TTS_EMPTY_RESPONSE'
  | 'TTS_INVALID_VOICE'
  // LLM errors
  | 'LLM_API_ERROR'
  | 'LLM_VALIDATION_ERROR'
  | 'LLM_TIMEOUT'
  | 'LLM_RATE_LIMITED'
  | 'LLM_NOT_CONFIGURED'
  // FFmpeg errors
  | 'FFMPEG_LOAD_FAILED'
  | 'FFMPEG_PROCESS_ERROR'
  | 'FFMPEG_NOT_AVAILABLE'
  // File system errors
  | 'NO_DIRECTORY'
  | 'FILE_SYSTEM_ERROR'
  | 'FILE_PERMISSION_DENIED'
  | 'FILE_NOT_FOUND'
  | 'FILE_PARSE_ERROR'
  // Conversion errors
  | 'CONVERSION_CANCELLED'
  | 'CONVERSION_NO_CONTENT'
  | 'CONVERSION_FAILED'
  | 'INSUFFICIENT_VOICES'
  // Generic errors
  | 'UNKNOWN_ERROR';

/**
 * Error messages mapped to codes (can be i18n keys)
 */
export const errorMessages: Record<ErrorCode, string> = {
  // TTS
  TTS_WEBSOCKET_FAILED: 'WebSocket connection failed',
  TTS_WEBSOCKET_CLOSED: 'WebSocket closed unexpectedly',
  TTS_TIMEOUT: 'TTS request timed out',
  TTS_EMPTY_RESPONSE: 'No audio data received',
  TTS_INVALID_VOICE: 'Invalid voice selected',
  // LLM
  LLM_API_ERROR: 'LLM API request failed',
  LLM_VALIDATION_ERROR: 'LLM response validation failed',
  LLM_TIMEOUT: 'LLM request timed out',
  LLM_RATE_LIMITED: 'LLM API rate limit exceeded',
  LLM_NOT_CONFIGURED: 'LLM API key not configured',
  // FFmpeg
  FFMPEG_LOAD_FAILED: 'Failed to load FFmpeg',
  FFMPEG_PROCESS_ERROR: 'FFmpeg processing failed',
  FFMPEG_NOT_AVAILABLE: 'FFmpeg is not available',
  // File system
  NO_DIRECTORY: 'No output directory selected',
  FILE_SYSTEM_ERROR: 'File system error',
  FILE_PERMISSION_DENIED: 'File permission denied',
  FILE_NOT_FOUND: 'File not found',
  FILE_PARSE_ERROR: 'Failed to parse file',
  // Conversion
  CONVERSION_CANCELLED: 'Conversion was cancelled',
  CONVERSION_NO_CONTENT: 'No content to convert',
  CONVERSION_FAILED: 'Conversion failed',
  INSUFFICIENT_VOICES: 'Insufficient voices in pool',
  // Generic
  UNKNOWN_ERROR: 'An unknown error occurred',
};

/**
 * Application Error class with structured error codes
 */
export class AppError extends Error {
  /**
   * Error code for programmatic handling
   */
  readonly code: ErrorCode;

  /**
   * Original error that caused this error
   */
  readonly cause?: Error;

  /**
   * Additional context data
   */
  readonly context?: Record<string, unknown>;

  /**
   * Timestamp when error occurred
   */
  readonly timestamp: Date;

  constructor(code: ErrorCode, message?: string, cause?: Error, context?: Record<string, unknown>) {
    super(message ?? errorMessages[code]);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
    this.context = context;
    this.timestamp = new Date();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Create an AppError from an error code
   */
  static fromCode(code: ErrorCode, cause?: Error, context?: Record<string, unknown>): AppError {
    return new AppError(code, undefined, cause, context);
  }

  /**
   * Create an AppError from an unknown error
   */
  static fromUnknown(error: unknown, context?: Record<string, unknown>): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof Error) {
      return new AppError('UNKNOWN_ERROR', error.message, error, context);
    }

    // Handle plain objects with message or error properties (e.g., p-retry context objects)
    if (error && typeof error === 'object') {
      const obj = error as Record<string, unknown>;
      if (obj.error instanceof Error) {
        return new AppError('UNKNOWN_ERROR', obj.error.message, obj.error, context);
      }
      if (typeof obj.message === 'string') {
        return new AppError('UNKNOWN_ERROR', obj.message, undefined, context);
      }
      return new AppError('UNKNOWN_ERROR', JSON.stringify(error), undefined, context);
    }

    return new AppError('UNKNOWN_ERROR', String(error), undefined, context);
  }

  /**
   * Check if error is a cancellation
   */
  isCancellation(): boolean {
    return this.code === 'CONVERSION_CANCELLED';
  }
}

/**
 * The one canonical cancellation encoding (ADR 0017): every producer that
 * unwinds a run because the user cancelled throws this, and the orchestrator
 * catch branch matches on the type via `AppError.isCancellation` — never on
 * message strings.
 */
export class CancellationError extends AppError {
  constructor(message?: string) {
    super('CONVERSION_CANCELLED', message ?? errorMessages.CONVERSION_CANCELLED);
    this.name = 'CancellationError';
  }
}

/**
 * Throws a `CancellationError` when the signal has aborted; no-op otherwise.
 * The standard pre-check before starting (or between steps of) cancellable work.
 */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    throw new CancellationError();
  }
}

// ============================================================================
// Error Factory Functions
// ============================================================================

/**
 * Create file permission error
 */
export function filePermissionError(path?: string): AppError {
  return AppError.fromCode('FILE_PERMISSION_DENIED', undefined, { path });
}

/**
 * Create no content error
 */
export function noContentError(): AppError {
  return AppError.fromCode('CONVERSION_NO_CONTENT');
}

/**
 * Create insufficient voices error
 */
export function insufficientVoicesError(maleCount: number, femaleCount: number): AppError {
  return new AppError(
    'INSUFFICIENT_VOICES',
    `Need 5+ voices (2+ male, 2+ female). Got: ${maleCount} male, ${femaleCount} female`,
  );
}

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Retriable error - signals the caller should retry with a new connection
 */
export class RetriableError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'RetriableError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RetriableError);
    }
  }
}

/**
 * Check if error indicates the connection should be retried
 */
export function isRetriableError(error: unknown): boolean {
  return error instanceof RetriableError || error instanceof ZodError;
}

/**
 * Check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Get error message safely
 */
export function getErrorMessage(error: unknown): string {
  if (isAppError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
