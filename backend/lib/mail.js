const nodemailer = require('nodemailer');
const { httpError } = require('./errors');

const MAIL_KEYS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];

function mailReady() {
  return MAIL_KEYS.every((key) => (process.env[key] || '').trim());
}

function smtpPort() {
  const raw = (process.env.SMTP_PORT || '').trim();
  const port = raw ? Number(raw) : 465;
  return Number.isFinite(port) && port > 0 ? port : 465;
}

function smtpSecure() {
  const raw = (process.env.SMTP_SECURE || '').trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return smtpPort() === 465;
}

function fromAddress() {
  const from = (process.env.SMTP_FROM || '').trim();
  if (from) return from;
  const name = (process.env.SMTP_FROM_NAME || '创大产控电子名片').trim();
  const user = process.env.SMTP_USER.trim();
  return name ? `"${name}" <${user}>` : user;
}

function transporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST.trim(),
    port: smtpPort(),
    secure: smtpSecure(),
    auth: {
      user: process.env.SMTP_USER.trim(),
      pass: process.env.SMTP_PASS.trim(),
    },
  });
}

async function sendVerificationEmail(email, code) {
  if (!mailReady()) throw httpError(503, 'EMAIL_NOT_CONFIGURED', '邮件服务未配置');
  const minutes = 10;
  const subject = '创大产控电子名片验证码';
  const text = [
    '您正在修改绑定邮箱。',
    '',
    '验证码：' + code,
    '有效期 ' + minutes + ' 分钟。如非本人操作，请忽略本邮件。',
    '',
    '创大产控电子名片',
  ].join('\n');
  const html = [
    '<p>您正在修改绑定邮箱。</p>',
    '<p>验证码：<strong style="font-size:20px;letter-spacing:2px">' + code + '</strong></p>',
    '<p>有效期 ' + minutes + ' 分钟。如非本人操作，请忽略本邮件。</p>',
    '<p>创大产控电子名片</p>',
  ].join('');
  try {
    await transporter().sendMail({
      from: fromAddress(),
      to: email,
      subject,
      text,
      html,
    });
  } catch (err) {
    throw httpError(502, 'EMAIL_FAILED', (err && err.message) || '邮件发送失败');
  }
}

module.exports = { mailReady, sendVerificationEmail };
