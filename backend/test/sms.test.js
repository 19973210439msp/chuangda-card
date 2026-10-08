const assert = require('node:assert/strict');
const test = require('node:test');
const { smsReady, sendVerificationSms, templateParams } = require('../lib/sms');

function withSmsEnv(extra, fn) {
  const keys = [
    'TENCENT_SECRET_ID',
    'TENCENT_SECRET_KEY',
    'TENCENT_SMS_SDK_APP_ID',
    'TENCENT_SMS_SIGN_NAME',
    'TENCENT_SMS_TEMPLATE_ID',
    'TENCENT_SMS_EXPIRE_MINUTES',
    'TENCENT_SMS_REGION',
  ];
  const previous = keys.map((key) => [key, process.env[key]]);
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    TENCENT_SECRET_ID: 'AKIDtest',
    TENCENT_SECRET_KEY: 'secret',
    TENCENT_SMS_SDK_APP_ID: '1400006666',
    TENCENT_SMS_SIGN_NAME: '创大产控',
    TENCENT_SMS_TEMPLATE_ID: '1110',
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

test('sms stays on the test code until the Tencent SMS app is configured', () => {
  const previous = process.env.TENCENT_SMS_SDK_APP_ID;
  delete process.env.TENCENT_SMS_SDK_APP_ID;
  assert.equal(smsReady(), false);
  if (previous === undefined) delete process.env.TENCENT_SMS_SDK_APP_ID;
  else process.env.TENCENT_SMS_SDK_APP_ID = previous;
});

test('verification SMS uses E.164 and only returns success when Tencent says Ok', () => withSmsEnv({}, async () => {
  assert.deepEqual(templateParams('123456'), ['123456']);
  const original = global.fetch;
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    assert.equal(options.headers['X-TC-Action'], 'SendSms');
    assert.equal(options.headers['X-TC-Version'], '2021-01-11');
    return {
      json: async () => ({ Response: { SendStatusSet: [{ Code: 'Ok', Message: 'send success' }] } }),
    };
  };
  try {
    await sendVerificationSms('13800138000', '123456');
    assert.deepEqual(body.PhoneNumberSet, ['+8613800138000']);
    assert.equal(body.SmsSdkAppId, '1400006666');
    assert.equal(body.SignName, '创大产控');
    assert.equal(body.TemplateId, '1110');
    assert.deepEqual(body.TemplateParamSet, ['123456']);
  } finally {
    global.fetch = original;
  }
}));

test('a two-variable template sends the code and the expiry minutes', () => withSmsEnv({
  TENCENT_SMS_EXPIRE_MINUTES: '10',
}, () => {
  assert.deepEqual(templateParams('654321'), ['654321', '10']);
}));

test('Tencent SMS rejection is returned to the caller', () => withSmsEnv({}, async () => {
  const original = global.fetch;
  global.fetch = async () => ({
    json: async () => ({ Response: { SendStatusSet: [{ Code: 'FailedOperation.SignatureIncorrectOrUnapproved', Message: '签名未审核' }] } }),
  });
  try {
    await assert.rejects(
      () => sendVerificationSms('13800138000', '123456'),
      (err) => err.code === 'SMS_FAILED' && err.message === '签名未审核',
    );
  } finally {
    global.fetch = original;
  }
}));
