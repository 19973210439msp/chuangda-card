/** The production mini program has one backend, so no network probe is needed. */
var BASE = 'https://business-card.cdckgroup.com';
var OVERRIDE_KEY = 'cd_api_base_override_v19';

function storageGet(key) {
  try { return wx.getStorageSync(key) || ''; } catch (err) { return ''; }
}

function storageRemove(key) {
  try { wx.removeStorageSync(key); } catch (err) {}
}

function readCached() {
  return storageGet(OVERRIDE_KEY) || BASE;
}

function resolve() {
  return Promise.resolve(readCached());
}

function markBroken() {
  // A network failure cannot be fixed by selecting the same backend again.
}

function setOverride(base) {
  try { wx.setStorageSync(OVERRIDE_KEY, String(base || '').trim().replace(/\/$/, '')); } catch (err) {}
}

function clearOverride() {
  storageRemove(OVERRIDE_KEY);
}

function hasOverride() {
  return !!storageGet(OVERRIDE_KEY);
}

function current() {
  var app = typeof getApp === 'function' ? getApp() : null;
  if (app && app.globalData && app.globalData.apiBase) return app.globalData.apiBase;
  return readCached();
}

module.exports = {
  CANDIDATES: [BASE],
  resolve: resolve,
  readCached: readCached,
  current: current,
  markBroken: markBroken,
  setOverride: setOverride,
  clearOverride: clearOverride,
  hasOverride: hasOverride,
};
