var apiBaseUtil = require('./utils/api-base.js');

App({
  globalData: {
    // 同步设置后端地址，供首屏和资源链接使用。
    apiBase: apiBaseUtil.readCached(),
    apiSource: 'default'
  },

  onLaunch() {
    this.autoSelect();
  },

  onShow() {},

  autoSelect(force) {
    var self = this;
    this.globalData.apiReady = apiBaseUtil.resolve(force).then(function (base) {
      self.globalData.apiBase = base;
      self.globalData.apiSource = 'server';
      console.log('[api] 后端地址 =', base);
      return base;
    });
    return this.globalData.apiReady;
  }
});
