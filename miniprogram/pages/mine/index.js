const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');
const accounts = require('../../utils/accounts');

Page({
  data: {
    employee: null,
    phoneText: '',
    permissionText: '一级 · 普通名片权限',
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
      const level = (data.permission || {}).level || 1;
      this.setData({
        employee,
        phoneText: accounts.maskPhone(employee.authPhone || employee.phone),
        permissionText: level === 3 ? '三级 · 全企业名片权限' : level === 2 ? '二级 · 指定企业名片权限' : '一级 · 普通名片权限',
        error: '',
      });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onPhone() {
    wx.navigateTo({ url: '/pages/mine/phone' });
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
