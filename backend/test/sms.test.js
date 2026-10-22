const assert = require('node:assert/strict');
const test = require('node:test');
const Dysmsapi = require('@alicloud/dysmsapi20170525');
const { smsReady, sendVerificationSms, templateParam } = require('../lib/sms');

function withSmsEnv(extra, fn) {
  const keys = [
    'ALIBABA_CLOUD_ACCESS_KEY_ID',
    'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
    'ALIYUN_SMS_SIGN_NAME',
    'ALIYUN_SMS_TEMPLATE_CODE',
    'ALIYUN_SMS_ENDPOINT',
  ];
  const previous = keys.map((key) => [key, process.env[key]]);
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    ALIBABA_CLOUD_ACCESS_KEY_ID: 'LTAItest',
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'secret',
    ALIYUN_SMS_SIGN_NAME: '创大产控',
    ALIYUN_SMS_TEMPLATE_CODE: 'SMS_123456789',
  }, extra);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('sms stays disabled until the Aliyun SMS settings are complete', () => withSmsEnv({
  ALIYUN_SMS_TEMPLATE_CODE: '',
}, () => {
  assert.equal(smsReady(), false);
}));

test('verification SMS sends the approved Aliyun template with a six-digit code', () => withSmsEnv({}, async () => {
  assert.equal(templateParam('123456'), JSON.stringify({ code: '123456' }));
  const original = Dysmsapi.default.prototype.sendSms;
  let request;
  Dysmsapi.default.prototype.sendSms = async (input) => {
    request = input;
    return { body: { code: 'OK', message: 'OK', bizId: 'aliyun-biz-id' } };
  };
  try {
    await sendVerificationSms('13800138000', '123456');
    assert.equal(request.phoneNumbers, '13800138000');
    assert.equal(request.signName, '创大产控');
    assert.equal(request.templateCode, 'SMS_123456789');
    assert.equal(request.templateParam, JSON.stringify({ code: '123456' }));
  } finally {
    Dysmsapi.default.prototype.sendSms = original;
  }
}));

test('Aliyun SMS rejection is returned to the caller', () => withSmsEnv({}, async () => {
  const original = Dysmsapi.default.prototype.sendSms;
  Dysmsapi.default.prototype.sendSms = async () => ({
    body: { code: 'isv.SMS_SIGNATURE_ILLEGAL', message: '签名未审核' },
  });
  try {
    await assert.rejects(
      () => sendVerificationSms('13800138000', '123456'),
      (err) => err.code === 'SMS_FAILED' && err.message === '短信发送失败，请稍后重试',
    );
  } finally {
    Dysmsapi.default.prototype.sendSms = original;
  }
}));
