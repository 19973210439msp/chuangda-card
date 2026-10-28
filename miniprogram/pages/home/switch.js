const { request } = require('../../utils/request');
const { ensureLogin } = require('../../utils/guard');
const { decorateCompany, pageScrollHeight } = require('../../utils/util');

Page({
  data: {
    mode: 'switch',
    title: '切换名片',
    cards: [],
    archivedCards: [],
    company: null,
    activeCardId: '',
    templates: [],
    draftTemplate: '',
    draftCompanyId: '',
    creating: false,
    canEdit: false,
    canCreate: false,
    error: '',
    scrollHeight: 600,
  },
  onLoad(options) {
    const mode = ['style', 'create'].includes(options.mode) ? options.mode : 'switch';
    this.setData({
      mode,
      title: mode === 'switch' ? '切换名片' : mode === 'create' ? '创建名片' : '名片样式',
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
      const allCards = (employee.cards || []).map((card) => ({
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
      const cards = allCards.filter((card) => card.lifecycle === 'active');
      const archivedCards = allCards.filter((card) => card.lifecycle === 'archived');
      const current = cards.find((card) => card.id === employee.activeCardId);
      const selected = templates.find((item) => current && item.id === current.template && item.companyId === current.companyId)
        || templates[0];
      this.setData({
        cards,
        archivedCards,
        canEdit: !!me.canEdit,
        canCreate: !!templates.length,
        company: brand,
        activeCardId: employee.activeCardId || '',
        templates,
        draftTemplate: selected ? selected.id : '',
        draftCompanyId: selected ? selected.companyId : '',
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
    const card = this.data.cards.concat(this.data.archivedCards).find((item) => item.id === cardId);
    if (!card || !card.canDelete) return;
    const archived = card.lifecycle === 'archived';
    wx.showModal({
      title: archived ? '删除归档名片' : '删除这张名片',
      content: archived
        ? '删除后原分享链接保持失效，后台保留历史记录。'
        : '删除后原分享链接将失效，后台保留历史记录。删除最后一张后将没有可用名片。',
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
    this.saveSelectedCard(false);
  },
  onApply() {
    this.saveSelectedCard(true);
  },
  saveSelectedCard(applyToCurrent) {
    if (this.data.creating) return;
    if (applyToCurrent ? !this.data.canEdit || !this.data.activeCardId : !this.data.canCreate) return;
    if (!this.data.draftTemplate || !this.data.draftCompanyId) {
      this.setData({ error: '暂无可用模板，请联系管理员分配名片权限或模板' });
      return;
    }
    this.setData({ creating: true, error: '' });
    request({
      url: applyToCurrent ? '/api/employee/me' : '/api/employee/cards',
      method: applyToCurrent ? 'PUT' : 'POST',
      data: applyToCurrent
        ? { cardTemplate: this.data.draftTemplate, companyId: this.data.draftCompanyId }
        : { template: this.data.draftTemplate, companyId: this.data.draftCompanyId },
    }).then(() => {
      wx.redirectTo({ url: '/pages/home/edit' });
    }).catch((err) => this.setData({ creating: false, error: err.message }));
  },
});
