const { request } = require('../../utils/request');
const { decorateCard, decorateCompany, pageScrollHeight } = require('../../utils/util');
const { ensureLogin } = require('../../utils/guard');
const { sharedCardPath } = require('../../utils/favorite-flow');
const { emptyCardState } = require('../../utils/card-home-state');
const apiBaseUtil = require('../../utils/api-base');

Page({
  data: {
    card: null,
    company: null,
    summary: null,
    hasCard: false,
    canEdit: false,
    canCreate: false,
    emptyState: emptyCardState({}),
    needGuide: false,
    needPhone: false,
    flipped: false,
    error: '',
    copyLink: '',
    scrollHeight: 600,
  },
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
      request({ url: '/api/analytics/summary' }),
      request({ url: '/api/employee/templates' }),
    ]).then(([me, summary, available]) => {
      const hasCard = !!(me.employee && me.employee.activeCardId);
      this.setData({
        card: decorateCard(me.employee),
        company: decorateCompany(me.templateCompany),
        hasCard,
        canEdit: !!me.canEdit,
        canCreate: !!(available.items || []).length,
        emptyState: emptyCardState({
          hasCard,
          templates: available.items || [],
          permission: me.permission,
        }),
        summary: (summary.items && summary.items[0]) || {
          interestIndex: 0,
          views: 0,
          visitors: 0,
          avgDurationSec: 0,
        },
        needGuide: !!(me.canEdit && me.employee && me.employee.activeCardId && !me.employee.name),
        needPhone: !(me.employee && me.employee.phone),
        error: '',
      });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onFlip() {
    this.setData({ flipped: !this.data.flipped });
  },
  onSwitch() {
    wx.navigateTo({ url: '/pages/home/switch?mode=switch' });
  },
  onStyle() {
    if (!this.data.canEdit && !this.data.canCreate) return;
    wx.navigateTo({ url: '/pages/home/switch?mode=style' });
  },
  onEdit() {
    if (!this.data.canEdit) return;
    if (!this.data.hasCard) {
      wx.navigateTo({ url: '/pages/home/switch?mode=style' });
      return;
    }
    wx.navigateTo({ url: '/pages/home/edit' });
  },
  onEmptyAction() {
    if (this.data.emptyState.kind === 'ready') {
      wx.navigateTo({ url: '/pages/home/switch?mode=create' });
      return;
    }
    wx.showToast({ title: '请联系管理员分配名片或权限', icon: 'none' });
  },
  onBindPhone() {
    wx.showModal({
      title: '需要重新登录',
      content: '手机号仅在登录时通过微信授权获取。是否退出并重新授权登录？',
      confirmText: '去登录',
      success: (res) => {
        if (!res.confirm) return;
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/index' });
      },
    });
  },
  onViews() {
    wx.navigateTo({ url: '/pages/employee/stats?mode=views' });
  },
  onVisitors() {
    wx.navigateTo({ url: '/pages/employee/stats?mode=visitors' });
  },
  onCopy() {
    const card = this.data.card;
    if (!this.data.hasCard || !card || !card.id) {
      wx.showToast({ title: '暂无可用名片', icon: 'none' });
      return;
    }
    const link = apiBaseUtil.current() + '/card.html?cardId=' + card.id
      + (card.activeCardId ? '&shareCard=' + encodeURIComponent(card.activeCardId) : '');
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
    if (!this.data.hasCard) return { title: '创大产控', path: '/pages/home/index' };
    return {
      title: '这是我的数字名片，望惠存',
      path: sharedCardPath(card.id, card.activeCardId, false),
    };
  },
});
