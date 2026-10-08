const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');

const PIN_KEY = 'holderPins';

function readPins() {
  const list = wx.getStorageSync(PIN_KEY);
  return Array.isArray(list) ? list : [];
}

Page({
  data: { items: [], error: '', scrollHeight: 600 },
  onLoad() {
    const system = wx.getSystemInfoSync();
    this.actionWidth = Math.round(system.windowWidth / 750 * 280);
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    if (!ensureLogin()) return;
    this.load();
  },
  load() {
    request({ url: '/api/holder' }).then((data) => {
      this.setData({ items: this.withPins(data.items || []), error: '' });
    }).catch((err) => this.setData({ error: err.message }));
  },
  withPins(items) {
    const pins = readPins();
    const rank = new Map(pins.map((id, index) => [id, index]));
    return items.map((item) => ({
      ...item,
      pinned: rank.has(item.cardId),
      offset: 0,
      dragging: false,
    })).sort((a, b) => {
      const ar = rank.has(a.cardId) ? rank.get(a.cardId) : pins.length;
      const br = rank.has(b.cardId) ? rank.get(b.cardId) : pins.length;
      return ar - br;
    });
  },
  onScan() {
    wx.navigateTo({ url: '/pages/holder/scan' });
  },
  onTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    this.startX = touch.clientX;
    this.startOffset = this.data.items[event.currentTarget.dataset.index].offset || 0;
    this.justSwiped = false;
  },
  onTouchMove(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const index = event.currentTarget.dataset.index;
    const dx = touch.clientX - this.startX;
    if (Math.abs(dx) < 8) return;
    this.justSwiped = true;
    let offset = this.startOffset + dx;
    if (offset > 0) offset = 0;
    if (offset < -this.actionWidth) offset = -this.actionWidth;
    const items = this.data.items.map((item, itemIndex) => ({
      ...item,
      dragging: itemIndex === index,
      offset: itemIndex === index ? offset : 0,
    }));
    this.setData({ items });
  },
  onTouchEnd(event) {
    const index = event.currentTarget.dataset.index;
    const current = this.data.items[index];
    const open = current && current.offset < -this.actionWidth / 2;
    const items = this.data.items.map((item, itemIndex) => ({
      ...item,
      dragging: false,
      offset: open && itemIndex === index ? -this.actionWidth : 0,
    }));
    this.setData({ items });
  },
  onOpen(event) {
    if (this.justSwiped) {
      this.justSwiped = false;
      return;
    }
    const index = event.currentTarget.dataset.index;
    if (this.data.items[index] && this.data.items[index].offset) {
      const items = this.data.items.map((item) => ({ ...item, offset: 0 }));
      this.setData({ items });
      return;
    }
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/client/card?cardId=' + id + '&from=holder' });
  },
  onPin(event) {
    const id = event.currentTarget.dataset.id;
    const pinned = String(event.currentTarget.dataset.pinned) === 'true';
    const pins = readPins().filter((item) => item !== id);
    if (!pinned) pins.unshift(id);
    wx.setStorageSync(PIN_KEY, pins);
    this.setData({ items: this.withPins(this.data.items) });
  },
  onDelete(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: '删除名片',
      content: '从名片夹中移除这张名片。',
      confirmText: '删除',
      confirmColor: '#c82423',
      success: (res) => {
        if (!res.confirm) return;
        request({ url: '/api/holder/' + id, method: 'DELETE' }).then(() => {
          wx.setStorageSync(PIN_KEY, readPins().filter((item) => item !== id));
          this.load();
        }).catch((err) => this.setData({ error: err.message }));
      },
    });
  },
});
