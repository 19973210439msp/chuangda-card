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
    certified: [],
    pending: [],
    companyOpen: false,
    allCompanies: [],
  },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    if (!ensureLogin()) return;
    Promise.all([
      request({ url: '/api/employee/companies' }),
      request({ url: '/api/employee/certification' }),
    ]).then(([companies, cert]) => {
      this.showCert((companies && companies.items) || [], cert || {});
    }).catch((err) => this.setData({ error: err.message }));
  },
  showCert(all, cert) {
    const taken = {};
    (cert.certified || []).concat(cert.pending || []).forEach((item) => {
      if (item && item.companyId) taken[item.companyId] = true;
    });
    const items = (all || []).filter((item) => item && item.id && !taken[item.id]);
    this.setData({
      allCompanies: all || [],
      companies: items,
      companyNames: items.map((item) => item.name),
      companyIndex: 0,
      certified: cert.certified || [],
      pending: cert.pending || [],
      error: '',
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
  onApplyCert() {
    const picked = (this.data.companies || [])[this.data.companyIndex];
    if (!picked) {
      this.setData({ error: '请选择企业' });
      return;
    }
    request({
      url: '/api/employee/certification',
      method: 'POST',
      data: { companyId: picked.id },
    }).then((result) => request({
      url: '/api/employee/certification',
    }).then((cert) => ({
      cert,
      alreadyPending: !!(result && result.alreadyPending),
      autoApproved: !!(result && result.autoApproved),
    }))).then(({ cert, alreadyPending, autoApproved }) => {
      this.showCert(this.data.allCompanies || [], cert || {});
      wx.showToast({
        title: autoApproved ? '认证成功' : (alreadyPending ? '管理员正在审核中' : '已提交认证'),
        icon: 'none',
      });
    }).catch((err) => this.setData({ error: err.message }));
  },
});
