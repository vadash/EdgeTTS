// Sec-MS-GEC v2 token for the Edge TTS handshake.
// Port of edge_tts/drm.py (upstream >= 7.3.0, commit ba61d94 "feat: support
// Sec-MS-GEC v2 tokens"). The server rejects the old single SHA-256 (v1)
// token with HTTP 403.
//
// The token is "<cs64>-<sha256>": both digests come from a *modified*
// SHA-256 whose IV is derived from the first 7 input bytes and whose round
// constant 14 and two schedule sigmas are adjusted. Standard SHA-256 output
// is NOT accepted as the second half.

const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
];

const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6,
  0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564,
];

const ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const SHA256_ADJUSTMENT = 0xc9dc06a7;
// Round constants with 14 replaced by the adjustment.
const BLOCK_CONSTANTS = [
  ...ROUND_CONSTANTS.slice(0, 14),
  SHA256_ADJUSTMENT,
  ...ROUND_CONSTANTS.slice(15),
];
const SIGMA0_ADJUSTMENT = 0x059c0b80;
const SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS: ReadonlyArray<readonly [number, number]> = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function rol16(x: number): number {
  return ((x << 16) | (x >>> 16)) >>> 0;
}

function sigma0(x: number): number {
  return (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
}

function sigma1(x: number): number {
  return (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0;
}

function expandSchedule(words: number[], firstWord: number): void {
  for (let index = firstWord; index < 64; index++) {
    const value =
      sigma1(words[index - 2]) + words[index - 7] + sigma0(words[index - 15]) + words[index - 16];
    words.push(value >>> 0);
  }
}

function sha256Rounds(
  state: number[],
  words: number[],
  firstRound: number,
  useBlockConstants: boolean,
): number[] {
  let [a, b, c, d, e, f, g, h] = state;
  const constants = useBlockConstants ? BLOCK_CONSTANTS : ROUND_CONSTANTS;
  for (let index = firstRound; index < 64; index++) {
    const t1 =
      (h +
        (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
        (g ^ (e & (f ^ g))) +
        constants[index] +
        words[index]) >>>
      0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) | (c & (a | b)))) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}

// Modified SHA-256 initial state: the first 7 input bytes seed a custom IV via
// an adjusted first block (schedule indices shifted by 14, two sigma tweaks).
function sha256Init(data: Uint8Array): number[] {
  const words: number[] = new Array<number>(14).fill(0);
  words.push(((data[0] << 16) | (data[1] << 8) | data[2]) >>> 0);
  words.push(((data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6]) >>> 0);
  for (let index = 16; index < 30; index++) {
    let value: number = SHA256_SCHEDULE[index - 16];
    if (index === 16) {
      value += sigma1(words[14]) ^ SIGMA1_ADJUSTMENT;
    } else {
      value += sigma1(words[index - 2]);
    }
    if (index - 7 >= 14) value += words[index - 7];
    if (index === 29) {
      value += sigma0(words[14]) ^ SIGMA0_ADJUSTMENT;
    }
    words.push(value >>> 0);
  }
  words.push(
    (sigma1(words[28]) +
      words[23] +
      sigma0(words[15]) +
      words[14] +
      SHA256_ADJUSTMENT -
      ROUND_CONSTANTS[14]) >>>
      0,
  );
  expandSchedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14, true);
  // drm.py combines with the standard SHA-256 IV, not the adjusted state.
  return SHA256_INITIAL.map((x, i) => (x + working[i]) >>> 0);
}

function sha256Digest(data: Uint8Array): Uint8Array {
  if (data.length < 7) {
    throw new Error('Token data must contain at least seven bytes');
  }
  const length = 57 + data.length;
  const padLength = (((55 - length) % 64) + 64) % 64;
  const padded = new Uint8Array(data.length - 7 + 1 + padLength + 8);
  padded.set(data.subarray(7), 0);
  padded[data.length - 7] = 0x80;
  const view = new DataView(padded.buffer);
  view.setBigUint64(padded.length - 8, BigInt(length) * 8n, false);

  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let j = 0; j < 16; j++) words.push(view.getUint32(offset + j * 4, false));
    expandSchedule(words, 16);
    const working = sha256Rounds(state, words, 0, false);
    state = state.map((x, i) => (x + working[i]) >>> 0);
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < state.length; i++) digestView.setUint32(i * 4, state[i], false);
  return digest;
}

