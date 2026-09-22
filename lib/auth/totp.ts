import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let result = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      const index = (value >>> (bits - 5)) & 31;
      result += BASE32_ALPHABET[index];
      bits -= 5;
    }
  }

  if (bits > 0) {
    const index = (value << (5 - bits)) & 31;
    result += BASE32_ALPHABET[index];
  }

  return result;
}

export function base32Decode(input: string): Buffer {
  const normalized = input
    .replace(/=+$/, '')
    .replace(/\s+/g, '')
    .toUpperCase();

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);

    if (index === -1) {
      throw new Error(`Invalid Base32 character: ${character}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  const secret = randomBytes(20);
  return base32Encode(secret);
}

export function totpAt(
  secret: string,
  timeSec: number,
  period = TOTP_PERIOD_SECONDS,
  digits = TOTP_DIGITS,
): string {
  if (
    !Number.isFinite(timeSec) ||
    !Number.isSafeInteger(period) ||
    period <= 0 ||
    !Number.isInteger(digits) ||
    digits < 1 ||
    digits > 10
  ) {
    throw new RangeError('Invalid TOTP parameters');
  }

  const counter = Math.floor(timeSec / period);

  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new RangeError('Invalid TOTP counter');
  }

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const key = base32Decode(secret);

  const hmac = createHmac('sha1', key)
    .update(counterBuffer)
    .digest();

  const offset = hmac[hmac.length - 1] & 0x0f;

  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binaryCode % 10 ** digits;

  return String(otp).padStart(digits, '0');
}

export function totpNow(secret: string): string {
  const currentTimeSeconds = Date.now() / 1000;
  return totpAt(secret, currentTimeSeconds);
}

export function verifyTotp(
  secret: string,
  code: string,
  options: {
    window?: number;
    nowMs?: number;
  } = {},
): boolean {
  const {
    window = 1,
    nowMs = Date.now(),
  } = options;

  if (!/^\d{6}$/.test(code)) {
    return false;
  }

  if (
    !Number.isInteger(window) ||
    window < 0 ||
    window > 10 ||
    !Number.isFinite(nowMs) ||
    nowMs < 0
  ) {
    return false;
  }

  const currentTimeSeconds = nowMs / 1000;
  const currentCounter = Math.floor(
    currentTimeSeconds / TOTP_PERIOD_SECONDS,
  );

  const providedCode = Buffer.from(code);
  let matched = false;

  try {
    for (let drift = -window; drift <= window; drift++) {
      const counter = currentCounter + drift;

      if (counter < 0) {
        continue;
      }

      const expectedCode = totpAt(
        secret,
        counter * TOTP_PERIOD_SECONDS,
      );

      const expectedBuffer = Buffer.from(expectedCode);

      const isMatch = timingSafeEqual(
        expectedBuffer,
        providedCode,
      );

      matched = isMatch || matched;
    }
  } catch {
    return false;
  }

  return matched;
}
