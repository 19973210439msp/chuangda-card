const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');

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

Page({
  data: { items: [], error: '', scrollHeight: 600 },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    if (!ensureLogin()) return;
    request({ url: '/api/analytics/list' }).then((list) => {
      const items = (list.items || []).map((item) => ({
        ...item,
        when: formatWhen(item.startedAt),
        exchangeText: exchangeText(item.exchange),
      }));
      this.setData({ items, error: '' });
    }).catch((err) => this.setData({ error: err.message }));
  },
});
