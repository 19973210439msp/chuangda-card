const Dysmsapi = require('@alicloud/dysmsapi20170525');
const OpenApi = require('@alicloud/openapi-client');
const { httpError } = require('./errors');

const SMS_KEYS = [
  'ALIBABA_CLOUD_ACCESS_KEY_ID',
  'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
  'ALIYUN_SMS_SIGN_NAME',
  'ALIYUN_SMS_TEMPLATE_CODE',
];

function smsReady() {
  return SMS_KEYS.every((key) => (process.env[key] || '').trim());
}

function templateParam(code) {
  return JSON.stringify({ code: String(code) });
}

function createClient() {
  const config = new OpenApi.Config({
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID.trim(),
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET.trim(),
    endpoint: (process.env.ALIYUN_SMS_ENDPOINT || 'dysmsapi.aliyuncs.com').trim(),
  });
  return new Dysmsapi.default(config);
}

async function sendVerificationSms(phone, code) {
  if (!smsReady()) throw httpError(503, 'SMS_NOT_CONFIGURED', '短信服务未配置');
  const request = new Dysmsapi.SendSmsRequest({
    phoneNumbers: String(phone),
    signName: process.env.ALIYUN_SMS_SIGN_NAME.trim(),
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE.trim(),
    templateParam: templateParam(code),
  });

  try {
    const response = await createClient().sendSms(request);
    const body = response && response.body;
    if (!body || body.code !== 'OK') {
      console.error('[sms] Aliyun rejected SendSms', {
        code: body && body.code,
        message: body && body.message,
        requestId: body && body.requestId,
      });
      throw httpError(502, 'SMS_FAILED', '短信发送失败，请稍后重试');
    }
  } catch (error) {
    if (error && error.code === 'SMS_FAILED') throw error;
    console.error('[sms] Aliyun SendSms request failed', {
      code: error && error.code,
      message: error && error.message,
    });
    throw httpError(502, 'SMS_FAILED', '短信发送失败，请稍后重试');
  }
}

module.exports = { smsReady, sendVerificationSms, templateParam };
