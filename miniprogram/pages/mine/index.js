const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');
const apiBaseUtil = require('../../utils/api-base');
const accounts = require('../../utils/accounts');

Page({
  data: {
    employee: null,
    phoneText: '',
    email: '',
    emailText: '',
    error: '',
    scrollHeight: 600,
    apiBase: '',
    apiSource: '',
  },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
    this.syncApiBase();
  },
  syncApiBase() {
    const app = getApp();
    const sync = () => {
      const base = (app.globalData && app.globalData.apiBase) || '';
      this.setData({
        apiBase: base,
        apiSource: base.indexOf('cpolar') > -1 ? '公网穿透' : '局域网',
      });
    };
    sync();
    if (app.globalData && app.globalData.apiReady) app.globalData.apiReady.then(sync);
  },
  onNetTap() {
    wx.showModal({
      title: '后端地址',
      content: this.data.apiBase,
      editable: true,
      placeholderText: 'http://xxx.cpolar.top',
      confirmText: '保存',
      success: (res) => {
        if (!res.confirm) return;
        const value = (res.content || '').trim();
        const app = getApp();
        if (!value) {
          apiBaseUtil.clearOverride();
          app.autoSelect(true).then(() => {
            this.syncApiBase();
            wx.showToast({ title: '已恢复自动', icon: 'none' });
          });
          return;
        }
        apiBaseUtil.setOverride(value);
        app.globalData.apiBase = value.replace(/\/$/, '');
        app.globalData.apiReady = Promise.resolve(app.globalData.apiBase);
        this.syncApiBase();
        wx.showToast({ title: '已切换', icon: 'none' });
      },
    });
  },
  onShow() {
    if (!ensureLogin()) return;
    request({ url: '/api/employee/me' }).then((data) => {
      const employee = data.employee || {};
      accounts.remember(employee);
      this.setData({
        employee,
        phoneText: accounts.maskPhone(employee.phone),
        email: employee.email || '',
        emailText: employee.email || '',
        error: '',
      });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onAccounts() {
    wx.navigateTo({ url: '/pages/mine/accounts' });
  },
  onEmail() {
    wx.navigateTo({ url: '/pages/mine/bind?type=email' });
  },
  onClose() {
    wx.showModal({
      title: '注销账号',
      content: '注销后客户无法打开你的名片，名片夹也不再列出。名片正文、浏览记录和收藏引用会保留，管理员可以恢复。',
      confirmText: '注销',
      confirmColor: '#c82423',
      success: (res) => {
        if (!res.confirm) return;
        request({ url: '/api/account/close', method: 'POST', data: {} }).then(() => {
          wx.removeStorageSync('token');
          wx.reLaunch({ url: '/pages/login/index' });
        }).catch((err) => this.setData({ error: err.message }));
      },
    });
  },
});
