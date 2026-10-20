const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');
const accounts = require('../../utils/accounts');

Page({
  data: {
    employee: null,
    phoneText: '',
    certText: '未认证',
    error: '',
    scrollHeight: 600,
  },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    if (!ensureLogin()) return;
    request({ url: '/api/employee/me' }).then((data) => {
      const employee = data.employee || {};
      accounts.remember(employee);
      return Promise.all([Promise.resolve(employee), request({ url: '/api/employee/certification' })]);
    }).then(([employee, cert]) => {
      const certified = (cert && cert.certified) || [];
      const pending = (cert && cert.pending) || [];
      let certText = '未认证';
      if (certified.length > 1) certText = '已认证' + certified.length + '家';
      else if (certified.length === 1) certText = '已认证';
      else if (pending.length) certText = '审核中';
      this.setData({
        employee,
        phoneText: accounts.maskPhone(employee.authPhone || employee.phone),
        certText,
        error: '',
      });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onPhone() {
    wx.navigateTo({ url: '/pages/mine/phone' });
  },
  onCert() {
    wx.navigateTo({ url: '/pages/mine/cert' });
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
