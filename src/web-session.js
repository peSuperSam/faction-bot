const crypto = require('node:crypto');

const COOKIE_NAME = 'coroa_session';
const OAUTH_COOKIE = 'coroa_oauth';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

function sessionSecret() {
  return String(process.env.SESSION_SECRET || '').trim();
}

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseB64urlJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function hmac(input, secret) {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function safeEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left)).digest();
  const b = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function signSession(payload, { ttlMs = DEFAULT_TTL_MS, secret = sessionSecret() } = {}) {
  if (!secret) {
    throw new Error('SESSION_SECRET ausente.');
  }
  const body = {
    ...payload,
    iat: Date.now(),
    exp: Date.now() + ttlMs,
  };
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const encoded = b64urlJson(body);
  const signature = hmac(`${header}.${encoded}`, secret);
  return `${header}.${encoded}.${signature}`;
}

function verifySession(token, { secret = sessionSecret() } = {}) {
  if (!token || !secret) {
    return null;
  }
  const parts = String(token).split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [header, encoded, signature] = parts;
  const expected = hmac(`${header}.${encoded}`, secret);
  if (!safeEqual(signature, expected)) {
    return null;
  }
  try {
    const payload = parseB64urlJson(encoded);
    if (!payload?.sub || Number(payload.exp) < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function pkceVerifier() {
  return randomToken(32);
}

function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function sessionCookie(token, { maxAgeMs = DEFAULT_TTL_MS, secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function clearCookie(name, { secure = true } = {}) {
  const parts = [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      out[key] = decodeURIComponent(value);
    }
  }
  return out;
}

function readCookie(header, name) {
  return parseCookies(header)[name] || null;
}

module.exports = {
  COOKIE_NAME,
  OAUTH_COOKIE,
  DEFAULT_TTL_MS,
  signSession,
  verifySession,
  randomToken,
  pkceVerifier,
  pkceChallenge,
  sessionCookie,
  clearCookie,
  parseCookies,
  readCookie,
};
