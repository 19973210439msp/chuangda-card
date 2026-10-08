const crypto = require('crypto');
const { httpError } = require('./errors');

// 腾讯云短信 SendSms，版本 2021-01-11。
// https://cloud.tencent.com/document/product/382/55981
const SMS_KEYS = [
  'TENCENT_SECRET_ID',
  'TENCENT_SECRET_KEY',
  'TENCENT_SMS_SDK_APP_ID',
  'TENCENT_SMS_SIGN_NAME',
  'TENCENT_SMS_TEMPLATE_ID',
];

function smsReady() {
  return SMS_KEYS.every((key) => (process.env[key] || '').trim());
}

function sha256hex(message) {
  return crypto.createHash('sha256').update(message).digest('hex');
}

function hmac(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest();
}

function templateParams(code) {
  const params = [String(code)];
  const minutes = (process.env.TENCENT_SMS_EXPIRE_MINUTES || '').trim();
  if (minutes) params.push(minutes);
  return params;
}

async function sendVerificationSms(phone, code) {
  if (!smsReady()) throw httpError(503, 'SMS_NOT_CONFIGURED', '短信服务未配置');
  const secretId = process.env.TENCENT_SECRET_ID.trim();
  const secretKey = process.env.TENCENT_SECRET_KEY.trim();
  const service = 'sms';
  const host = 'sms.tencentcloudapi.com';
  const action = 'SendSms';
  const version = '2021-01-11';
  const region = (process.env.TENCENT_SMS_REGION || 'ap-guangzhou').trim();
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify({
    PhoneNumberSet: ['+86' + phone],
    SmsSdkAppId: process.env.TENCENT_SMS_SDK_APP_ID.trim(),
    SignName: process.env.TENCENT_SMS_SIGN_NAME.trim(),
    TemplateId: process.env.TENCENT_SMS_TEMPLATE_ID.trim(),
    TemplateParamSet: templateParams(code),
  });
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(payload)].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac('TC3' + secretKey, date), service), 'tc3_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch('https://' + host, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region,
    },
    body: payload,
  });
  const data = await response.json();
  const error = data && data.Response && data.Response.Error;
  if (error) throw httpError(502, 'SMS_FAILED', error.Message || '短信发送失败');
  const status = data && data.Response && data.Response.SendStatusSet && data.Response.SendStatusSet[0];
  if (!status || status.Code !== 'Ok') {
    throw httpError(502, 'SMS_FAILED', (status && status.Message) || '短信发送失败');
  }
}

module.exports = { smsReady, sendVerificationSms, templateParams };
