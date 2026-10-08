const { request } = require('../../utils/request');
const { decorateCard, decorateCompany, pageScrollHeight } = require('../../utils/util');
const { ensureLogin } = require('../../utils/guard');
const apiBaseUtil = require('../../utils/api-base');

Page({
  data: { card: null, company: null, summary: null, needGuide: false, needPhone: false, flipped: false, error: '', copyLink: '', scrollHeight: 600 },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    if (!ensureLogin()) return;
    this.load();
  },
  load() {
    Promise.all([
      request({ url: '/api/employee/me' }),
      request({ url: '/api/company' }),
      request({ url: '/api/analytics/summary' }),
    ]).then(([me, company, summary]) => {
      this.setData({
        card: decorateCard(me.employee),
        company: decorateCompany(company.company),
        summary: (summary.items && summary.items[0]) || {
          interestIndex: 0,
          views: 0,
          visitors: 0,
          avgDurationSec: 0,
        },
        needGuide: !(me.employee && me.employee.name),
        needPhone: !(me.employee && me.employee.phone),
        error: '',
      });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onFlip() {
    this.setData({ flipped: !this.data.flipped });
  },
  onEdit() {
    wx.navigateTo({ url: '/pages/home/edit' });
  },
  onBindPhone() {
    wx.navigateTo({ url: '/pages/mine/bind?type=phone' });
  },
  onViews() {
    wx.navigateTo({ url: '/pages/employee/stats' });
  },
  onCopy() {
    const card = this.data.card;
    if (!card || !card.id) {
      wx.showToast({ title: '名片还在加载', icon: 'none' });
      return;
    }
    const link = apiBaseUtil.current() + '/card.html?cardId=' + card.id;
    wx.setClipboardData({
      data: link,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' }),
      fail: () => this.setData({ copyLink: link }),
    });
  },
  onCloseCopy() {
    this.setData({ copyLink: '' });
  },
  onCopyHold() {},
  onShareAppMessage() {
    const card = this.data.card || {};
    return {
      title: (card.name || '创大产控') + '的电子名片',
      path: '/pages/client/card?cardId=' + card.id,
    };
  },
});