// Little-endian u32 words of data, zero-padded to an even word count.
function wordsLe4Even(data: Uint8Array): number[] {
  const words: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const w =
      (data[i] ?? 0) +
      (data[i + 1] ?? 0) * 0x100 +
      (data[i + 2] ?? 0) * 0x10000 +
      (data[i + 3] ?? 0) * 0x1000000;
    words.push(w >>> 0);
  }
  if (words.length % 2) words.push(0);
  return words;
}

function cs64Digest(data: Uint8Array, digest: Uint8Array): [number, number] {
  const digestView = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const keyA = digestView.getUint32(0, true) | 1;
  const keyB = digestView.getUint32(4, true) | 1;
  const factorA = Math.imul(keyA, CS64_FACTOR) >>> 0;
  const factorB = Math.imul(keyB, CS64_FACTOR) >>> 0;

  const terms: number[] = CS64_COEFFICIENTS.map(
    ([coefficient], i) => Math.imul(coefficient, i % 2 === 0 ? factorA : factorB) >>> 0,
  );
  const offsets: number[] = CS64_COEFFICIENTS.map(([, offset]) => offset);

  // A leading zero byte is hashed before the data (drm.py: b"\x00" + data).
  const prefixed = new Uint8Array(data.length + 1);
  prefixed.set(data, 1);
  const words = wordsLe4Even(prefixed);
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    let term = Math.imul(word, index % 2 === 0 ? keyA : keyB);
    let offset = Math.imul(rol16(word), index % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (index === 0) {
      term += Math.imul(CS64_ADJUSTMENT0, factorA);
      offset += CS64_ADJUSTMENT1;
    }
    terms.push(term >>> 0);
    offsets.push(offset >>> 0);
  }

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index];
    const y = terms[index + 1];

    let t = rol16((offsets[index] + x) >>> 0);
    let q = Math.imul(t, 0x76f50f34) >>> 0;
    swapAcc = (swapAcc + Math.imul(rol16(q), 0xc3efea97) + q) >>> 0;
    t = rol16((offsets[index + 1] + y) >>> 0);
    q = Math.imul(t, 0x1881ce3c) >>> 0;
    swapLast = (Math.imul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (Math.imul(state, keyA) + x) >>> 0;
    state = Math.imul(rol16(state), 0xcf98b111) >>> 0;
    state = Math.imul(rol16(state), 0x87085b9f) >>> 0;
    state = Math.imul(rol16(state), 0x12ceb96d) >>> 0;
    state = Math.imul(rol16(state), 0x257e1d83) >>> 0;
    acc = (acc + state) >>> 0;
    t = (Math.imul(state, keyB) + y) >>> 0;
    t = Math.imul(rol16(t), 0xa27416f5) >>> 0;
    t = Math.imul(rol16(t), 0xd38396ff) >>> 0;
    state = Math.imul(rol16(Math.imul(rol16(t), 0x7c932b89) >>> 0), 0xbfa49f69) >>> 0;
    acc = (acc + state) >>> 0;
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

function toHexUpper(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result.toUpperCase();
}

/**
 * Generates the v2 Sec-MS-GEC token: "<cs64>-<sha256>" over
 * "<windows file time, 100ns ticks, 5-minute bucket><trustedClientToken>".
 * @param trustedClientToken Edge TTS trusted client token.
 * @param unixTimestamp Optional timestamp in seconds, for tests.
 */
export function generateSecMsGecV2(trustedClientToken: string, unixTimestamp?: number): string {
  let ticks = unixTimestamp ?? Date.now() / 1000;
  ticks += WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= S_TO_NS / 100;

  const text = `${Math.floor(ticks)}${trustedClientToken}`;
  const data = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new Error('Token input must be ASCII');
    data[i] = code;
  }

  const digest = sha256Digest(data);
  const [cs64First, cs64Second] = cs64Digest(data, digest);
  const cs64 = toHexUpper(
    new Uint8Array([
      cs64First & 0xff,
      (cs64First >>> 8) & 0xff,
      (cs64First >>> 16) & 0xff,
      (cs64First >>> 24) & 0xff,
      cs64Second & 0xff,
      (cs64Second >>> 8) & 0xff,
      (cs64Second >>> 16) & 0xff,
      (cs64Second >>> 24) & 0xff,
    ]),
  );
  return `${cs64}-${toHexUpper(digest)}`;
}
