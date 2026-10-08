var apiBaseUtil = require('./utils/api-base.js');

App({
  globalData: {
    // 先同步取上次可用地址，保证首屏不空白；随后由 autoSelect() 探测结果校正
    apiBase: apiBaseUtil.readCached(),
    apiSource: 'default'
  },

  onLaunch() {
    this.autoSelect();
  },

  onShow(options) {
    const path = (options && options.path) || '';
    const scene = options && options.scene;
    // 分享卡片 / 群聊 / 扫码打开名片页时保留在名片，不要弹回首页
    const shareScenes = [1007, 1008, 1011, 1025, 1036, 1044, 1047, 1048, 1049, 1073, 1074, 1096];
    const openedShare = path.indexOf('pages/client/card') === 0 && shareScenes.indexOf(scene) >= 0;
    if (path.indexOf('pages/client/card') === 0 && !openedShare) {
      wx.switchTab({ url: '/pages/home/index' });
    }
  },

  autoSelect(force) {
    var self = this;
    this.globalData.apiReady = apiBaseUtil.resolve(force).then(function (base) {
      self.globalData.apiBase = base;
      self.globalData.apiSource = base.indexOf('cpolar') > -1 ? 'public' : 'lan';
      console.log('[api] 后端地址 =', base);
      return base;
    });
    return this.globalData.apiReady;
  }
});
