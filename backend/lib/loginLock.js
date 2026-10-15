const { httpError } = require('./errors');

const attempts = new Map();

function failLimit() {
  const n = Number(process.env.LOGIN_FAIL_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function lockMs() {
  const n = Number(process.env.LOGIN_LOCK_MS);
  return Number.isFinite(n) && n > 0 ? n : 15 * 60 * 1000;
}

function clientIp(req) {
  const raw = (req.ip || (req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  return raw || 'unknown';
}

function lockKey(ip, username) {
  return String(ip || 'unknown') + '\n' + String(username || '').trim().toLowerCase();
}

function assertLoginAllowed(ip, username) {
  const row = attempts.get(lockKey(ip, username));
  if (!row) return;
  if (row.lockedUntil && row.lockedUntil > Date.now()) {
    throw httpError(429, 'LOGIN_LOCKED', '尝试次数过多，请稍后再试');
  }
  if (row.lockedUntil && row.lockedUntil <= Date.now()) attempts.delete(lockKey(ip, username));
}

function recordLoginFailure(ip, username) {
  const key = lockKey(ip, username);
  const row = attempts.get(key) || { fails: 0, lockedUntil: 0 };
  if (row.lockedUntil && row.lockedUntil > Date.now()) return;
  row.fails += 1;
  if (row.fails >= failLimit()) {
    row.lockedUntil = Date.now() + lockMs();
    row.fails = 0;
  }
  attempts.set(key, row);
}

function recordLoginSuccess(ip, username) {
  attempts.delete(lockKey(ip, username));
}

module.exports = {
  clientIp,
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
};
