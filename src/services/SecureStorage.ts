/**
 * Secure storage using Web Crypto API with non-extractable keys.
 * The encryption key is stored in IndexedDB and is:
 * - Non-extractable (can't be read as raw bytes)
 * - Origin-bound (tied to this domain)
 * - Browser-instance specific (won't work if copied elsewhere)
 */

import { IndexedDBNames } from '@/config/storage';
import { openIDB, requestToPromise } from '@/utils/idb';
import type { ILogger } from './Logger';

const KEY_ID = 'master';

let cachedKey: CryptoKey | null = null;

function openDB(): Promise<IDBDatabase> {
  return openIDB(IndexedDBNames.secureDb, 1, (db) => {
    db.createObjectStore(IndexedDBNames.keysStore);
  });
}

async function getOrCreateKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const db = await openDB();

  const tx = db.transaction(IndexedDBNames.keysStore, 'readonly');
  const existing = await requestToPromise<CryptoKey | undefined>(
    tx.objectStore(IndexedDBNames.keysStore).get(KEY_ID),
  );

  if (existing) {
    cachedKey = existing;
    db.close();
    return existing;
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: the key must never be readable as raw bytes
    ['encrypt', 'decrypt'],
  );

  const putTx = db.transaction(IndexedDBNames.keysStore, 'readwrite');
  await requestToPromise(putTx.objectStore(IndexedDBNames.keysStore).put(key, KEY_ID));

  cachedKey = key;
  db.close();
  return key;
}

export async function encryptValue(plaintext: string): Promise<string> {
  if (!plaintext) return '';

  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  // Prepend the IV to the ciphertext; decryptValue slices the IV back off.
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptValue(encrypted: string, logger?: ILogger): Promise<string> {
  if (!encrypted) return '';

  try {
    const key = await getOrCreateKey();
    const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

    return new TextDecoder().decode(decrypted);
  } catch {
    // A decryption failure means the key changed or the data is corrupt.
    const msg = 'Failed to decrypt value - key may have changed';
    if (logger) {
      logger.warn(msg);
    } else {
      console.warn(msg);
    }
    return '';
  }
}
