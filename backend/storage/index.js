const config = require('../config');

let cached;

function createStore() {
  const driver = config.storageDriver();
  if (driver === 'json') return require('./jsonStore');
  if (driver === 'pg-oss') {
    config.assertPgOssConfig();
    return require('./pgOssStore').create();
  }
  const err = new Error('未知 STORAGE_DRIVER: ' + driver);
  err.code = 'STORAGE_DRIVER_UNKNOWN';
  throw err;
}

function getStore() {
  if (!cached) cached = createStore();
  return cached;
}

function resetStoreForTests() {
  cached = null;
}

module.exports = { createStore, getStore, resetStoreForTests };
