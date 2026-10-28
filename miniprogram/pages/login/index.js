const { request } = require('../../utils/request');
const { pageScrollHeight } = require('../../utils/util');
const accounts = require('../../utils/accounts');
const { phoneAuthError, phoneCodeFromEvent } = require('../../utils/phone-auth');
const { favoriteCompletion, favoritePayload, sharedCardPath, sharedEntryPath } = require('../../utils/favorite-flow');

Page({
  data: {
    wechatSkip: true,
    reviewEntryEnabled: false,
    reviewOpen: false,
    reviewCode: '',
    reviewCodeReady: false,
    loading: false,
    error: '',
    scrollHeight: 600,
  },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    const shared = sharedEntryPath(
      typeof wx.getEnterOptionsSync === 'function' ? wx.getEnterOptionsSync() : {},
      wx.getStorageSync('pendingCardId')
    );
    if (shared) {
      wx.redirectTo({ url: shared });
      return;
    }
    const notice = wx.getStorageSync('loginNotice');
    if (notice) {
      wx.removeStorageSync('loginNotice');
      this.setData({ error: notice });
    }
    const token = wx.getStorageSync('token');
    const reviewSession = !!wx.getStorageSync('reviewEntrySession');
    if (token && !reviewSession) {
      this.finishLogin();
      return;
    }
    if (this.checking) return;
    this.checking = true;
    request({ url: '/api/auth/options', redirectOnAuth: false, auth: false })
      .then((data) => {
        const reviewEntryEnabled = !!data.reviewEntryEnabled;
        // 即使测试可跳过，也不再自动进入；优先走手机号快捷登录，避免落到短信绑号页
        this.setData({
          wechatSkip: !!data.wechatSkip,
          reviewEntryEnabled,
        });
        this.checking = false;
        if (token && reviewSession && reviewEntryEnabled) {
          this.finishLogin();
          return;
        }
        if (reviewSession && !reviewEntryEnabled) {
          wx.removeStorageSync('token');
          wx.removeStorageSync('reviewEntrySession');
        }
        this.tryResume();
      })
      .catch(() => {
        this.checking = false;
        if (token && reviewSession) {
          this.finishLogin();
          return;
        }
        this.tryResume();
      });
  },
  tryResume() {
    if (this.resuming) return;
    this.resuming = true;
    wx.login({
      success: (res) => {
        if (!res.code) {
          this.resuming = false;
          return;
        }
        request({
          url: '/api/auth/wechat',
          method: 'POST',
          data: { code: res.code, resume: true },
          redirectOnAuth: false,
        }).then((data) => {
          if (!data || !data.returning || !data.token) {
            this.resuming = false;
            return;
          }
          wx.setStorageSync('token', data.token);
          wx.removeStorageSync('reviewEntrySession');
          if (data.employee) accounts.remember(data.employee);
          this.finishLogin();
        }).catch(() => {
          this.resuming = false;
        });
      },
      fail: () => {
        this.resuming = false;
      },
    });
  },
  onWechat() {
    this.loginWith((done) => wx.login({ success: (res) => done(res.code), fail: () => done('') }));
  },
  onWechatPhone(event) {
    const phoneCode = phoneCodeFromEvent(event);
    if (!phoneCode) {
      this.setData({
        error: phoneAuthError(event.detail),
        loading: false,
      });
      return;
    }
    this.loginWith((done) => wx.login({
      success: (res) => done(res.code, phoneCode),
      fail: () => done('', phoneCode),
    }));
  },
  onSkip() {
    let dev = wx.getStorageSync('devOpenId');
    if (!dev) {
      dev = Math.random().toString(36).slice(2, 10);
      wx.setStorageSync('devOpenId', dev);
    }
    this.loginWith((done) => done('dev:' + dev));
  },
  onReviewToggle() {
    this.setData({
      reviewOpen: !this.data.reviewOpen,
      reviewCode: '',
      reviewCodeReady: false,
      error: '',
    });
  },
  onReviewCodeInput(event) {
    const reviewCode = event.detail.value || '';
    this.setData({
      reviewCode,
      reviewCodeReady: !!String(reviewCode).trim(),
      error: '',
    });
  },
  onReviewLogin() {
    if (this.data.loading) return;
    const code = String(this.data.reviewCode || '').trim();
    if (!code) {
      this.setData({ error: '请输入审核码' });
      return;
    }
    this.setData({ loading: true, error: '' });
    request({
      url: '/api/auth/review-login',
      method: 'POST',
      data: { code },
      redirectOnAuth: false,
    }).then((data) => {
      wx.setStorageSync('token', data.token);
      wx.setStorageSync('reviewEntrySession', true);
      this.finishLogin();
    }).catch((err) => {
      this.setData({ error: err.message || '审核账号登录失败', loading: false });
    });
  },
  loginWith(getCode) {
    this.setData({ loading: true, error: '' });
    getCode((code, phoneCode) => {
      if (!code) {
        this.checking = false;
        this.setData({ error: '手机号快捷登录失败，请重试', loading: false });
        return;
      }
      const data = { code };
      if (phoneCode) data.phoneCode = phoneCode;
      request({
        url: '/api/auth/wechat',
        method: 'POST',
        data,
        redirectOnAuth: false,
      }).then((data) => {
        wx.setStorageSync('token', data.token);
        wx.removeStorageSync('reviewEntrySession');
        if (data.employee) accounts.remember(data.employee);
        if (data.claimed || data.matchedImport) {
          wx.showToast({
            title: data.employee && data.employee.name
              ? '已领取：' + data.employee.name
              : '已领取导入名片',
            icon: 'success',
          });
        }
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
    const share = wx.getStorageSync('pendingShareCard');
    request({
      url: '/api/holder',
      method: 'POST',
      data: favoritePayload(pending, share),
      redirectOnAuth: false,
    }).then(() => {
      wx.removeStorageSync('pendingCardId');
      wx.removeStorageSync('pendingShareCard');
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const completion = favoriteCompletion(pages.length, pending, share);
      if (completion.action === 'back') {
        wx.navigateBack({ delta: completion.delta });
        return;
      }
      wx.redirectTo({ url: completion.url });
    }).catch((err) => {
      wx.removeStorageSync('pendingCardId');
      wx.removeStorageSync('pendingShareCard');
      wx.showToast({ title: err.message || '收藏失败，请重试', icon: 'none' });
      wx.redirectTo({ url: sharedCardPath(pending, share, false) });
    });
  },
});
