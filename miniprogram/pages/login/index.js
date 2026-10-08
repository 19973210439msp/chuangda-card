const { request } = require('../../utils/request');
const { pageScrollHeight } = require('../../utils/util');
const accounts = require('../../utils/accounts');

Page({
  data: { wechatSkip: false, loading: false, error: '', scrollHeight: 600 },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    const notice = wx.getStorageSync('loginNotice');
    if (notice) {
      wx.removeStorageSync('loginNotice');
      this.setData({ error: notice });
    }
    if (wx.getStorageSync('token')) {
      this.finishLogin();
      return;
    }
    if (this.checking) return;
    this.checking = true;
    request({ url: '/api/auth/options', redirectOnAuth: false })
      .then((data) => {
        const wechatSkip = !!data.wechatSkip;
        this.setData({ wechatSkip });
        if (wechatSkip) this.onSkip();
        else this.checking = false;
      })
      .catch(() => {
        this.checking = false;
      });
  },
  onWechat() {
    this.loginWith((done) => wx.login({ success: (res) => done(res.code), fail: () => done('') }));
  },
  onWechatPhone(event) {
    const detail = event.detail || {};
    const phoneCode = detail.code || '';
    this.loginWith((done) => wx.login({
      success: (res) => done(res.code, phoneCode),
      fail: () => done(''),
    }));
  },
  onSkip() {
    const adding = wx.getStorageSync('addingAccount');
    if (adding) wx.removeStorageSync('addingAccount');
    let dev = adding ? '' : wx.getStorageSync('devOpenId');
    if (!dev) {
      dev = Math.random().toString(36).slice(2, 10);
      wx.setStorageSync('devOpenId', dev);
    }
    this.loginWith((done) => done('dev:' + dev));
  },
  loginWith(getCode) {
    this.setData({ loading: true, error: '' });
    getCode((code, phoneCode) => {
      const data = { code };
      if (phoneCode) data.phoneCode = phoneCode;
      request({
        url: '/api/auth/wechat',
        method: 'POST',
        data,
        redirectOnAuth: false,
      }).then((data) => {
        wx.setStorageSync('token', data.token);
        if (data.employee) accounts.remember(data.employee);
        if (data.claimed) wx.showToast({ title: '已领取导入名片', icon: 'success' });
        this.finishLogin();
      }).catch((err) => {
        this.checking = false;
        this.setData({ error: err.message || '登录失败', loading: false });
      });
    });
  },
  finishLogin() {
    const pending = wx.getStorageSync('pendingCardId');
    if (!pending) {
      wx.switchTab({ url: '/pages/home/index' });
      return;
    }
    request({
      url: '/api/holder',
      method: 'POST',
      data: { cardId: pending },
      redirectOnAuth: false,
    }).catch(() => null).then(() => {
      wx.removeStorageSync('pendingCardId');
      wx.redirectTo({ url: '/pages/client/card?cardId=' + pending });
    });
  },
});
