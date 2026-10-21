const { request } = require('../../utils/request');
const { decorateCard, decorateCompany, visitorId, pageScrollHeight } = require('../../utils/util');
const { favoritePayload } = require('../../utils/favorite-flow');

function contactClient() {
  let info = {};
  let sys = {};
  try { info = wx.getDeviceInfo ? wx.getDeviceInfo() : {}; } catch (err) { info = {}; }
  try { sys = wx.getSystemInfoSync(); } catch (err) { sys = {}; }
  const platform = String(info.platform || sys.platform || '').toLowerCase();
  const blob = [platform, info.system, info.brand, sys.system, sys.brand].join(' ');
  if (platform === 'windows' || platform === 'mac' || platform === 'devtools') return 'desktop';
  if (/ohos|harmony|openharmony/i.test(blob)) return 'harmony';
  return 'phone';
}

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
    this.shareCard = options.shareCard || '';
    this.from = options.from || '';
    this.viewId = '';
    this.viewToken = '';
    this.started = Date.now();
    if (options.collected === '1') {
      this.kept = true;
      this.setData({ favorited: true, canFavorite: false });
    }
  },
  onShow() {
    if (!this.cardId) {
      this.setData({ error: '缺少名片编号' });
      return;
    }
    const query = this.shareCard ? '?shareCard=' + encodeURIComponent(this.shareCard) : '';
    Promise.all([
      request({ url: '/api/cards/' + this.cardId + query, redirectOnAuth: false, auth: false }),
      request({ url: '/api/company', redirectOnAuth: false, auth: false }),
    ]).then(([data, company]) => {
      this.setData({
        card: decorateCard(data.card),
        company: decorateCompany(data.company || company.company),
        error: '',
      });
      if (data.card && this.from !== 'holder') this.startView();
      this.showFavorite();
    }).catch((err) => this.setData({ error: err.message, card: null }));
  },
  onFlip() {
    this.setData({ flipped: !this.data.flipped });
  },
  showFavorite() {
    if (this.from === 'holder' || this.kept) {
      this.setData({ favorited: true, canFavorite: false });
      return;
    }
    this.setData({ favorited: false, canFavorite: true });
  },
  saveFavorite() {
    request({
      url: '/api/holder',
      method: 'POST',
      data: favoritePayload(this.cardId, this.shareCard),
    }).then((data) => {
      wx.removeStorageSync('pendingCardId');
      wx.removeStorageSync('pendingShareCard');
      this.kept = true;
      this.setData({ favorited: true, canFavorite: false });
      if (!data.already) wx.showToast({ title: '已收入名片夹', icon: 'success' });
    }).catch((err) => {
      if (err.statusCode === 401 || err.code === 'ACCOUNT_INACTIVE') return;
      wx.removeStorageSync('pendingCardId');
      wx.removeStorageSync('pendingShareCard');
      const message = err.message || '';
      if (message.indexOf('自己') >= 0) {
        this.setData({ canFavorite: false, favorited: false, error: message });
        return;
      }
      this.setData({ error: message, canFavorite: true, favorited: false });
    });
  },
  onFavorite() {
    wx.setStorageSync('pendingCardId', this.cardId);
    if (this.shareCard) wx.setStorageSync('pendingShareCard', this.shareCard);
    else wx.removeStorageSync('pendingShareCard');
    if (!wx.getStorageSync('token')) {
      wx.navigateTo({ url: '/pages/login/index' });
      return;
    }
    this.saveFavorite();
  },
  onHide() { this.report(); },
  onUnload() { this.report(); },
  startView() {
    if (this.viewId || this.starting) return;
    this.starting = true;
    request({
      url: '/api/analytics/view',
      method: 'POST',
      data: { cardId: this.cardId, shareCard: this.shareCard, visitorId: visitorId() },
      redirectOnAuth: false,
      auth: !!wx.getStorageSync('token'),
    }).then((data) => {
      this.viewId = data.viewId;
      this.viewToken = data.updateToken || '';
      this.started = Date.now();
    }).catch(() => {
      this.starting = false;
    });
  },
  report() {
    if (!this.viewId || this.reported) return;
    this.reported = true;
    const durationSec = Math.round((Date.now() - this.started) / 1000);
    request({
      url: '/api/analytics/view/' + this.viewId,
      method: 'PUT',
      data: { updateToken: this.viewToken, durationSec },
      redirectOnAuth: false,
      auth: false,
    }).catch(() => {});
  },
  onCall() {
    if (!this.data.card || !this.data.card.phone) return;
    wx.makePhoneCall({ phoneNumber: this.data.card.phone });
  },
  onSaveContact() {
    const card = this.data.card;
    if (!card) return;
    const phone = String(card.phone || '').trim();
    const showFail = (reason) => {
      wx.showModal({
        title: '保存失败',
        content: reason + (phone ? '\n电话：' + phone + '\n点「复制号码」，再到手机通讯录里手动添加。' : '\n这张名片没有电话号码。'),
        confirmText: phone ? '复制号码' : '知道了',
        cancelText: '关闭',
        showCancel: !!phone,
        success: (res) => {
          if (!res.confirm || !phone) return;
          wx.setClipboardData({
            data: phone,
            success: () => wx.showToast({ title: '号码已复制', icon: 'none' }),
            fail: () => wx.showToast({ title: '请手动记下 ' + phone, icon: 'none' }),
          });
        },
      });
    };
    const client = contactClient();
    if (client === 'desktop') {
      showFail('电脑版微信不能把联系人写入手机通讯录。请用手机微信打开这张名片后再保存。');
      return;
    }
    if (client === 'harmony') {
      showFail('鸿蒙版微信目前不能把联系人写入通讯录。');
      return;
    }
    if (!wx.canIUse('addPhoneContact')) {
      showFail('当前手机微信不能把联系人写入通讯录。');
      return;
    }
    let settled = false;
    try {
      wx.addPhoneContact({
        firstName: card.name || '名片',
        mobilePhoneNumber: phone,
        organization: card.company || '',
        title: card.title || '',
        email: card.email || '',
        weChatNumber: card.wechat || '',
        workAddressStreet: card.address || '',
        success: () => { settled = true; },
        fail: () => {
          settled = true;
          showFail('微信没有完成保存。');
        },
        complete: () => {
          if (settled) return;
          settled = true;
          showFail('微信没有完成保存。');
        },
      });
    } catch (err) {
      showFail('微信没有完成保存。');
    }
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
      data: { updateToken: this.viewToken, exchange },
      redirectOnAuth: false,
      auth: false,
    }).then(() => {
      this.setData({ exchangeOpen: false, error: '' });
      wx.showToast({ title: '已提交', icon: 'success' });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onShareAppMessage() {
    const card = this.data.card || {};
    return {
      title: '这是我的数字名片，望惠存',
      path: '/pages/client/card?cardId=' + this.cardId + (this.shareCard ? '&shareCard=' + this.shareCard : ''),
    };
  },
});
