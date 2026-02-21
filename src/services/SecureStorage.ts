/**
 * Secure storage using Web Crypto API with non-extractable keys.
 * The encryption key is stored in IndexedDB and is:
 * - Non-extractable (can't be read as raw bytes)
 * - Origin-bound (tied to this domain)
 * - Browser-instance specific (won't work if copied elsewhere)
 */

import type { ILogger } from './LoggerService';
import { IndexedDBNames } from '@/config/storage';

const KEY_ID = 'master';

let cachedKey: CryptoKey | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IndexedDBNames.secureDb, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IndexedDBNames.keysStore);
    };
  });
}

async function getOrCreateKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const db = await openDB();

  // Try to get existing key
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const tx = db.transaction(IndexedDBNames.keysStore, 'readonly');
    const request = tx.objectStore(IndexedDBNames.keysStore).get(KEY_ID);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  if (existing) {
    cachedKey = existing;
    db.close();
    return existing;
  }

  // Generate new non-extractable key
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable - critical for security
    ['encrypt', 'decrypt']
  );

  // Store in IndexedDB
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IndexedDBNames.keysStore, 'readwrite');
    const request = tx.objectStore(IndexedDBNames.keysStore).put(key, KEY_ID);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });

  cachedKey = key;
  db.close();
  return key;
}

export async function encryptValue(plaintext: string): Promise<string> {
  if (!plaintext) return '';

  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // Combine IV + ciphertext and base64 encode
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptValue(encrypted: string, logger?: ILogger): Promise<string> {
  if (!encrypted) return '';

  try {
    const key = await getOrCreateKey();
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    // Decryption failed - key changed or data corrupted
    const msg = 'Failed to decrypt value - key may have changed';
    if (logger) {
      logger.warn(msg);
    } else {
      console.warn(msg);
    }
    return '';
  }
}
