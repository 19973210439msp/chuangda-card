const { request, uploadFile } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');

Page({
  data: {
    form: {},
    origin: {},
    devHint: '',
    error: '',
    scrollHeight: 600,
    companies: [],
    companyNames: [],
    companyIndex: 0,
    certCode: '',
    cert: {},
    companyOpen: false,
  },
  onLoad() {
    this.setData({ scrollHeight: pageScrollHeight() });
  },
  onShow() {
    if (!ensureLogin()) return;
    if (this.skipReload) {
      this.skipReload = false;
      return;
    }
    request({ url: '/api/employee/me' }).then((data) => {
      const form = Object.assign({ attachments: [] }, data.employee);
      const cardId = form.activeCardId || '';
      return Promise.all([
        Promise.resolve(form),
        request({ url: '/api/company' }),
        cardId ? request({ url: '/api/employee/certification?cardId=' + encodeURIComponent(cardId) }) : Promise.resolve({}),
      ]);
    }).then(([form, company, cert]) => {
      const hqName = (company.company && company.company.name) || '总公司';
      const choices = [{ id: '', name: hqName }];
      ((cert && cert.certified) || []).forEach((item) => {
        if (item && item.companyId) choices.push({ id: item.companyId, name: item.companyName || '已认证子公司' });
      });
      if (form.companyId && !choices.some((item) => item.id === form.companyId)) {
        choices.push({ id: form.companyId, name: form.company || '当前公司' });
      }
      let companyIndex = choices.findIndex((item) => item.id === (form.companyId || ''));
      if (companyIndex < 0) companyIndex = 0;
      this.setData({
        form,
        origin: Object.assign({}, form),
        companies: choices,
        companyNames: choices.map((item) => item.name),
        companyIndex,
        error: '',
      });
    }).catch((err) => this.setData({ error: err.message }));
  },
  holdDraft() {
    this.skipReload = true;
  },
  onInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: event.detail.value });
  },
  onAddFile() {
    this.holdDraft();
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        uploadFile(file.path).then((data) => {
          const attachments = (this.data.form.attachments || []).concat([{ name: file.name, url: data.url }]);
          this.setData({ 'form.attachments': attachments });
        }).catch((err) => this.setData({ error: err.message }));
      },
    });
  },
  onRemoveFile(event) {
    const index = event.currentTarget.dataset.index;
    const attachments = (this.data.form.attachments || []).slice();
    const removed = attachments.splice(index, 1)[0];
    const patch = { 'form.attachments': attachments };
    this.setData(patch);
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
    const companyIndex = Number.isFinite(index) ? index : 0;
    const picked = (this.data.companies || [])[companyIndex] || { id: '', name: '' };
    this.setData({
      companyIndex,
      companyOpen: false,
      'form.company': picked.name,
      'form.companyId': picked.id,
    });
  },
  onSave() {
    const form = this.data.form;
    const body = {
      name: form.name || '',
      company: form.company || '',
      companyId: form.companyId || '',
      name: form.name || '',
      company: form.company || '',
      title: form.title || '',
      phone: form.phone || '',
      email: form.email || '',
      address: form.address || '',
      attachments: form.attachments || [],
    };
    request({ url: '/api/employee/me', method: 'PUT', data: body }).then(() => {
      wx.showToast({ title: '已保存', icon: 'success' });
      wx.navigateBack();
    }).catch((err) => this.setData({ error: err.message }));
  },
});
