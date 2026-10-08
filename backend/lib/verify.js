const crypto = require('crypto');
const { httpError } = require('./errors');

const TTL_MS = 10 * 60 * 1000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_IN_WINDOW = 5;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function randomCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function issueCode(store, { userId, channel, target, includeDevCode }) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const recent = await store.countRecentCodes({ userId, channel, since });
  if (recent >= MAX_IN_WINDOW) {
    throw httpError(429, 'CODE_RATE_LIMIT', '验证码发送过于频繁，请稍后再试');
  }
  const code = randomCode();
  const row = {
    id: 'code-' + crypto.randomBytes(6).toString('hex'),
    userId,
    channel,
    target,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
    used: false,
    createdAt: new Date().toISOString(),
  };
  await store.insertCode(row);
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
  const row = await store.findValidCode({
    userId,
    channel,
    target,
    codeHash: hashCode(raw),
    now: new Date().toISOString(),
  });
  if (!row) throw httpError(400, 'CODE_INVALID', '验证码不正确或已过期');
  await store.markCodeUsed(row.id);
}

module.exports = { issueCode, consumeCode, hashCode };
