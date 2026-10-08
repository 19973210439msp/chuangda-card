const { request, uploadFile } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight, mediaUrl } = require('../../utils/util');

Page({
  data: {
    form: {},
    origin: {},
    phoneCode: '',
    emailCode: '',
    devHint: '',
    error: '',
    scrollHeight: 600,
    wechatQr: '',
  },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    if (!ensureLogin()) return;
    if (this.skipReload) {
      this.skipReload = false;
      return;
    }
    request({ url: '/api/employee/me' }).then((data) => {
      const form = Object.assign({ attachments: [] }, data.employee);
      this.setData({ form, origin: Object.assign({}, form), wechatQr: this.qrUrl(form) });
    }).catch((err) => this.setData({ error: err.message }));
  },
  holdDraft() {
    this.skipReload = true;
  },
  onInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: event.detail.value });
  },
  onCode(event) {
    this.setData({ [event.currentTarget.dataset.key]: event.detail.value });
  },
  chooseImage(kind) {
    this.holdDraft();
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        uploadFile(file.tempFilePath).then((data) => {
          this.setData({ ['form.' + kind]: data.url });
        }).catch((err) => this.setData({ error: err.message }));
      },
    });
  },
  onAvatar() { this.chooseImage('avatar'); },
  onPortrait() { this.chooseImage('portrait'); },
  qrUrl(form) {
    const list = (form && form.attachments) || [];
    const found = list.filter((item) => item && item.name === '微信二维码').pop();
    return found && found.url ? mediaUrl(found.url) : '';
  },
  onWechatQr() {
    this.holdDraft();
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        this.setData({ wechatQr: file.tempFilePath });
        uploadFile(file.tempFilePath).then((data) => {
          const attachments = (this.data.form.attachments || []).filter((item) => !item || item.name !== '微信二维码');
          attachments.push({ name: '微信二维码', url: data.url });
          this.setData({
            'form.attachments': attachments,
            wechatQr: file.tempFilePath,
          });
        }).catch((err) => this.setData({ error: err.message }));
      },
    });
  },
  onAddFile() {
    this.holdDraft();
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        uploadFile(file.path).then((data) => {
          const attachments = (this.data.form.attachments || []).concat([{ name: file.name, url: data.url }]);
          this.setData({ 'form.attachments': attachments });
        }).catch((err) => this.setData({ error: err.message }));
      },
    });
  },
  onRemoveFile(event) {
    const index = event.currentTarget.dataset.index;
    const attachments = (this.data.form.attachments || []).slice();
    const removed = attachments.splice(index, 1)[0];
    const patch = { 'form.attachments': attachments };
    if (removed && removed.name === '微信二维码') patch.wechatQr = '';
    this.setData(patch);
  },
  sendCode(channel) {
    const form = this.data.form;
    const isPhone = channel === 'phone';
    const url = isPhone ? '/api/account/phone/code' : '/api/account/email/code';
    const body = isPhone ? { phone: form.phone } : { email: form.email };
    request({ url, method: 'POST', data: body }).then((data) => {
      this.setData({ devHint: data.devCode ? '测试验证码 ' + data.devCode : '验证码已发送' });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onPhoneCode() { this.sendCode('phone'); },
  onEmailCode() { this.sendCode('email'); },
  onSave() {
    const form = this.data.form;
    const origin = this.data.origin;
    const body = {
      avatar: form.avatar || '',
      portrait: form.portrait || '',
      name: form.name || '',
      company: form.company || '',
      title: form.title || '',
      wechat: form.wechat || '',
      address: form.address || '',
      attachments: form.attachments || [],
    };
    if ((form.phone || '') !== (origin.phone || '')) {
      body.phone = form.phone;
      body.phoneCode = this.data.phoneCode;
    }
    if ((form.email || '') !== (origin.email || '')) {
      body.email = form.email;
      body.emailCode = this.data.emailCode;
    }
    request({ url: '/api/employee/me', method: 'PUT', data: body }).then(() => {
      wx.showToast({ title: '已保存', icon: 'success' });
      wx.navigateBack();
    }).catch((err) => this.setData({ error: err.message }));
  },
});
