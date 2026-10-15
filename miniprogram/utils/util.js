const apiBaseUtil = require('./api-base');

function mediaUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return apiBaseUtil.current() + url;
}

function decorateCard(card) {
  if (!card) return null;
  return Object.assign({}, card, {
    initial: (card.name || '名').slice(0, 1),
    roleText: [card.department, card.title].filter(Boolean).join(' · '),
  });
}

function decorateCompany(company) {
  if (!company) return null;
  return Object.assign({}, company, { logoSrc: mediaUrl(company.logo), qrSrc: company.qrUrl ? mediaUrl(company.qrUrl) : '/assets/official-qr.jpg' });
}

function pageScrollHeight() {
  const system = wx.getSystemInfoSync();
  const statusBarHeight = system.statusBarHeight || 20;
  const navHeight = statusBarHeight + 44;
  const screenHeight = system.screenHeight || system.windowHeight;
  let route = '';
  try {
    const pages = getCurrentPages();
    route = pages.length ? pages[pages.length - 1].route : '';
  } catch (err) {
    route = '';
  }
  const withTab = route === 'pages/home/edit'
    || route === 'pages/holder/scan'
    || route === 'pages/employee/stats';
  const safe = system.safeArea ? Math.max(screenHeight - system.safeArea.bottom, 0) : 0;
  const rpx = (system.screenWidth || 375) / 750;
  const customTab = Math.round(100 * rpx) + safe;
  const tabBar = withTab ? customTab : 0;
  return Math.max(screenHeight - navHeight - tabBar, 320);
}

function visitorId() {
  let id = wx.getStorageSync('visitorId');
  if (!id) {
    id = 'mp-' + Math.random().toString(36).slice(2, 10);
    wx.setStorageSync('visitorId', id);
  }
  return id;
}

module.exports = { mediaUrl, decorateCard, decorateCompany, visitorId, pageScrollHeight };
