const { request, uploadFile } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { pageScrollHeight } = require('../../utils/util');
const { expandTemplateOptions } = require('../../utils/template-options');

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
      if (!cardId) throw new Error('请先创建名片或联系管理员分配');
      if (!data.canEdit) throw new Error('没有当前名片的编辑权限，请联系管理员');
      return Promise.all([Promise.resolve(form), request({ url: '/api/employee/templates' })]);
    }).then(([form, available]) => {
      const choices = [];
      expandTemplateOptions(available.items).filter((item) => item.id === form.cardTemplate).forEach((item) => {
        if (!choices.some((company) => company.id === item.companyId)) choices.push({ id: item.companyId, name: item.companyName });
      });
      if (form.companyId && !choices.some((item) => item.id === form.companyId)) {
        choices.push({ id: form.companyId, name: form.company || '当前企业' });
      }
      let companyIndex = choices.findIndex((item) => item.id === form.companyId);
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
