/**
 * 后端地址。
 * 手机测试版优先走已打通的 HTTPS 穿透，避免微信拦住 http + 局域网 IP。
 * 穿透不可用时再试局域网。探测成功才写入缓存。
 */
var CACHE_KEY = 'cd_api_base_cache_v3';
var OVERRIDE_KEY = 'cd_api_base_override';

var CANDIDATES = [
  'http://161b9636.r3.cpolar.top',
  'http://172.16.180.183:3000'
];

var PROBE_PATH = '/api/auth/options';
var PROBE_TIMEOUT = 4000;
var pending = null;

function storageGet(key) {
  try {
    return wx.getStorageSync(key) || '';
  } catch (err) {
    return '';
  }
}

function storageSet(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (err) {}
}

function storageRemove(key) {
  try {
    wx.removeStorageSync(key);
  } catch (err) {}
}

function probe(base) {
  return new Promise(function (resolve) {
    var done = false;
    function finish(ok) {
      if (done) return;
      done = true;
      resolve(ok);
    }
    var task = null;
    try {
      task = wx.request({
        url: base + PROBE_PATH,
        method: 'GET',
        timeout: PROBE_TIMEOUT,
        success: function (res) {
          var body = res.data || {};
          finish(res.statusCode === 200 && typeof body.wechatSkip === 'boolean');
        },
        fail: function () {
          finish(false);
        }
      });
    } catch (err) {
      finish(false);
      return;
    }
    setTimeout(function () {
      if (done) return;
      try {
        if (task && task.abort) task.abort();
      } catch (err) {}
      finish(false);
    }, PROBE_TIMEOUT + 500);
  });
}

function detect() {
  return CANDIDATES.reduce(function (chain, base) {
    return chain.then(function (found) {
      if (found) return found;
      return probe(base).then(function (ok) {
        return ok ? base : null;
      });
    });
  }, Promise.resolve(null));
}

function resolve(force) {
  var override = storageGet(OVERRIDE_KEY);
  if (override) return Promise.resolve(String(override).replace(/\/$/, ''));

  if (!force) {
    var cached = storageGet(CACHE_KEY);
    if (cached) return Promise.resolve(cached);
    if (pending) return pending;
  } else {
    pending = null;
    storageRemove(CACHE_KEY);
  }

  pending = detect().then(function (found) {
    pending = null;
    if (found) storageSet(CACHE_KEY, found);
    return found || CANDIDATES[0];
  }, function () {
    pending = null;
    return CANDIDATES[0];
  });
  return pending;
}

function markBroken() {
  pending = null;
  storageRemove(CACHE_KEY);
}

function setOverride(base) {
  storageSet(OVERRIDE_KEY, String(base || '').trim().replace(/\/$/, ''));
}

function clearOverride() {
  pending = null;
  storageRemove(OVERRIDE_KEY);
  storageRemove(CACHE_KEY);
}

function hasOverride() {
  return !!storageGet(OVERRIDE_KEY);
}

function readCached() {
  return storageGet(OVERRIDE_KEY) || storageGet(CACHE_KEY) || CANDIDATES[0];
}

function current() {
  var app = typeof getApp === 'function' ? getApp() : null;
  if (app && app.globalData && app.globalData.apiBase) return app.globalData.apiBase;
  return readCached();
}

module.exports = {
  CANDIDATES: CANDIDATES,
  resolve: resolve,
  readCached: readCached,
  current: current,
  markBroken: markBroken,
  setOverride: setOverride,
  clearOverride: clearOverride,
  hasOverride: hasOverride
};
