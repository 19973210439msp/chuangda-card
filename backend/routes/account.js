const express = require('express');
const { asyncRoute, httpError } = require('../lib/errors');
const { requireEmployee } = require('../lib/access');
const { getStore } = require('../storage');
const { toSelf } = require('../lib/person');
const { text, normalizePhone, assertMobile } = require('../lib/validate');
const { issueCode } = require('../lib/verify');
const { smsReady, sendVerificationSms } = require('../lib/sms');
const { changePhone, closeAccount, listLinkedAccounts, switchLinkedAccount } = require('../lib/contact');

const router = express.Router();

function requireRegularEmployee(req) {
  const user = requireEmployee(req);
  if (user.reviewEntry) throw httpError(403, 'REVIEW_ACCOUNT_RESTRICTED', '审核体验账号不能修改登录账号');
  return user;
}

router.get('/phones', asyncRoute(async (req, res) => {
  const user = requireRegularEmployee(req);
  res.json({ items: await listLinkedAccounts(getStore(), user) });
}));

router.post('/switch', asyncRoute(async (req, res) => {
  const user = requireRegularEmployee(req);
  const personId = text(req.body && req.body.personId, 64);
  if (!personId) throw httpError(400, 'VALIDATION_ERROR', '请选择要切换的账号');
  const saved = await switchLinkedAccount(getStore(), user, personId, req.auth && req.auth.token);
  res.json({ employee: toSelf(saved.employee) });
}));

router.post('/phone/code', asyncRoute(async (req, res) => {
  const user = requireRegularEmployee(req);
  const phone = normalizePhone(req.body && req.body.phone);
  assertMobile(phone);
  if (phone === user.phone) throw httpError(400, 'VALIDATION_ERROR', '与当前手机号相同');
  const ready = smsReady();
  if (!ready && process.env.NODE_ENV === 'production') {
    throw httpError(503, 'SMS_NOT_CONFIGURED', '短信服务未配置');
  }
  const store = getStore();
  const issued = await issueCode(store, {
    userId: user.id,
    channel: 'sms',
    target: phone,
    includeDevCode: !ready,
    deliver: ready ? (code) => sendVerificationSms(phone, code) : undefined,
  });
  res.json(issued.body);
}));

router.put('/phone', asyncRoute(async (req, res) => {
  const user = requireRegularEmployee(req);
  const store = getStore();
  const saved = await changePhone(store, user, req.body || {}, req.auth && req.auth.token);
  res.json({
    employee: toSelf(saved.employee),
    claimed: !!saved.claimed,
    loggedIn: !!saved.loggedIn,
  });
}));

router.post('/close', asyncRoute(async (req, res) => {
  const user = requireRegularEmployee(req);
  const store = getStore();
  await closeAccount(store, user);
  res.json({ ok: true, status: 'closed' });
}));

module.exports = router;
