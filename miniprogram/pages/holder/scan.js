const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');
const apiBaseUtil = require('../../utils/api-base');

Page({
  data: {
    photo: '',
    draft: null,
    error: '',
    recognizing: false,
    saving: false,
    scrollHeight: 600,
  },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    ensureLogin();
  },
  onChoose() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        this.setData({ photo: file.tempFilePath, draft: null, error: '' });
      },
    });
  },
  onRecognize() {
    if (this.data.recognizing) return;
    if (!this.data.photo) {
      this.setData({ error: '请先拍摄或选择名片照片' });
      return;
    }
    this.setData({ recognizing: true, error: '' });
    apiBaseUtil.resolve().then((base) => {
      wx.uploadFile({
        url: base + '/api/holder/recognize',
        filePath: this.data.photo,
        name: 'photo',
        header: { Authorization: 'Bearer ' + wx.getStorageSync('token') },
        success: (res) => {
          let data = {};
          try { data = JSON.parse(res.data); } catch (err) { data = {}; }
          if (res.statusCode >= 300) {
            this.setData({ error: (data.error && data.error.message) || '识别失败', recognizing: false });
            return;
          }
          this.setData({ draft: data.draft, recognizing: false });
        },
        fail: () => {
          apiBaseUtil.markBroken();
          this.setData({ error: '上传失败', recognizing: false });
        },
      });
    }).catch(() => {
      this.setData({ error: '识别失败', recognizing: false });
    });
  },
  onDraft(event) {
    this.setData({ ['draft.' + event.currentTarget.dataset.key]: event.detail.value });
  },
  onConfirm() {
    if (this.data.saving) return;
    const draft = this.data.draft || {};
    this.setData({ saving: true, error: '' });
    request({
      url: '/api/holder/confirm',
      method: 'POST',
      data: {
        name: draft.name,
        company: draft.company,
        title: draft.title,
        phone: draft.phone,
        wechat: draft.wechat,
        email: draft.email,
        address: draft.address,
      },
    }).then(() => {
      this.setData({ saving: false });
      wx.showToast({ title: '已存入名片夹', icon: 'success' });
      wx.navigateBack();
    }).catch((err) => this.setData({ saving: false, error: err.message }));
  },
});
