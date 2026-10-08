const apiBaseUtil = require('./api-base');

function mediaUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return apiBaseUtil.current() + url;
}

function decorateCard(card) {
  if (!card) return null;
  return Object.assign({}, card, {
    portraitSrc: mediaUrl(card.portrait),
    avatarSrc: mediaUrl(card.avatar),
    initial: (card.name || '名').slice(0, 1),
    roleText: [card.department, card.title].filter(Boolean).join(' · '),
  });
}

function decorateCompany(company) {
  if (!company) return null;
  return Object.assign({}, company, { logoSrc: mediaUrl(company.logo) });
}

function pageScrollHeight() {
  const system = wx.getSystemInfoSync();
  const navHeight = (system.statusBarHeight || 20) + 44;
  const windowHeight = system.windowHeight || system.screenHeight;
  let route = '';
  try {
    const pages = getCurrentPages();
    route = pages.length ? pages[pages.length - 1].route : '';
  } catch (err) {
    route = '';
  }
  const nativeTab = route === 'pages/home/index' || route === 'pages/holder/index' || route === 'pages/mine/index';
  const login = !route || route === 'pages/login/index';
  const safe = system.safeArea ? Math.max(system.screenHeight - system.safeArea.bottom, 0) : 0;
  const tabBar = nativeTab || login ? 0 : 50 + safe;
  return Math.max(windowHeight - navHeight - tabBar, 320);
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
