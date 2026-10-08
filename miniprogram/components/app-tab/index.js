Component({
  data: { current: '' },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      const page = pages.length ? pages[pages.length - 1] : null;
      const route = page && page.route ? page.route : '';
      const from = page && page.options ? page.options.from : '';
      let current = '';
      if (route.indexOf('pages/home/') === 0 || route.indexOf('pages/employee/') === 0) current = 'home';
      else if (route.indexOf('pages/holder/') === 0 || from === 'holder') current = 'holder';
      else if (route.indexOf('pages/mine/') === 0) current = 'mine';
      this.setData({ current });
    },
  },
  methods: {
    onTab(event) {
      const url = event.currentTarget.dataset.url;
      if (!url) return;
      wx.switchTab({ url });
    },
  },
});
