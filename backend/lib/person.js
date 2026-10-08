function nowIso() {
  return new Date().toISOString();
}

function blankPerson(partial) {
  const now = nowIso();
  return {
    id: partial.id,
    kind: partial.kind || 'employee',
    employeeNo: partial.employeeNo || '',
    openid: partial.openid || '',
    ownerId: partial.ownerId || '',
    name: partial.name || '',
    company: partial.company || '',
    title: partial.title || '',
    department: partial.department || '',
    phone: partial.phone || '',
    wechat: partial.wechat || '',
    email: partial.email || '',
    address: partial.address || '',
    avatar: partial.avatar || '',
    portrait: partial.portrait || '',
    attachments: Array.isArray(partial.attachments) ? partial.attachments : [],
    status: partial.status || 'active',
    createdAt: partial.createdAt || now,
    updatedAt: partial.updatedAt || now,
  };
}

function seedData() {
  const company = {
    name: '上海创大产控高新技术集团有限公司',
    nameEn: 'SHANGHAI CHUANGDA CHANKONG HI-TECH GROUP CO., LTD.',
    shortName: '创大产控',
    brandEn: 'CHUANGDACHANKONG',
    slogan: '产业深耕 · 资本远见',
    intro: '创大产控集团围绕产业投资、园区运营与资本运作，为合作伙伴提供统一的商务名片与可追踪的触达方式。',
    website: 'https://www.chuangda.example',
    address: '上海市浦东新区金桥红枫路288号',
    phone: '021-5888 6080',
    wechat: 'chuangda-group',
    logo: '',
    template: 'classic',
    primaryColor: '#10233F',
    accentColor: '#8C6A3D',
  };
  const people = [
    blankPerson({
      id: 'emp-1001',
      employeeNo: '1001',
      name: '林启明',
      company: company.name,
      department: '投资发展部',
      title: '董事总经理',
      phone: '13800001001',
      wechat: 'linqiming',
      email: 'linqm@chuangda.example',
      address: company.address,
      createdAt: '2026-03-01T08:00:00.000Z',
    }),
    blankPerson({
      id: 'emp-1002',
      employeeNo: '1002',
      name: '周晚晴',
      company: company.name,
      department: '品牌公关部',
      title: '品牌总监',
      phone: '13800001002',
      wechat: 'zhouwanqing',
      email: 'zhouwq@chuangda.example',
      address: company.address,
      createdAt: '2026-03-02T08:00:00.000Z',
    }),
  ];
  const views = [
    {
      id: 'view-seed-1',
      cardId: 'emp-1001',
      visitorId: 'visitor-a',
      startedAt: '2026-09-20T02:10:00.000Z',
      durationSec: 86,
      exchange: null,
    },
    {
      id: 'view-seed-2',
      cardId: 'emp-1001',
      visitorId: 'visitor-b',
      startedAt: '2026-09-22T06:40:00.000Z',
      durationSec: 140,
      exchange: { name: '陈嘉树', phone: '13900002001', company: '江浦制造' },
    },
    {
      id: 'view-seed-3',
      cardId: 'emp-1002',
      visitorId: 'visitor-a',
      startedAt: '2026-09-25T01:20:00.000Z',
      durationSec: 34,
      exchange: null,
    },
  ];
  return { company, people, holders: [], views, sessions: [], codes: [] };
}

function toCard(person) {
  return {
    id: person.id,
    employeeNo: person.employeeNo || '',
    name: person.name || '',
    company: person.company || '',
    title: person.title || '',
    department: person.department || '',
    phone: person.phone || '',
    wechat: person.wechat || '',
    email: person.email || '',
    address: person.address || '',
    avatar: person.avatar || '',
    portrait: person.portrait || '',
    attachments: person.attachments || [],
    kind: person.kind,
    status: person.status,
  };
}

function toSelf(person) {
  return toCard(person);
}

module.exports = { nowIso, blankPerson, seedData, toCard, toSelf };
