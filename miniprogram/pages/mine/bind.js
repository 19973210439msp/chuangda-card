const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');
const accounts = require('../../utils/accounts');

Page({
  data: {
    type: 'phone',
    title: '修改绑定手机',
    value: '',
    code: '',
    hint: '',
    error: '',
    scrollHeight: 600,
  },
  onLoad(options) {
    const type = options.type === 'email' ? 'email' : 'phone';
    this.setData({
      type,
      title: type === 'email' ? '修改绑定邮箱' : '修改绑定手机',
      scrollHeight: pageScrollHeight(),
    });
  },
  onShow() {
    if (!ensureLogin()) return;
  },
  onValue(event) {
    this.setData({ value: event.detail.value });
  },
  onCode(event) {
    this.setData({ code: event.detail.value });
  },
  onSend() {
    const isPhone = this.data.type === 'phone';
    request({
      url: isPhone ? '/api/account/phone/code' : '/api/account/email/code',
      method: 'POST',
      data: isPhone ? { phone: this.data.value } : { email: this.data.value },
    }).then((data) => {
      this.setData({ hint: data.devCode ? '测试验证码 ' + data.devCode : '验证码已发送', error: '' });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onSave() {
    const isPhone = this.data.type === 'phone';
    request({
      url: isPhone ? '/api/account/phone' : '/api/account/email',
      method: 'PUT',
      data: isPhone
        ? { phone: this.data.value, code: this.data.code }
        : { email: this.data.value, code: this.data.code },
    }).then((data) => {
      if (data && data.employee) accounts.remember(data.employee);
      if (data && data.claimed) {
        wx.showToast({ title: '已领取导入名片', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/home/index' }), 600);
        return;
      }
      wx.showToast({ title: '已保存', icon: 'success' });
      wx.navigateBack();
    }).catch((err) => this.setData({ error: err.message }));
  },
});
