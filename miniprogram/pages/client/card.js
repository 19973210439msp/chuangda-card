const { request } = require('../../utils/request');
const { decorateCard, decorateCompany, visitorId, pageScrollHeight } = require('../../utils/util');

Page({
  data: {
    card: null,
    company: null,
    error: '',
    exchangeOpen: false,
    exchange: { name: '', phone: '', company: '' },
    favorited: false,
    canFavorite: false,
    flipped: false,
    scrollHeight: 600,
  },
  onLoad(options) {
    this.setData({ scrollHeight: pageScrollHeight() });
    this.cardId = options.cardId || '';
    this.from = options.from || '';
    this.viewId = '';
    this.started = Date.now();
  },
  onShow() {
    if (!this.cardId) {
      this.setData({ error: '缺少名片编号' });
      return;
    }
    request({ url: '/api/cards/' + this.cardId, redirectOnAuth: false }).then((data) => {
      this.setData({
        card: decorateCard(data.card),
        company: decorateCompany(data.company),
        error: '',
      });
      if (data.company && this.from !== 'holder') this.startView();
      this.keepCard();
    }).catch((err) => this.setData({ error: err.message, card: null }));
  },
  onFlip() {
    this.setData({ flipped: !this.data.flipped });
  },
  keepCard() {
    if (this.from === 'holder') {
      this.setData({ favorited: true, canFavorite: false });
      return;
    }
    if (!wx.getStorageSync('token')) {
      this.setData({ favorited: false, canFavorite: true });
      return;
    }
    if (this.kept) return;
    this.kept = true;
    request({
      url: '/api/holder',
      method: 'POST',
      data: { cardId: this.cardId },
      redirectOnAuth: false,
    }).then((data) => {
      this.setData({ favorited: true, canFavorite: false });
      if (!data.already) wx.showToast({ title: '已收入名片夹', icon: 'success' });
    }).catch((err) => {
      this.kept = false;
      const message = err.message || '';
      if (message.indexOf('自己') >= 0) {
        this.setData({ canFavorite: false, favorited: false });
        return;
      }
      this.setData({ canFavorite: true, favorited: false });
    });
  },
  onFavorite() {
    wx.setStorageSync('pendingCardId', this.cardId);
    wx.navigateTo({ url: '/pages/login/index' });
  },
  onHide() { this.report(); },
  onUnload() { this.report(); },
  startView() {
    if (this.viewId || this.starting) return;
    this.starting = true;
    request({
      url: '/api/analytics/view',
      method: 'POST',
      data: { cardId: this.cardId, visitorId: visitorId() },
      redirectOnAuth: false,
    }).then((data) => {
      this.viewId = data.viewId;
      this.started = Date.now();
    }).catch(() => {});
  },
  report() {
    if (!this.viewId || this.reported) return;
    this.reported = true;
    const durationSec = Math.round((Date.now() - this.started) / 1000);
    request({
      url: '/api/analytics/view/' + this.viewId,
      method: 'PUT',
      data: { durationSec },
      redirectOnAuth: false,
    }).catch(() => {});
  },
  onCall() {
    if (!this.data.card || !this.data.card.phone) return;
    wx.makePhoneCall({ phoneNumber: this.data.card.phone });
  },
  onSaveContact() {
    const card = this.data.card;
    if (!card) return;
    wx.addPhoneContact({
      firstName: card.name || '名片',
      mobilePhoneNumber: card.phone || '',
      organization: card.company || '',
      title: card.title || '',
      email: card.email || '',
      weChatNumber: card.wechat || '',
      workAddressStreet: card.address || '',
    });
  },
  onWechat() {
    const card = this.data.card;
    if (!card || !card.wechat) return;
    wx.setClipboardData({ data: card.wechat });
  },
  onExchange() { this.setData({ exchangeOpen: true }); },
  onExchangeInput(event) {
    this.setData({ ['exchange.' + event.currentTarget.dataset.key]: event.detail.value });
  },
  onExchangeCancel() { this.setData({ exchangeOpen: false }); },
  onExchangeSubmit() {
    if (!this.viewId) {
      this.setData({ error: '请从分享链接打开后再交换名片' });
      return;
    }
    const exchange = this.data.exchange;
    request({
      url: '/api/analytics/view/' + this.viewId,
      method: 'PUT',
      data: { exchange },
      redirectOnAuth: false,
    }).then(() => {
      this.setData({ exchangeOpen: false, error: '' });
      wx.showToast({ title: '已提交', icon: 'success' });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onShareAppMessage() {
    const card = this.data.card || {};
    return {
      title: (card.name || '创大产控') + '的电子名片',
      path: '/pages/client/card?cardId=' + this.cardId,
    };
  },
});
