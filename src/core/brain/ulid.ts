import { randomBytes } from "node:crypto";

// Crockford's base32: no I, L, O or U.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(ms: number): string {
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[ms % 32]! + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

/**
 * A ULID (§3.3): 48 bits of time then 80 bits of randomness, so ids sort by creation. Two ids made in the same
 * millisecond differ because the second increments the first's random part.
 */
export function newUlid(now: number = Date.now()): string {
  if (now === lastTime) {
    // Increment the 80-bit random part, carrying from the right.
    let i = 15;
    while (i >= 0 && lastRandom[i] === 31) lastRandom[i--] = 0;
    if (i < 0) throw new Error("ULID random part overflowed within one millisecond");
    lastRandom[i] = lastRandom[i]! + 1;
  } else {
    lastTime = now;
    lastRandom = Array.from(randomBytes(16), (b) => b % 32);
    // Leave headroom so a burst within one millisecond cannot overflow.
    lastRandom[0] = lastRandom[0]! % 16;
  }
  return encodeTime(now) + lastRandom.map((n) => ALPHABET[n]).join("");
}

export const isUlid = (s: string): boolean => ULID.test(s);
