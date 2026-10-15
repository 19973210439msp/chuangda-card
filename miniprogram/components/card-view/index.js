const apiBaseUtil = require('../../utils/api-base');

Component({
  properties: {
    card: { type: Object, value: null },
    company: { type: Object, value: null },
    flipped: { type: Boolean, value: false },
  },
  data: {
    corpScale: 1,
    corpCnScale: 1,
    brandScale: 1,
  },
  observers: {
    'card, company, flipped': function (card, company, flipped) {
      if (!flipped) this.queueFit();
    },
  },
  lifetimes: {
    attached() {
      this.queueFit();
    },
  },
  methods: {
    queueFit() {
      this._fitPass = 0;
      wx.nextTick(() => this.fitNames());
    },
    onScanOfficial() {
      const local = (this.properties.company && this.properties.company.qrSrc) || '/assets/official-qr.jpg';
      const open = (url) => wx.previewImage({ current: url, urls: [url] });
      apiBaseUtil.resolve().then((base) => {
        open(/^https?:\/\//.test(local) ? local : String(base || '').replace(/\/$/, '') + (local === '/assets/official-qr.jpg' ? '/official-qr.jpg' : local));
      }).catch(() => open(local));
    },
    fitNames() {
      const query = this.createSelectorQuery();
      query.select('.corp').boundingClientRect();
      query.select('.corp-cn').boundingClientRect();
      query.select('.corp-en').boundingClientRect();
      query.select('.brand-cn').boundingClientRect();
      query.select('.brand-en').boundingClientRect();
      query.exec((rects) => {
        const corpBox = rects && rects[0];
        const corpCn = rects && rects[1];
        const corpEn = rects && rects[2];
        const brandCn = rects && rects[3];
        const brandEn = rects && rects[4];
        const corpCnScale = fitWidth(corpBox, corpCn, this.data.corpCnScale);
        const cnBox = corpCn && corpCn.width > 1 ? corpCn.width / (this.data.corpCnScale || 1) : 0;
        const cnVisual = corpBox && corpBox.width > 1 ? Math.min(cnBox * (corpCnScale || 1), corpBox.width) : cnBox * (corpCnScale || 1);
        const corpScale = scaleToWidth(cnVisual, corpEn, this.data.corpScale);
        const brandTarget = brandCn && brandCn.width > 1 ? brandCn.width : 0;
        const brandScale = scaleToWidth(brandTarget, brandEn, this.data.brandScale);
        if (
          Math.abs(corpCnScale - this.data.corpCnScale) < 0.01 &&
          Math.abs(corpScale - this.data.corpScale) < 0.01 &&
          Math.abs(brandScale - this.data.brandScale) < 0.01
        ) {
          if (!this._fitPass) {
            this._fitPass = 1;
            wx.nextTick(() => this.fitNames());
          }
          return;
        }
        this.setData({ corpCnScale, corpScale, brandScale }, () => {
          if (this._fitPass) return;
          this._fitPass = 1;
          wx.nextTick(() => this.fitNames());
        });
      });
    },
  },
});

function fitWidth(box, text, current) {
  const applied = current > 0 ? current : 1;
  if (!box || !text || box.width < 1 || text.width < 1) return 1;
  const natural = text.width / applied;
  if (natural <= box.width) return 1;
  return box.width / natural;
}

function visualWidth(box, text, current) {
  const applied = current > 0 ? current : 1;
  if (!text || text.width < 1) return 0;
  const natural = text.width / applied;
  if (!box || box.width < 1) return natural;
  return Math.min(natural, box.width);
}

function scaleToWidth(targetWidth, text, current) {
  const applied = current > 0 ? current : 1;
  if (!targetWidth || !text || text.width < 1) return 1;
  const natural = text.width / applied;
  if (natural < 1) return 1;
  return targetWidth / natural;
}

function scaleTo(target, text, current) {
  if (!target || target.width < 1) return 1;
  return scaleToWidth(target.width, text, current);
}
