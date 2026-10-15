const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { decorateCompany, pageScrollHeight } = require('../../utils/util');

Page({
  data: {
    mode: 'switch',
    title: '切换名片',
    cards: [],
    company: null,
    activeCardId: '',
    templates: [],
    draftTemplate: 'classic',
    draftCompanyId: '',
    creating: false,
    error: '',
    scrollHeight: 600,
  },
  onLoad(options) {
    const mode = options.mode === 'style' ? 'style' : 'switch';
    this.setData({
      mode,
      title: mode === 'style' ? '名片样式' : '切换名片',
      scrollHeight: pageScrollHeight(),
    });
  },
  onShow() {
    if (!ensureLogin()) return;
    this.load();
  },
  load() {
    Promise.all([
      request({ url: '/api/employee/me' }),
      request({ url: '/api/employee/templates' }),
    ]).then(([me, available]) => {
      const employee = me.employee || {};
      const brand = decorateCompany(me.templateCompany);
      const templates = (available.items || []).map((item) => {
        const templateBrand = decorateCompany(item.company);
        return {
          id: item.id,
          key: item.id + ':' + (item.companyId || ''),
          companyId: item.companyId || '',
          label: item.name,
          companyName: item.companyName || '',
          brand: templateBrand,
          preview: {
            id: 'preview-' + item.id + '-' + (item.companyId || ''),
            cardTemplate: item.id,
            templateLabel: item.name,
            name: '姓名', title: '职位', phone: '13800000000',
            email: 'name@example.com',
            company: (templateBrand && templateBrand.name) || '',
            address: (templateBrand && templateBrand.address) || '',
          },
        };
      });
      const cards = (employee.cards || []).map((card) => ({
        ...card,
        brand: decorateCompany((me.cardCompanies || {})[card.id] || me.templateCompany),
        preview: {
          id: employee.id + '-' + card.id,
          name: card.name,
          company: card.company,
          title: card.title,
          phone: card.phone,
          email: card.email,
          address: card.address,
          cardTemplate: card.template,
          templateLabel: card.templateLabel,
        },
      }));
      this.setData({
        cards,
        company: brand,
        activeCardId: employee.activeCardId || '',
        templates,
        draftTemplate: 'classic',
        draftCompanyId: '',
        error: '',
      });
    }).catch((err) => this.setData({ error: err.message }));
  },
  onPick(event) {
    const cardId = event.currentTarget.dataset.id;
    if (!cardId || cardId === this.data.activeCardId) {
      wx.navigateBack();
      return;
    }
    request({
      url: '/api/employee/cards/active',
      method: 'PUT',
      data: { cardId },
    }).then(() => {
      wx.navigateBack();
    }).catch((err) => this.setData({ error: err.message }));
  },
  onDelete(event) {
    const cardId = event.currentTarget.dataset.id;
    if (!cardId) return;
    wx.showModal({
      title: '删除这张名片',
      content: '删除后不能恢复。至少会保留一张名片。',
      confirmText: '删除',
      confirmColor: '#c82423',
      success: (res) => {
        if (!res.confirm) return;
        request({
          url: '/api/employee/cards/' + cardId,
          method: 'DELETE',
        }).then(() => this.load()).catch((err) => this.setData({ error: err.message }));
      },
    });
  },
  onTemplate(event) {
    this.setData({
      draftTemplate: event.currentTarget.dataset.template,
      draftCompanyId: event.currentTarget.dataset.company || '',
    });
  },
  onCreate() {
    this.setData({ creating: true, error: '' });
    request({
      url: '/api/employee/cards',
      method: 'POST',
      data: { template: this.data.draftTemplate, companyId: this.data.draftCompanyId },
    }).then(() => {
      wx.redirectTo({ url: '/pages/home/edit' });
    }).catch((err) => this.setData({ creating: false, error: err.message }));
  },
});
