const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');

const PAGE_SIZE = 30;

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function exchangeText(exchange) {
  if (!exchange) return '';
  return [exchange.name, exchange.phone, exchange.company].filter(Boolean).join(' ');
}

function visitorLabel(item) {
  return item.name || '游客访问';
}

function mapItems(items) {
  return (items || []).map((item) => ({
    ...item,
    label: visitorLabel(item),
    when: formatWhen(item.startedAt),
    detail: [item.title, item.company, item.phone].filter(Boolean).join(' · '),
    exchangeText: exchangeText(item.exchange),
  }));
}

function mapVisitors(items) {
  return (items || []).map((item) => ({
    ...item,
    label: visitorLabel(item),
    key: item.visitorId || item.lastAt || 'visitor',
    when: formatWhen(item.lastAt),
    detail: [item.title, item.company, item.phone].filter(Boolean).join(' · '),
  }));
}

Page({
  data: {
    mode: 'views',
    title: '浏览详情',
    items: [],
    visitors: [],
    total: 0,
    page: 1,
    hasMore: false,
    loadingMore: false,
    error: '',
    scrollHeight: 600,
  },
  onLoad(options) {
    const mode = options.mode === 'visitors' ? 'visitors' : 'views';
    this.setData({
      mode,
      title: mode === 'visitors' ? '访客详情' : '浏览详情',
      scrollHeight: pageScrollHeight(),
    });
  },
  onShow() {
    if (!ensureLogin()) return;
    if (this.data.mode === 'visitors') this.loadVisitors();
    else this.loadPage(1, true);
  },
  loadVisitors() {
    request({ url: '/api/analytics/visitors' }).then((data) => {
      const visitors = mapVisitors(data.items);
      this.setData({
        visitors,
        total: Number(data.total) || visitors.length,
        error: '',
      });
    }).catch((err) => this.setData({ error: err.message }));
  },
  loadPage(page, replace) {
    if (!replace) this.setData({ loadingMore: true });
    request({ url: '/api/analytics/list?page=' + page + '&limit=' + PAGE_SIZE }).then((list) => {
      const mapped = mapItems(list.items);
      const items = replace ? mapped : (this.data.items || []).concat(mapped);
      const total = Number(list.total) || 0;
      this.setData({
        items,
        total,
        page: Number(list.page) || page,
        hasMore: items.length < total,
        loadingMore: false,
        error: '',
      });
    }).catch((err) => this.setData({ error: err.message, loadingMore: false }));
  },
  onLoadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadPage((this.data.page || 1) + 1, false);
  },
  onCall(event) {
    const phone = event.currentTarget.dataset.phone;
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: String(phone) });
  },
});
