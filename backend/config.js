const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const OSS_KEYS = ['OSS_REGION', 'OSS_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'];

function storageDriver() {
  const value = (process.env.STORAGE_DRIVER || '').trim();
  return value || 'json';
}

function dataFile() {
  return process.env.DATA_FILE
    ? path.resolve(process.env.DATA_FILE)
    : path.join(__dirname, 'data.json');
}

function uploadDir() {
  return path.join(__dirname, 'uploads');
}

function wechatSkipAllowed() {
  return process.env.SKIP_WECHAT_AUTH === 'true' && process.env.NODE_ENV !== 'production';
}

function missingPgOssConfig() {
  const missing = [];
  if (!(process.env.DATABASE_URL || '').trim()) missing.push('DATABASE_URL');
  for (const key of OSS_KEYS) {
    if (!(process.env[key] || '').trim()) missing.push(key);
  }
  return missing;
}

function assertPgOssConfig() {
  const missing = missingPgOssConfig();
  if (!missing.length) return;
  const err = new Error('方案 2 未配置: ' + missing.join(', '));
  err.code = 'STORAGE_NOT_CONFIGURED';
  err.missing = missing;
  throw err;
}

function publicBase(req) {
  if ((process.env.PUBLIC_BASE_URL || '').trim()) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = {
  storageDriver,
  dataFile,
  uploadDir,
  wechatSkipAllowed,
  missingPgOssConfig,
  assertPgOssConfig,
  publicBase,
};
