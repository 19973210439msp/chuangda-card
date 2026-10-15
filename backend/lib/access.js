const crypto = require('crypto');
const { httpError } = require('./errors');
const { nowIso } = require('./person');

function safeEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left)).digest();
  const b = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function adminCredentials() {
  const username = (process.env.ADMIN_USER || '').trim() || (process.env.NODE_ENV === 'production' ? '' : 'admin');
  const password = (process.env.ADMIN_PASS || '').trim() || (process.env.NODE_ENV === 'production' ? '' : 'admin123');
  if (!username || !password) {
    throw httpError(500, 'ADMIN_NOT_CONFIGURED', '生产环境必须设置 ADMIN_USER 和 ADMIN_PASS');
  }
  return { username, password };
}

function assertAdminConfigured() {
  adminCredentials();
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function adminSecretStamp() {
  return hashPassword(adminCredentials().password);
}

function sessionTtlMs(role) {
  if (role === 'admin') {
    const n = Number(process.env.ADMIN_SESSION_MS);
    return Number.isFinite(n) && n > 0 ? n : 12 * 60 * 60 * 1000;
  }
  const n = Number(process.env.EMPLOYEE_SESSION_MS);
  return Number.isFinite(n) && n > 0 ? n : 7 * 24 * 60 * 60 * 1000;
}

async function createSession(store, userId, role, secretStamp) {
  const session = {
    token: crypto.randomBytes(24).toString('hex'),
    userId,
    role,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + sessionTtlMs(role)).toISOString(),
    secretStamp: secretStamp || (role === 'admin' ? adminSecretStamp() : ''),
  };
  await store.createSession(session);
  return session;
}

function sessionIsValid(session) {
  if (!session) return false;
  if (!session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) return false;
  if (session.role === 'admin' && (!session.userId || session.userId === 'admin')) {
    if (!session.secretStamp || session.secretStamp !== adminSecretStamp()) return false;
  }
  return true;
}

function requireUser(req) {
  if (!req.auth) throw httpError(401, 'UNAUTHORIZED', '请先登录');
  return req.auth;
}

function requireAdmin(req) {
  const auth = requireUser(req);
  if (auth.role !== 'admin') throw httpError(403, 'FORBIDDEN', '需要管理员权限');
  return auth;
}

function requireEmployee(req) {
  const auth = requireUser(req);
  if (auth.role !== 'employee') throw httpError(403, 'FORBIDDEN', '需要员工身份');
  if (!req.user) throw httpError(401, 'UNAUTHORIZED', '请先登录');
  if (req.user.status !== 'active') {
    throw httpError(403, 'ACCOUNT_INACTIVE', '账号已注销或已停用');
  }
  return req.user;
}

module.exports = {
  safeEqual,
  adminCredentials,
  assertAdminConfigured,
  hashPassword,
  createSession,
  sessionIsValid,
  requireUser,
  requireAdmin,
  requireEmployee,
};
