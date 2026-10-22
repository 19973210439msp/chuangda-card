const crypto = require('crypto');
const { httpError } = require('./errors');

const TTL_MS = 5 * 60 * 1000;
const WINDOW_MS = 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function randomCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function issueCode(store, { userId, channel, target, includeDevCode, deliver }) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const code = randomCode();
  const row = {
    id: 'code-' + crypto.randomBytes(6).toString('hex'),
    userId,
    channel,
    target,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
    used: false,
    failedAttempts: 0,
    createdAt: new Date().toISOString(),
  };
  const reserved = await store.reserveCode(row, { userId, channel, since });
  if (!reserved) {
    throw httpError(429, 'CODE_RATE_LIMIT', '验证码每分钟只能发送一次');
  }
  try {
    if (deliver) await deliver(code);
  } catch (error) {
    await store.deleteCode(row.id);
    throw error;
  }
  const expose = includeDevCode !== undefined ? includeDevCode : process.env.NODE_ENV !== 'production';
  const body = { sent: true, channel, target };
  if (expose) body.devCode = code;
  return { body, code };
}

async function consumeCode(store, { userId, channel, target, code }) {
  const raw = String(code == null ? '' : code).trim();
  if (!/^\d{6}$/.test(raw)) {
    throw httpError(400, 'CODE_INVALID', '请填写 6 位验证码');
  }
  const row = await store.findActiveCode({
    userId,
    channel,
    target,
    now: new Date().toISOString(),
  });
  if (!row) throw httpError(400, 'CODE_INVALID', '验证码不正确或已过期');
  const actual = Buffer.from(String(row.codeHash || ''));
  const supplied = Buffer.from(hashCode(raw));
  const matches = actual.length === supplied.length && crypto.timingSafeEqual(actual, supplied);
  if (!matches) {
    await store.recordCodeFailure(row.id, MAX_FAILED_ATTEMPTS);
    throw httpError(400, 'CODE_INVALID', '验证码不正确或已过期');
  }
  await store.markCodeUsed(row.id);
}

module.exports = { issueCode, consumeCode, hashCode };
