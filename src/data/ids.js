// Random codes for sessions and participants. The participant code is
// read by people (retest letters, the contacts sheet), so the alphabet leaves
// out characters that are easy to confuse: 0/o and 1/l/i.

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
// Largest multiple of the alphabet size below 256: bytes above it are
// skipped so that every character is equally likely.
const LIMIT = 256 - (256 % ALPHABET.length);

export function randomCode(length) {
  let code = '';
  while (code.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < LIMIT && code.length < length) code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return code;
}

export const newSessionId = () => randomCode(16);
export const newParticipantCode = () => randomCode(10);
