const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');
const accounts = require('../../utils/accounts');

Page({
  data: {
    currentText: '',
    phone: '',
    code: '',
    error: '',
    devHint: '',
    sending: false,
    saving: false,
    codeReady: false,
    countdown: 0,
    scrollHeight: 600,
    accounts: [],
  },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    if (!ensureLogin()) return;
    Promise.all([
      request({ url: '/api/employee/me' }),
      request({ url: '/api/account/phones' }),
    ]).then(([data, list]) => {
      const employee = data.employee || {};
      const rows = ((list && list.items) || []).filter((item) => String(item.phone || '').trim()).map((item) => {
        const name = String(item.name || '').trim();
        let nameText = '可切换回来';
        if (name && item.current) nameText = name + ' · 当前';
        else if (name) nameText = name;
        else if (item.current) nameText = '当前使用';
        return Object.assign({}, item, {
          phoneText: accounts.maskPhone(item.phone),
          nameText,
        });
      });
      this.setData({
        currentText: accounts.maskPhone(employee.authPhone || employee.phone) || '未绑定',
        accounts: rows,
        error: '',
      });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onUnload() {
    if (this.timer) clearInterval(this.timer);
  },
  onPhone(event) {
    this.setData({ phone: String(event.detail.value || '').replace(/\D/g, '').slice(0, 11) });
  },
  onCode(event) {
    this.setData({ code: String(event.detail.value || '').replace(/\D/g, '').slice(0, 6) });
  },
  onSend() {
    const phone = this.data.phone;
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ error: '请输入 11 位手机号' });
      return;
    }
    this.setData({ sending: true, error: '', devHint: '' });
    request({ url: '/api/account/phone/code', method: 'POST', data: { phone } }).then((data) => {
      const hint = data && data.devCode ? '当前环境未接短信，验证码是 ' + data.devCode : '验证码已发送';
      this.setData({ sending: false, devHint: hint, countdown: 60, codeReady: true });
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => {
        const left = this.data.countdown - 1;
        if (left <= 0) {
          clearInterval(this.timer);
          this.timer = null;
          this.setData({ countdown: 0 });
          return;
        }
        this.setData({ countdown: left });
      }, 1000);
    }).catch((err) => this.setData({ sending: false, error: err.message }));
  },
  onSwitch(event) {
    const personId = event.currentTarget.dataset.id;
    if (!personId) return;
    this.setData({ error: '' });
    request({ url: '/api/account/switch', method: 'POST', data: { personId } }).then(() => {
      wx.showToast({ title: '已切换账号', icon: 'success' });
      setTimeout(() => wx.switchTab({ url: '/pages/home/index' }), 400);
    }).catch((err) => this.setData({ error: err.message }));
  },
  onSubmit() {
    const phone = this.data.phone;
    const code = this.data.code;
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ error: '请输入 11 位手机号' });
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      this.setData({ error: '请填写 6 位验证码' });
      return;
    }
    this.setData({ saving: true, error: '' });
    request({ url: '/api/account/phone', method: 'PUT', data: { phone, code } }).then((data) => {
      this.setData({ saving: false });
      wx.showToast({ title: data && data.loggedIn ? '已登录该账号' : '已更换手机号', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 400);
    }).catch((err) => this.setData({ saving: false, error: err.message }));
  },
});
