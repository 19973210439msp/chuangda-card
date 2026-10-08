const apiBaseUtil = require('../../utils/api-base');

const WECHAT_MARK = '/assets/wechat-logo.jpg';

function remoteQr(card, base) {
  const list = (card && card.attachments) || [];
  const wechatQr = list.filter((item) => item && item.name === '微信二维码' && item.url).pop();
  if (!wechatQr) return '';
  const url = wechatQr.url;
  if (/^https?:\/\//.test(url)) return url;
  return base + url;
}

Component({
  properties: {
    card: { type: Object, value: null },
    company: { type: Object, value: null },
    flipped: { type: Boolean, value: false },
  },
  data: {
    qrSrc: '',
    corpScale: 1,
    brandScale: 1,
  },
  observers: {
    'card, company, flipped': function (card, company, flipped) {
      this.setQr(card);
      if (!flipped) this.queueFit();
    },
  },
  lifetimes: {
    attached() {
      this.setQr(this.data.card);
      this.queueFit();
    },
  },
  methods: {
    setQr(card) {
      const apply = (base) => {
      const remote = remoteQr(card, base);
      if (!remote) {
        this.remoteQr = '';
        this.pendingQr = '';
        this.setData({ qrSrc: card ? WECHAT_MARK : '' });
        return;
      }
      if (remote === this.remoteQr || remote === this.pendingQr) return;
      this.pendingQr = remote;
      wx.request({
        url: remote,
        responseType: 'arraybuffer',
        success: (res) => {
          if (this.pendingQr !== remote || res.statusCode !== 200 || !res.data) return;
          const ext = /\/qr(\?|$)/.test(remote) ? 'png' : 'jpg';
          const filePath = wx.env.USER_DATA_PATH + '/card-qr-' + (card && card.id ? card.id : 'x') + '-' + Date.now().toString(36) + '.' + ext;
          wx.getFileSystemManager().writeFile({
            filePath,
            data: res.data,
            success: () => {
              if (this.pendingQr !== remote) return;
              this.remoteQr = remote;
              this.setData({ qrSrc: filePath });
            },
            fail: () => {
              if (this.pendingQr === remote) this.pendingQr = '';
            },
          });
        },
        fail: () => {
          if (this.pendingQr === remote) this.pendingQr = '';
        },
      });
      };
      apiBaseUtil.resolve().then(apply);
    },
    queueFit() {
      wx.nextTick(() => this.fitNames());
    },
    fitNames() {
      const query = this.createSelectorQuery();
      query.select('.corp-cn').boundingClientRect();
      query.select('.corp-en').boundingClientRect();
      query.select('.brand-cn').boundingClientRect();
      query.select('.brand-en').boundingClientRect();
      query.exec((rects) => {
        const corpCn = rects && rects[0];
        const corpEn = rects && rects[1];
        const brandCn = rects && rects[2];
        const brandEn = rects && rects[3];
        const corpScale = scaleTo(corpCn, corpEn, this.data.corpScale);
        const brandScale = scaleTo(brandCn, brandEn, this.data.brandScale);
        if (Math.abs(corpScale - this.data.corpScale) < 0.01 && Math.abs(brandScale - this.data.brandScale) < 0.01) return;
        this.setData({ corpScale, brandScale });
      });
    },
  },
});

function scaleTo(target, text, current) {
  const applied = current > 0 ? current : 1;
  if (!target || !text || target.width < 1 || text.width < 1) return 1;
  const natural = text.width / applied;
  if (natural < 1) return 1;
  return target.width / natural;
}
