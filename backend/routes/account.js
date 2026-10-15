const express = require('express');
const { asyncRoute, httpError } = require('../lib/errors');
const { requireEmployee } = require('../lib/access');
const { getStore } = require('../storage');
const { toSelf } = require('../lib/person');
const { text, normalizePhone, normalizeEmail, assertMobile, assertEmail } = require('../lib/validate');
const { issueCode } = require('../lib/verify');
const { smsReady, sendVerificationSms } = require('../lib/sms');
const { mailReady, sendVerificationEmail } = require('../lib/mail');
const { changePhone, changeEmail, closeAccount, listLinkedAccounts, switchLinkedAccount } = require('../lib/contact');

const router = express.Router();

router.get('/phones', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  res.json({ items: await listLinkedAccounts(getStore(), user) });
}));

router.post('/switch', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const personId = text(req.body && req.body.personId, 64);
  if (!personId) throw httpError(400, 'VALIDATION_ERROR', '请选择要切换的账号');
  const saved = await switchLinkedAccount(getStore(), user, personId, req.auth && req.auth.token);
  res.json({ employee: toSelf(saved.employee) });
}));

router.post('/phone/code', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
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
  });
  if (ready) await sendVerificationSms(phone, issued.code);
  res.json(issued.body);
}));

router.put('/phone', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const store = getStore();
  const saved = await changePhone(store, user, req.body || {}, req.auth && req.auth.token);
  res.json({
    employee: toSelf(saved.employee),
    claimed: !!saved.claimed,
    loggedIn: !!saved.loggedIn,
  });
}));

router.post('/email/code', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const email = normalizeEmail(req.body && req.body.email);
  assertEmail(email);
  if (email === user.email) throw httpError(400, 'VALIDATION_ERROR', '与当前邮箱相同');
  const ready = mailReady();
  if (!ready && process.env.NODE_ENV === 'production') {
    throw httpError(503, 'EMAIL_NOT_CONFIGURED', '邮件服务未配置');
  }
  const store = getStore();
  const issued = await issueCode(store, {
    userId: user.id,
    channel: 'email',
    target: email,
    includeDevCode: !ready,
  });
  if (ready) await sendVerificationEmail(email, issued.code);
  res.json(issued.body);
}));

router.put('/email', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const store = getStore();
  const saved = await changeEmail(store, user, req.body || {});
  res.json({ employee: toSelf(saved) });
}));

router.post('/close', asyncRoute(async (req, res) => {
  const user = requireEmployee(req);
  const store = getStore();
  await closeAccount(store, user);
  res.json({ ok: true, status: 'closed' });
}));

module.exports = router;
