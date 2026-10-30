import { randomBytes } from 'node:crypto';

// Short-lived in-memory audio so 9jaLingo STT can fetch it by URL.
// Tokens are 128-bit random and expire after a few minutes; nothing is written to disk.
const files = new Map();

export function put(buffer, ttlMs = 5 * 60_000) {
  const token = randomBytes(16).toString('hex');
  files.set(token, buffer);
  setTimeout(() => files.delete(token), ttlMs).unref();
  return token;
}

export const get = (token) => files.get(token);
export const drop = (token) => files.delete(token);
