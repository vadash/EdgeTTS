// Structured Error Types
// Provides typed errors with codes for consistent error handling

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

  constructor(
    code: ErrorCode,
    message?: string,
    cause?: Error,
    context?: Record<string, unknown>
  ) {
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

    return new AppError('UNKNOWN_ERROR', String(error), undefined, context);
  }

  /**
   * Check if error is retriable
   */
  isRetriable(): boolean {
    const retriableCodes: ErrorCode[] = [
      'TTS_WEBSOCKET_FAILED',
      'TTS_WEBSOCKET_CLOSED',
      'TTS_TIMEOUT',
      'LLM_API_ERROR',
      'LLM_TIMEOUT',
      'LLM_RATE_LIMITED',
      'FFMPEG_LOAD_FAILED',
    ];
    return retriableCodes.includes(this.code);
  }

  /**
   * Check if error is a cancellation
   */
  isCancellation(): boolean {
    return this.code === 'CONVERSION_CANCELLED';
  }

  /**
   * Convert to JSON for logging/serialization
   */
  toJSON(): object {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      cause: this.cause?.message,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    };
  }

  /**
   * Get user-friendly message
   */
  getUserMessage(): string {
    return errorMessages[this.code];
  }
}

// ============================================================================
// Error Factory Functions
// ============================================================================

/**
 * Create TTS WebSocket error
 */
export function ttsWebSocketError(cause?: Error): AppError {
  return AppError.fromCode('TTS_WEBSOCKET_FAILED', cause);
}

/**
 * Create TTS timeout error
 */
export function ttsTimeoutError(partIndex?: number): AppError {
  return AppError.fromCode('TTS_TIMEOUT', undefined, { partIndex });
}

/**
 * Create TTS empty response error
 */
export function ttsEmptyResponseError(partIndex?: number): AppError {
  return AppError.fromCode('TTS_EMPTY_RESPONSE', undefined, { partIndex });
}

/**
 * Create LLM API error
 */
export function llmApiError(status: number, message: string): AppError {
  return new AppError('LLM_API_ERROR', `API error ${status}: ${message}`, undefined, { status });
}

/**
 * Create LLM validation error
 */
export function llmValidationError(errors: string[]): AppError {
  return new AppError('LLM_VALIDATION_ERROR', errors.join('; '), undefined, { errors });
}

/**
 * Create FFmpeg load error
 */
export function ffmpegLoadError(cause?: Error): AppError {
  return AppError.fromCode('FFMPEG_LOAD_FAILED', cause);
}

/**
 * Create FFmpeg process error
 */
export function ffmpegProcessError(cause?: Error): AppError {
  return AppError.fromCode('FFMPEG_PROCESS_ERROR', cause);
}

/**
 * Create file system error
 */
export function fileSystemError(operation: string, cause?: Error): AppError {
  return new AppError('FILE_SYSTEM_ERROR', `File operation failed: ${operation}`, cause, { operation });
}

/**
 * Create file permission error
 */
export function filePermissionError(path?: string): AppError {
  return AppError.fromCode('FILE_PERMISSION_DENIED', undefined, { path });
}

/**
 * Create conversion cancelled error
 */
export function conversionCancelledError(): AppError {
  return AppError.fromCode('CONVERSION_CANCELLED');
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
    `Need 5+ voices (2+ male, 2+ female). Got: ${maleCount} male, ${femaleCount} female`
  );
}

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Check if error has a specific code
 */
export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
  return isAppError(error) && error.code === code;
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
