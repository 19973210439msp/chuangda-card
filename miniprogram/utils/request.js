var apiBaseUtil = require('./api-base.js');

function getBase() {
  var app = typeof getApp === 'function' ? getApp() : null;
  if (app && app.globalData && app.globalData.apiReady) {
    return app.globalData.apiReady;
  }
  return apiBaseUtil.resolve();
}

function requestOnce(base, { url, method = 'GET', data, redirectOnAuth = true, timeout = 15000, auth = true }) {
  const token = auth ? wx.getStorageSync('token') : '';
  return new Promise((resolve, reject) => {
    wx.request({
      url: base + url,
      method,
      data,
      timeout,
      enableHttp2: false,
      enableQuic: false,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const code = res.data && res.data.error && res.data.error.code;
        if ((res.statusCode === 401 || code === 'ACCOUNT_INACTIVE') && redirectOnAuth) {
          wx.removeStorageSync('token');
          if (code === 'ACCOUNT_INACTIVE') wx.setStorageSync('loginNotice', res.data.error.message);
          wx.reLaunch({ url: '/pages/login/index' });
        }
        const message = res.data && res.data.error && res.data.error.message;
        reject(new Error(message || '请求失败'));
      },
      fail(err) {
        console.error('fail:', JSON.stringify(err));
        const error = new Error((err && err.errMsg) || '网络异常，请确认后端已启动');
        error.network = true;
        reject(error);
      },
    });
  });
}

function request(options) {
  return getBase().then((base) => requestOnce(base, options));
}

function uploadFile(filePath) {
  const token = wx.getStorageSync('token');
  return getBase().then((base) => new Promise((resolve, reject) => {
    wx.uploadFile({
      url: base + '/api/upload',
      filePath,
      name: 'file',
      enableHttp2: false,
      enableQuic: false,
      header: token ? { Authorization: 'Bearer ' + token } : {},
      success(res) {
        let data = {};
        try { data = JSON.parse(res.data); } catch (err) { data = {}; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error((data.error && data.error.message) || '上传失败'));
      },
      fail() {
        apiBaseUtil.markBroken();
        reject(new Error('上传失败'));
      },
    });
  }));
}

module.exports = { request, uploadFile };
