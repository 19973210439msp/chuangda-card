const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');

Page({
  data: {
    error: '',
    scrollHeight: 600,
    companies: [],
    companyNames: [],
    companyIndex: 0,
    certCode: '',
    certified: [],
    pending: [],
    companyOpen: false,
    cardId: '',
    allCompanies: [],
  },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    if (!ensureLogin()) return;
    request({ url: '/api/employee/me' }).then((data) => {
      const employee = data.employee || {};
      const cardId = employee.activeCardId || '';
      return Promise.all([
        Promise.resolve(cardId),
        request({ url: '/api/employee/companies' }),
        cardId ? request({ url: '/api/employee/certification?cardId=' + encodeURIComponent(cardId) }) : Promise.resolve({}),
      ]);
    }).then(([cardId, companies, cert]) => {
      this.showCert(cardId, (companies && companies.items) || [], cert || {});
    }).catch((err) => this.setData({ error: err.message }));
  },
  showCert(cardId, all, cert) {
    const taken = {};
    (cert.certified || []).concat(cert.pending || []).forEach((item) => {
      if (item && item.companyId) taken[item.companyId] = true;
    });
    const items = (all || []).filter((item) => item && item.id && !taken[item.id]);
    this.setData({
      cardId,
      allCompanies: all || [],
      companies: items,
      companyNames: items.map((item) => item.name),
      companyIndex: 0,
      certified: cert.certified || [],
      pending: cert.pending || [],
      certCode: '',
      error: cardId ? '' : '名片还在加载',
    });
  },
  onOpenCompanies() {
    if (!(this.data.companies || []).length) return;
    this.setData({ companyOpen: true });
  },
  onCloseCompanies() {
    this.setData({ companyOpen: false });
  },
  onHoldCompanies() {},
  onChooseCompany(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({
      companyIndex: Number.isFinite(index) ? index : 0,
      companyOpen: false,
    });
  },
  onCertCode(event) {
    this.setData({ certCode: String(event.detail.value || '').replace(/\s/g, '').slice(0, 12) });
  },
  onApplyCert() {
    const cardId = this.data.cardId;
    if (!cardId) {
      this.setData({ error: '名片还在加载' });
      return;
    }
    const code = String(this.data.certCode || '').trim();
    const picked = (this.data.companies || [])[this.data.companyIndex];
    if (!code && !picked) {
      this.setData({ error: '请选择子公司或填写认证码' });
      return;
    }
    request({
      url: '/api/employee/certification',
      method: 'POST',
      data: { cardId, companyId: code ? '' : picked.id, code },
    }).then((result) => request({
      url: '/api/employee/certification?cardId=' + encodeURIComponent(cardId),
    }).then((cert) => ({ cert, alreadyPending: !!(result && result.alreadyPending) }))).then(({ cert, alreadyPending }) => {
      this.showCert(cardId, this.data.allCompanies || [], cert || {});
      wx.showToast({ title: alreadyPending ? '管理员正在审核中' : '已提交认证', icon: 'none' });
    }).catch((err) => this.setData({ error: err.message }));
  },
});
