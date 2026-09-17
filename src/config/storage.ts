// Central registry for localStorage and IndexedDB keys.
// Define every persistent storage key here.

/**
 * localStorage keys
 */
export const StorageKeys = {
  /** Voice and audio settings (voice, rate, pitch, maxThreads, etc.) */
  settings: 'edgetts_settings',
  /** LLM configuration (enabled, apiUrl, model). The API key is stored separately, encrypted. */
  llmSettings: 'edgetts_llm_settings',
  /** UI language preference (en/ru) */
  language: 'edgetts_language',
  encryptedApiKey: 'llm_api_key_encrypted',
  /** UI settings (dismissed notifications, etc.) */
  uiSettings: 'edgetts-ui-settings',
} as const;

/**
 * IndexedDB database/store names
 */
export const IndexedDBNames = {
  /** Database for secure storage (encryption keys) */
  secureDb: 'edgetts_secure',
  /** Store name for encryption keys */
  keysStore: 'keys',
  /** Database for FFmpeg WASM blob cache (survives offline use and version changes) */
  ffmpegCacheDb: 'edgetts_ffmpeg_cache',
  /** Store name for FFmpeg WASM blobs */
  ffmpegCacheStore: 'blobs',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
