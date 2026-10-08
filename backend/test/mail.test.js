const assert = require('node:assert/strict');
const test = require('node:test');

test('mailReady requires host user and password', () => {
  const saved = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
  };
  delete require.cache[require.resolve('../lib/mail')];
  process.env.SMTP_HOST = '';
  process.env.SMTP_USER = '';
  process.env.SMTP_PASS = '';
  let mail = require('../lib/mail');
  assert.equal(mail.mailReady(), false);

  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_USER = 'noreply@example.com';
  process.env.SMTP_PASS = 'secret';
  delete require.cache[require.resolve('../lib/mail')];
  mail = require('../lib/mail');
  assert.equal(mail.mailReady(), true);

  process.env.SMTP_HOST = saved.SMTP_HOST;
  process.env.SMTP_USER = saved.SMTP_USER;
  process.env.SMTP_PASS = saved.SMTP_PASS;
  delete require.cache[require.resolve('../lib/mail')];
});
