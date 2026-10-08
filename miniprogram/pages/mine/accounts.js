const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');
const accounts = require('../../utils/accounts');

Page({
  data: { accounts: [], error: '', scrollHeight: 600 },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    if (!ensureLogin()) return;
    request({ url: '/api/employee/me' }).then((data) => {
      const employee = data.employee || {};
      accounts.remember(employee);
      this.setData({ accounts: accounts.present(employee.id), error: '' });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onPick(event) {
    const id = event.currentTarget.dataset.id;
    const account = this.data.accounts.find((item) => item.employeeId === id);
    if (!account) return;
    if (account.current) {
      wx.navigateTo({ url: '/pages/mine/bind?type=phone' });
      return;
    }
    accounts.activate(account);
    wx.switchTab({ url: '/pages/home/index' });
  },
  onAdd() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('devOpenId');
    wx.setStorageSync('addingAccount', '1');
    wx.reLaunch({ url: '/pages/login/index' });
  },
});
