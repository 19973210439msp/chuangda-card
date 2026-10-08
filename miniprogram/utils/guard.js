function ensureLogin() {
  const pages = getCurrentPages();
  const route = pages.length ? pages[pages.length - 1].route : '';
  if (route.indexOf('pages/client/') === 0 || route.indexOf('pages/login/') === 0) return true;
  if (!wx.getStorageSync('token')) {
    wx.reLaunch({ url: '/pages/login/index' });
    return false;
  }
  return true;
}

module.exports = { ensureLogin };
