Component({
  properties: {
    title: { type: String, value: '创大产控' },
  },
  data: {
    statusBarHeight: 20,
    navHeight: 64,
    showBack: false,
  },
  lifetimes: {
    attached() {
      const system = wx.getSystemInfoSync();
      const statusBarHeight = system.statusBarHeight || 20;
      const pages = getCurrentPages();
      const route = pages.length ? pages[pages.length - 1].route : '';
      const tab = route === 'pages/home/index' || route === 'pages/holder/index' || route === 'pages/mine/index';
      const rootLogin = pages.length <= 1 && route === 'pages/login/index';
      const guestCard = pages.length <= 1 && route === 'pages/client/card' && !wx.getStorageSync('token');
      this.setData({
        statusBarHeight,
        navHeight: statusBarHeight + 44,
        showBack: !tab && !rootLogin && !guestCard,
      });
    },
  },
  methods: {
    onBack() {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
        return;
      }
      const route = pages.length ? pages[0].route : '';
      if (route === 'pages/client/card' && !wx.getStorageSync('token')) return;
      wx.switchTab({ url: '/pages/home/index' });
    },
  },
});
