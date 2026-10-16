const app = document.querySelector('#app');
const views = [
  ['overview', '工作台'],
  ['companies', '子公司'],
  ['cert', '员工认证'],
  ['cards', '名片管理'],
  ['templates', '模板管理'],
  ['import', '批量导入'],
  ['brand', '品牌设置'],
  ['visits', '浏览明细'],
];

const viewDescriptions = {
  overview: '查看待办事项与名片使用情况',
  companies: '管理集团与子公司资料',
  cert: '处理员工的企业认证申请',
  cards: '维护员工资料与对外名片',
  templates: '管理名片样式与使用范围',
  import: '批量创建或更新员工名片',
  brand: '设置公司对外展示的信息',
  visits: '查看名片浏览记录',
};

const state = {
  view: 'overview',
  company: null,
  employees: [],
  summary: [],
  visits: [],
  visitTotal: 0,
  visitPage: 1,
  visitLimit: 50,
  visitFilter: { cardId: '', from: '', to: '' },
  query: '',
  editing: null,
  error: '',
  notice: '',
  importIssues: [],
  admin: null,
  companies: [],
  certifications: [],
  templates: [],
  editingTemplate: '',
  previewTemplate: '',
  certCode: '',
};

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusLabel(status) {
  if (status === 'closed') return '已注销';
  if (status === 'disabled') return '已停用';
  return '在职';
}

function navViews() {
  if (state.admin && state.admin.scope === 'company') {
    return views.filter(([id]) => id !== 'companies');
  }
  return views;
}

function shell(title, body) {
  const nav = navViews().map(([id, label]) => {
    const icon = {
      overview: '▦', companies: '▤', cert: '✓', cards: '▣',
      templates: '◫', import: '⇧', brand: '◈', visits: '◷',
    }[id];
    return `<a href="#/${id}" ${state.view === id ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span></a>`;
  }).join('');
  const role = state.admin && state.admin.scope === 'company' ? '子公司管理员' : '总部管理员';
  return `
    <div class="shell">
      <aside class="rail">
        <div class="rail-brand"><img src="/brand-logo.png" alt="" width="40" height="40"><div><p class="brand-name">创大产控</p><p class="brand-sub">名片管理平台</p></div></div>
        <p class="nav-caption">工作区</p>
        <nav aria-label="后台">${nav}</nav>
        <div class="rail-foot"><span class="rail-foot-dot" aria-hidden="true"></span> 管理后台</div>
      </aside>
      <main id="main">
        <div class="section-head">
          <div><p class="page-kicker">创大产控 / ${title}</p><h1>${title}</h1><p class="page-description">${viewDescriptions[state.view] || ''}</p></div>
          <div class="account-tools"><span class="role-chip">${role}</span><button class="btn secondary small" type="button" data-action="logout">退出登录</button></div>
        </div>
        ${state.notice ? `<p class="banner ok" role="status">${esc(state.notice)}</p>` : ''}
        ${state.error ? `<p class="banner" role="alert">${esc(state.error)}</p>` : ''}
        ${body}
      </main>
    </div>
    ${templateGallery()}`;
}

function dashboardHtml() {
  const employees = state.employees.filter((item) => item.status !== 'closed');
  const cardCount = employees.reduce((count, item) => count + (item.cards || []).length, 0);
  const pending = (state.certifications || []).filter((item) => item.status === 'pending');
  const companyCount = (state.companies || []).length;
  const hq = !state.admin || state.admin.scope !== 'company';
  const metrics = [
    ['员工名片', cardCount, '当前在用的名片总数'],
    ['在职员工', employees.filter((item) => item.status === 'active').length, '可正常使用的员工账号'],
    ['待审核', pending.length, pending.length ? '有申请需要处理' : '当前没有待处理申请'],
    ...(hq ? [['集团公司', companyCount, '已建立的公司档案']] : []),
  ];
  return shell('工作台', `
    <div class="overview-heading"><div><h2>业务概览</h2><p class="muted">名片和员工认证的实时数据</p></div><a class="btn" href="#/cards">管理名片</a></div>
    <div class="stat-row">${metrics.map(([label, count, detail]) => `<div class="stat"><span>${label}</span><b>${count}</b><small>${detail}</small></div>`).join('')}</div>
    <div class="overview-grid">
      <section class="panel action-panel"><div class="panel-heading"><div><p class="panel-kicker">待办事项</p><h2>员工认证</h2></div><a class="text-link" href="#/cert">查看全部 <span aria-hidden="true">→</span></a></div>
        ${pending.length ? `<p class="action-count">${pending.length} <span>项申请等待审核</span></p><ul class="pending-list">${pending.slice(0, 4).map((item) => `<li><span class="avatar" aria-hidden="true">${esc((item.name || '员').slice(0, 1))}</span><span><strong>${esc(item.name || '未命名员工')}</strong><small>${esc(item.companyName || item.title || '企业认证申请')}</small></span><span class="tag">待审核</span></li>`).join('')}</ul>` : '<div class="empty-state"><span aria-hidden="true">✓</span><strong>暂无待审核申请</strong><p>新的员工认证申请会出现在这里。</p></div>'}
      </section>
      <section class="panel quick-panel"><p class="panel-kicker">快捷入口</p><h2>常用操作</h2><div class="quick-links"><a href="#/cards"><span class="quick-icon" aria-hidden="true">＋</span><span><strong>名片管理</strong><small>查看、编辑和新建名片</small></span><span aria-hidden="true">→</span></a><a href="#/import"><span class="quick-icon" aria-hidden="true">⇧</span><span><strong>批量导入</strong><small>导入表格或文件</small></span><span aria-hidden="true">→</span></a><a href="#/templates"><span class="quick-icon" aria-hidden="true">◫</span><span><strong>模板管理</strong><small>查看并分配名片模板</small></span><span aria-hidden="true">→</span></a></div></section>
    </div>`);
}

function renderLogin(message) {
  app.innerHTML = `
    <main class="login-wrap" id="main">
      <form class="login-panel" data-form="login">
        <div class="seal" aria-hidden="true">创</div>
        <p class="eyebrow">CHUANGDA</p>
        <h1>名片管理后台</h1>
        <p class="lede">管理员使用账号登录。员工名片在小程序里通过微信授权进入。</p>
        ${message ? `<p class="form-error" role="alert">${esc(message)}</p>` : ''}
        <label for="username">账号</label>
        <input id="username" name="username" autocomplete="username" required>
        <label for="password">密码</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <div class="inline-actions" style="margin-top:18px">
          <button class="btn" type="submit">登录</button>
        </div>
      </form>
    </main>`;
}

function templateText(item) {
  const cards = item.cards || [];
  if (!cards.length) return item.templateLabel || '创大产控模板';
  return cards.map((card) => card.templateLabel || '创大产控模板').join('、');
}

function cardFields(item, card) {
  const source = card || {};
  return {
    ...item,
    editingCardId: source.id || '',
    name: source.name || '',
    title: source.title || '',
    phone: source.phone || '',
    wechat: source.wechat || '',
    email: source.email || '',
    company: source.company || item.company || '',
    cardTemplate: source.template || 'classic',
    address: source.address || '',
  };
}

function defaultCardFields(item) {
  const cards = item.cards || [];
  const card = cards.find((entry) => entry.isDefault) || cards[0];
  if (!card) return item;
  return cardFields(item, card);
}

function templateOptions() {
  const builtins = [
    ['classic', '创大产控模板'],
    ['horizon', '晴空模板'],
    ['wave', '蓝韵模板'],
  ];
  const custom = (state.templates || [])
    .filter((item) => !builtins.some(([id]) => id === item.id))
    .map((item) => [item.id, item.name]);
  return builtins.concat(custom);
}

function cardTemplateId(value) {
  return templateOptions().some(([id]) => id === value) ? value : 'classic';
}

function templateName(id) {
  const found = templateOptions().find(([itemId]) => itemId === id);
  return found ? found[1] : '创大产控模板';
}

function templateChooser(name, selected) {
  const current = cardTemplateId(selected);
  return `<div class="tpl-chooser">
    <button class="btn secondary" type="button" data-action="open-templates" data-field="${name}">选择名片模板</button>
    <span class="tpl-current">当前：<b data-template-label="${name}">${templateName(current)}</b></span>
    <input type="hidden" name="${name}" value="${current}">
  </div>`;
}

function cardFace(kind) {
  const custom = (state.templates || []).find((item) => item.id === kind);
  if (kind === 'horizon') {
    return `<div class="pv pv-horizon"><div class="pv-hz-side"><span class="pv-hz-brand">创大产控</span><span class="pv-hz-name">张伟</span><span class="pv-hz-title">客户经理</span></div><div class="pv-hz-main"><span class="pv-hz-company">上海创大产控高新技术集团有限公司</span><span class="pv-hz-line">手机 13800000000</span><span class="pv-hz-line">邮箱 zhangwei@chuangda.com</span><span class="pv-hz-line">地址 上海市浦东新区金桥红枫路288号</span><img class="pv-hz-qr" src="/official-qr.jpg" alt=""></div></div>`;
  }
  if (kind === 'wave') {
    return `<div class="pv pv-wave"><img class="pv-wave-bg" src="/wave-front.jpg" alt=""><span class="pv-wv-name">张伟</span><span class="pv-wv-title">客户经理</span><span class="pv-wv-row pv-wv-phone">13800000000</span><span class="pv-wv-row pv-wv-email">zhangwei@chuangda.com</span><span class="pv-wv-row pv-wv-address">上海市浦东新区金桥红枫路288号</span><img class="pv-wv-qr" src="/official-qr.jpg" alt=""></div>`;
  }
  return `<div class="pv pv-classic"><div class="pv-corp"><span class="pv-corp-cn">${esc(custom && custom.companyName || '上海创大产控高新技术集团有限公司')}</span><span class="pv-corp-en">${esc(custom && custom.companyNameEn || 'SHANGHAI CHUANGDA CHANKONG HI-TECH GROUP CO., LTD.')}</span></div><div class="pv-brand"><img class="pv-seal" src="/brand-logo.png" alt=""><span class="pv-brand-cn">${esc(custom && custom.shortName || '创大产控')}</span><span class="pv-brand-en">${esc(custom && custom.shortNameEn || 'CHUANGDACHANKONG')}</span></div><div class="pv-who"><span class="pv-name">张伟</span><span class="pv-title">客户经理</span></div><span class="pv-mobile">M:13800000000</span><span class="pv-tick"></span><div class="pv-contact"><span>电话/Tel:021-5888 6080</span><span>邮箱/E-mail:zhangwei@chuangda.com</span><span>地址/Add:上海市浦东新区金桥红枫路288号</span></div><img class="pv-qr" src="${esc(custom && custom.qrUrl || '/official-qr.jpg')}" alt=""></div>`;
}

function templateGallery() {
  const items = templateOptions();
  return `<dialog id="template-gallery" class="tpl-gallery">
    <div class="tpl-gallery-head">
      <h3>选择名片模板</h3>
      <button class="btn secondary small" type="button" data-action="close-templates">关闭</button>
    </div>
    <div class="tpl-gallery-list">
      ${items.map(([id, label]) => `<button class="tpl-gallery-item" type="button" data-action="choose-template" data-template="${id}">${cardFace(id)}<span class="tpl-gallery-name">${label}</span></button>`).join('')}
    </div>
  </dialog>`;
}

function cardsHtml() {
  const rows = state.employees.filter((item) => item.status !== 'closed').flatMap((item) => {
    const cards = item.cards || [];
    return (cards.length ? cards : [{}]).map((card, index) => {
      const nameText = card.name || item.name || '未命名';
      const companyText = card.company || item.company || '';
      const currentTemplate = card.templateLabel || templateName(card.template);
      return `
    <tr>
      <td data-label="姓名" title="${esc(nameText)}"><span class="cell-clip">${esc(nameText)}${card.isDefault ? '<span class="tag default-card">默认</span>' : ''}</span></td>
      <td data-label="公司" title="${esc(companyText)}"><span class="cell-clip">${esc(companyText)}</span></td>
      <td data-label="职位" title="${esc(card.title || '')}"><span class="cell-clip">${esc(card.title || '')}</span></td>
      <td data-label="手机" title="${esc(card.phone || item.phone || '')}"><span class="cell-clip">${esc(card.phone || item.phone || '')}</span></td>
      <td data-label="邮箱" title="${esc(card.email || item.email || '')}"><span class="cell-clip">${esc(card.email || item.email || '')}</span></td>
      <td data-label="所用模板" title="${esc(currentTemplate)}"><span class="cell-clip">${esc(currentTemplate)}</span></td>
      <td data-label="状态"><span class="tag ${esc(item.status)}">${statusLabel(item.status)}</span></td>
      <td class="ops" data-label="操作">
        <div class="inline-actions">
        <button class="btn secondary small" type="button" data-action="${card.id ? 'edit-card' : 'edit'}" data-id="${esc(item.id)}" ${card.id ? `data-card="${esc(card.id)}"` : ''}>编辑</button>
        ${index === 0 ? (item.status === 'closed' || item.status === 'disabled'
          ? `<button class="btn small" type="button" data-action="restore" data-id="${esc(item.id)}">恢复账号</button>`
          : `<button class="btn secondary small" type="button" data-action="disable" data-id="${esc(item.id)}">停用账号</button>`) : ''}
        ${index === 0 ? `<button class="btn danger small" type="button" data-action="remove" data-id="${esc(item.id)}">删除员工</button>` : ''}
        </div>
      </td>
    </tr>`;
    });
  }).join('');
  const closed = state.employees.filter((item) => item.status === 'closed');
  const closedRows = closed.map((item) => `
    <tr>
      <td>${esc(item.name || '未命名')}</td>
      <td>${esc(item.title)}</td>
      <td>${esc(item.phone)}</td>
      <td>${esc(item.email)}</td>
      <td>${esc(item.company)}</td>
      <td>${esc(item.address)}</td>
      <td><button class="btn small" type="button" data-action="restore" data-id="${esc(item.id)}">恢复账号</button></td>
    </tr>`).join('');
  const editing = state.editing;
  const dialog = editing ? employeeDialog(editing) : '';
  return shell('名片管理', `
    <div class="toolbar">
      <form class="search" data-form="search">
        <label class="skip" for="q">搜索</label>
        <input id="q" name="q" value="${esc(state.query)}" placeholder="搜索所有名片的姓名、手机、邮箱、公司">
        <button class="btn secondary" type="submit">搜索</button>
      </form>
      <button class="btn" type="button" data-action="create">新建名片</button>
    </div>
    <div class="panel table-wrap">
      <p class="lede">共 ${state.employees.filter((item) => item.status !== 'closed').length} 个员工、${state.employees.filter((item) => item.status !== 'closed').reduce((count, item) => count + (item.cards || []).length, 0)} 张名片。每张名片单独显示，可直接编辑。</p>
      <table class="cards-table">
        <colgroup>
          <col class="col-name"><col class="col-company"><col class="col-title"><col class="col-phone"><col class="col-email"><col class="col-template"><col class="col-status"><col class="col-ops">
        </colgroup>
        <thead><tr><th>姓名</th><th>公司</th><th>职位</th><th>手机</th><th>邮箱</th><th>所用模板</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8">没有匹配的名片</td></tr>'}</tbody>
      </table>
    </div>
    <div class="panel table-wrap">
      <h3>已注销账号</h3>
      <p class="lede">员工注销后不能再用同一微信新建账号。数据仍保留在这里，点「恢复账号」后即可重新登录，对外名片重新可见。</p>
      <table>
        <thead><tr><th>姓名</th><th>职位</th><th>手机号</th><th>邮箱</th><th>公司</th><th>地址</th><th>操作</th></tr></thead>
        <tbody>${closedRows || '<tr><td colspan="7">目前没有已注销账号</td></tr>'}</tbody>
      </table>
    </div>
    ${dialog}`);
}

function importHtml() {
  return shell('批量导入', `
    <form class="panel" data-form="batch">
      <h3>批量导入</h3>
      <p class="lede">可粘贴表格，或选择 xlsx、xls、csv、docx 文件。Word 请把内容放在表格里，第一行写表头。表头为：姓名、职位、手机号、邮箱、公司、地址。手机号必填。这一批名片使用选中的模板。同一公司、同一模板、同一手机号会更新原名片；换一个模板会另外新建一张。</p>
      ${templateChooser('cardTemplate', 'classic')}
      <label for="batch">导入内容</label>
      <textarea id="batch" name="list" placeholder="姓名,职位,手机号,邮箱,二维码,公司,地址"></textarea>
      <div class="file-pick">
        <input id="batch-file" class="file-pick-input" type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.txt,.tsv,.ods,.docx">
        <label class="btn secondary" for="batch-file">选择文件</label>
        <span id="batch-file-name">未选择文件</span>
      </div>
      <button class="btn" type="submit" style="margin-top:12px">导入</button>
    </form>
    ${importIssuesHtml()}`);
}

function certRows(items, actionCell) {
  const hq = !(state.admin && state.admin.scope === 'company');
  return items.map((item) => `
    <tr>
      <td>${esc(item.name || '未命名')}</td>
      <td>${esc(item.title)}</td>
      <td>${esc(item.phone)}</td>
      ${hq ? `<td>${esc(item.companyName)}</td>` : ''}
      <td class="inline-actions">${actionCell(item)}</td>
    </tr>`).join('');
}

function certHtml() {
  const hq = !(state.admin && state.admin.scope === 'company');
  const cols = hq ? 5 : 4;
  const head = `<tr><th>员工</th><th>职位</th><th>手机</th>${hq ? '<th>公司</th>' : ''}<th>操作</th></tr>`;
  const pending = (state.certifications || []).filter((item) => item.status === 'pending');
  const approved = (state.certifications || []).filter((item) => item.status === 'approved');
  const pendingRows = certRows(pending, (item) => `
        <button class="btn small" type="button" data-action="approve-cert" data-id="${esc(item.id)}">通过</button>
        <button class="btn secondary small" type="button" data-action="reject-cert" data-id="${esc(item.id)}">拒绝</button>`);
  const approvedRows = certRows(approved, (item) => `
        <button class="btn danger small" type="button" data-action="revoke-cert" data-id="${esc(item.id)}">取消认证</button>`);
  return shell('员工认证', `
    <div class="panel table-wrap">
      <h3>待审核</h3>
      <p class="lede">员工提交的企业认证在这里审核。通过后不会自动改名片上的公司，由员工自己在编辑名片里选择。取消认证后，名片上的该公司会被清掉，对应子公司管理员也不再看到这名员工。</p>
      ${state.certCode ? `<p class="lede">本公司认证码：<b>${esc(state.certCode)}</b>。员工也可以不选公司，直接填写这个认证码。</p>` : ''}
      <table>
        <thead>${head}</thead>
        <tbody>${pendingRows || `<tr><td colspan="${cols}">没有待审核的申请</td></tr>`}</tbody>
      </table>
    </div>
    <div class="panel table-wrap">
      <h3>已认证</h3>
      <table>
        <thead>${head}</thead>
        <tbody>${approvedRows || `<tr><td colspan="${cols}">还没有已通过的认证</td></tr>`}</tbody>
      </table>
    </div>`);
}

function companiesHtml() {
  const rows = (state.companies || []).map((item) => `
    <tr>
      <td>${esc(item.name || '')}</td>
      <td>${esc(item.shortName || '')}</td>
      <td>${item.id === 'default' ? '总部' : '子公司'}</td>
      <td>${item.id === 'default' ? '' : esc(item.certCode || '')}</td>
    </tr>`).join('');
  return shell('子公司', `
    <div class="panel table-wrap">
      <table>
        <thead><tr><th>公司全称</th><th>简称</th><th>类型</th><th>认证码</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">还没有公司</td></tr>'}</tbody>
      </table>
    </div>
    <form class="panel" data-form="company" autocomplete="off">
      <h3>新建子公司</h3>
      <p class="lede">只有总部管理员可以新建公司，并给这家公司单独配一个管理员账号。该账号只能看到本公司的名片。</p>
      <div class="grid-2">
        <div><label for="co-name">公司全称</label><input id="co-name" name="name" required autocomplete="off"></div>
        <div><label for="co-short">简称</label><input id="co-short" name="shortName" autocomplete="off"></div>
        <div><label for="co-admin">管理员账号</label><input id="co-admin" name="username" required autocomplete="off" value=""></div>
        <div><label for="co-pass">管理员密码</label><input id="co-pass" name="password" type="password" required minlength="6" autocomplete="new-password" value=""></div>
      </div>
      <button class="btn" type="submit" style="margin-top:12px">创建公司和账号</button>
    </form>`);
}

function field(id, label, value, type, required) {
  const mark = required ? '（必填）' : '';
  return `<label for="${id}">${label}${mark}</label><input id="${id}" name="${id}" type="${type || 'text'}" value="${esc(value || '')}" ${required ? 'required' : ''}>`;
}

function employeeDialog(item) {
  const cards = item.cards || [];
  const picker = item.id && cards.length ? `<div class="tpl-chooser">
      <label for="pick-card">名片</label>
      <select id="pick-card" data-id="${esc(item.id)}">
        ${cards.map((card) => {
          const template = card.templateLabel || templateName(card.template);
          const extra = [card.company, card.phone].filter(Boolean).join(' · ');
          const label = extra ? template + '（' + extra + '）' : template;
          return `<option value="${esc(card.id)}" ${item.editingCardId === card.id ? 'selected' : ''}>${esc(label)}</option>`;
        }).join('')}
      </select>
      ${cards.length > 1 ? `<button class="btn danger small" type="button" data-action="delete-card" data-id="${esc(item.id)}" data-card="${esc(item.editingCardId || '')}">删除这张</button>` : ''}
    </div>` : '';
  return `
    <dialog class="dialog">
      <form data-form="employee">
        <h3>${item.id ? '编辑名片' : '新建名片'}</h3>
        <p class="lede">${item.id ? '用下拉框选择要编辑的名片。保存只写入当前这一张。' : '先选择名片模板，再填写这张名片的内容。'}</p>
        <input type="hidden" name="id" value="${esc(item.id || '')}">
        <input type="hidden" name="cardId" value="${esc(item.editingCardId || '')}">
        ${item.id ? picker : templateChooser('cardTemplate', item.cardTemplate)}
        <div class="grid-2">
          <div>${field('name', '姓名', item.name)}</div>
          ${state.admin && state.admin.scope === 'company' ? '' : `<div>${field('department', '部门', item.department)}</div>`}
          <div>${field('title', '职务', item.title)}</div>
          <div>${field('phone', '手机号', item.phone, 'tel', !item.id)}</div>
          <div>${field('email', '邮箱', item.email, 'email')}</div>
          <div>${field('company', '公司', item.company)}</div>
        </div>
        <label for="address">地址</label>
        <input id="address" name="address" value="${esc(item.address || '')}">
        ${state.admin && state.admin.scope === 'hq' && item.cards ? (() => {
          const card = item.cards.find((c) => c.id === (item.editingCardId || item.activeCardId));
          const cid = card && card.companyId;
          if (!cid) return '';
          const company = (state.companies || []).find((c) => c.id === cid);
          return company ? `<p class="lede">已认证子公司：${esc(company.name)}</p>` : '';
        })() : ''}

        ${state.admin && state.admin.scope === 'company' ? '' : `<label for="status">状态</label>
        <select id="status" name="status">
          ${['active', 'disabled', 'closed'].map((status) => (
            `<option value="${status}" ${item.status === status ? 'selected' : ''}>${statusLabel(status)}</option>`
          )).join('')}
        </select>`}
        <menu>
          <button class="btn secondary" type="button" data-action="close-dialog">取消</button>
          <button class="btn" type="submit">保存</button>
        </menu>
      </form>
    </dialog>`;
}

function brandHtml() {
  const company = state.company || {};
  return shell('品牌设置', `
    <form class="panel" data-form="brand">
      <p class="lede">这里的名称、标识、模板和颜色会用在员工名片和对外 H5 页上。</p>
      <div class="grid-2">
        <div>${field('name', '公司全称', company.name)}</div>
        <div>${field('shortName', '简称', company.shortName)}</div>
        <div>${field('website', '官网', company.website)}</div>
        <div>${field('phone', '电话', company.phone)}</div>
        <div>${field('logo', 'LOGO 图片地址', company.logo)}</div>
        <div>
          <label for="template">模板</label>
          <select id="template" name="template">
            ${['classic', 'ink', 'light'].map((item) => `<option ${company.template === item ? 'selected' : ''}>${item}</option>`).join('')}
          </select>
        </div>
        <div>${field('primaryColor', '主题色', company.primaryColor)}</div>
        <div>${field('accentColor', '辅色', company.accentColor)}</div>
      </div>
      <label for="address">地址</label>
      <input id="address" name="address" value="${esc(company.address || '')}">
      <label for="intro">简介</label>
      <textarea id="intro" name="intro">${esc(company.intro || '')}</textarea>
      <button class="btn" type="submit" style="margin-top:12px">保存品牌</button>
    </form>`);
}

function templatesHtml() {
  const company = state.company || {};
  const isHq = !state.admin || state.admin.scope !== 'company';
  const editing = (state.templates || []).find((item) => item.id === state.editingTemplate) || null;
  const preview = (state.templates || []).find((item) => item.id === state.previewTemplate) || null;
  const companyOptions = (state.companies || []).filter((item) => item.id !== 'default');
  const assignmentNames = (item) => item.id === 'classic'
    ? ['所有子公司均可使用']
    : (item.companyIds || []).map((id) => companyOptions.find((companyItem) => companyItem.id === id)?.name || id);
  const rows = (state.templates || []).map((item) => `
    <button class="template-row" type="button" data-action="preview-template" data-id="${esc(item.id)}" aria-label="查看${esc(item.name)}模板">
      <span class="template-row-mark" aria-hidden="true">创</span>
      <span class="template-row-main"><strong>${esc(item.name)}</strong><small>${esc(assignmentNames(item).join('、') || '尚未分配子公司')}</small></span>
      <span class="template-row-view">查看模板图 <span aria-hidden="true">›</span></span>
    </button>`).join('');
  return shell('模板管理', `
    <p class="lede">${isHq ? '点击模板查看名片图和已分配的子公司。' : '这里只显示创大产控模板和总部下发给本公司的模板；可移除本公司的模板使用权。'}</p>
    ${isHq ? `<details class="panel template-builder" ${editing ? 'open' : ''}>
      <summary><strong>${editing ? '修改名片模板：' + esc(editing.name) : '＋ 创建名片模板'}</strong><span>基于创大产控模板，设置公司文案、二维码与使用范围</span></summary>
      <form data-form="template" enctype="multipart/form-data">
      <input type="hidden" name="templateId" value="${esc(editing && editing.id || '')}">
      <div class="grid-2">
        <div>${field('tpl-name', '模板名称', editing && editing.name || '')}</div>
        <div>${field('companyName', '左上角公司名称', editing && editing.companyName || company.name)}</div>
        <div>${field('companyNameEn', '左上角公司英文名', editing && editing.companyNameEn || company.nameEn)}</div>
        <div>${field('shortName', 'Logo 下方公司简称', editing && editing.shortName || company.shortName)}</div>
        <div>${field('shortNameEn', 'Logo 下方英文简称', editing && editing.shortNameEn || company.brandEn)}</div>
        <div><label for="qr-file">右下角公众号二维码</label><input id="qr-file" name="qrFile" type="file" accept="image/png,image/jpeg,image/webp"><p class="lede">${editing && editing.qrUrl ? '当前已上传；不选择文件会保留原二维码。' : 'PNG、JPG 或 WebP，最大 8 MB'}</p></div>
      </div>
      <fieldset class="template-assignees"><legend>分配给子公司</legend>
        <p class="template-assignee-help">勾选后，该子公司的管理员可使用此模板；企业认证通过的员工也可在小程序选择。</p>
        <div class="template-assignee-grid">${companyOptions.map((item) => `<label class="template-assignee-option"><input type="checkbox" name="companyIds" value="${esc(item.id)}" ${(editing && editing.companyIds || []).includes(item.id) ? 'checked' : ''}><span><strong>${esc(item.shortName || item.name)}</strong><small>${esc(item.name)}</small></span></label>`).join('') || '<p class="lede">请先创建子公司，再分配模板。</p>'}</div>
      </fieldset>
      <div class="template-form-actions"><button class="btn" type="submit">${editing ? '保存模板' : '创建名片模板'}</button>
      ${editing ? '<button class="btn secondary" type="button" data-action="cancel-template">取消修改</button>' : ''}</div>
      </form>
    </details>` : ''}
    <div class="panel template-index"><h3>模板 <span class="template-count">${(state.templates || []).length} 款</span></h3><div class="template-list">${rows}</div></div>
    <dialog id="template-preview" class="template-preview" aria-label="模板预览">
      ${preview ? `<div class="template-preview-head"><div><small>名片模板</small><h3>${esc(preview.name)}</h3></div><button class="btn secondary small" type="button" data-action="close-template-preview">关闭</button></div>${cardFace(preview.id)}<div class="template-preview-assignments"><strong>分配公司</strong><div>${(assignmentNames(preview).length ? assignmentNames(preview) : ['尚未分配子公司']).map((name) => `<span class="template-assignment-chip">${esc(name)}</span>`).join('')}</div></div><div class="template-preview-actions">${isHq && preview.id !== 'classic' ? `<button class="btn" type="button" data-action="edit-template" data-id="${esc(preview.id)}">修改模板与分配</button>` : ''}${!isHq && preview.id !== 'classic' ? `<button class="btn danger" type="button" data-action="remove-template-assignment" data-id="${esc(preview.id)}">移除本公司模板</button>` : ''}</div>` : ''}
    </dialog>`);
}

function visitsQuery() {
  const params = new URLSearchParams();
  const filter = state.visitFilter || {};
  if (filter.cardId) params.set('cardId', filter.cardId);
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  params.set('page', String(state.visitPage || 1));
  params.set('limit', String(state.visitLimit || 50));
  return params.toString();
}

async function loadVisits() {
  const visits = await api('/api/analytics/list?' + visitsQuery());
  state.visits = visits.items || [];
  state.visitTotal = Number(visits.total) || 0;
  state.visitPage = Number(visits.page) || 1;
  state.visitLimit = Number(visits.limit) || 50;
}

function visitsHtml() {
  const filter = state.visitFilter || {};
  const options = state.employees.map((item) => (
    `<option value="${esc(item.id)}" ${filter.cardId === item.id ? 'selected' : ''}>${esc(item.name)} ${esc(item.employeeNo)}</option>`
  )).join('');
  const rows = state.visits.map((item) => {
    const owner = state.employees.find((person) => person.id === item.cardId) || {};
    const viewerName = item.name || '游客访问';
    const viewerDetail = [item.title, item.company, item.phone].filter(Boolean).join(' · ') || '未留下联系方式';
    const cardName = item.cardName || owner.name || '未命名名片';
    const cardDetail = [owner.title, owner.company, owner.phone].filter(Boolean).join(' · ') || '无更多名片资料';
    return `
    <tr>
      <td><strong>${esc(viewerName)}</strong><br><span class="muted">${esc(viewerDetail)}</span></td>
      <td><strong>${esc(cardName)}</strong><br><span class="muted">${esc(cardDetail)}</span></td>
      <td>${esc(String(item.startedAt || '').replace('T', ' ').slice(0, 16))}</td>
      <td>${item.durationSec} 秒</td>
    </tr>`;
  }).join('');
  const page = state.visitPage || 1;
  const limit = state.visitLimit || 50;
  const total = state.visitTotal || 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  return shell('浏览明细', `
    <form class="toolbar" data-form="visits">
      <label for="cardId">被浏览的名片</label>
      <select id="cardId" name="cardId"><option value="">全部</option>${options}</select>
      <label for="from">从</label>
      <input id="from" name="from" type="date" value="${esc(filter.from || '')}">
      <label for="to">到</label>
      <input id="to" name="to" type="date" value="${esc(filter.to || '')}">
      <button class="btn secondary" type="submit">筛选</button>
    </form>
    <p class="lede">共 ${total} 条，第 ${page} / ${pages} 页</p>
    <div class="panel table-wrap">
      <table>
        <thead><tr><th>浏览人</th><th>被浏览的名片</th><th>开始时间</th><th>停留</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">这个范围内没有浏览</td></tr>'}</tbody>
      </table>
    </div>
    <div class="inline-actions" style="margin-top:12px">
      <button class="btn secondary small" type="button" data-action="visits-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <button class="btn secondary small" type="button" data-action="visits-next" ${page >= pages ? 'disabled' : ''}>下一页</button>
    </div>`);
}

function paint() {
  if (state.view === 'overview') app.innerHTML = dashboardHtml();
  else if (state.view === 'companies') app.innerHTML = companiesHtml();
  else if (state.view === 'templates') app.innerHTML = templatesHtml();
  else if (state.view === 'cert') app.innerHTML = certHtml();
  else if (state.view === 'cards') app.innerHTML = cardsHtml();
  else if (state.view === 'import') app.innerHTML = importHtml();
  else if (state.view === 'brand') app.innerHTML = brandHtml();
  else app.innerHTML = visitsHtml();
  const dialog = app.querySelector('dialog.dialog');
  if (dialog) dialog.showModal();
}

async function loadView(view) {
  state.error = '';
  if (!state.admin) {
    try { state.admin = await api('/api/me'); } catch (err) { state.admin = { scope: 'hq', companyId: '' }; }
  }
  const companyQuery = state.admin.scope === 'company' && state.admin.companyId
    ? '?id=' + encodeURIComponent(state.admin.companyId)
    : '';
  if (view === 'companies' && state.admin.scope === 'company') view = 'cert';
  state.view = view;
  if (view === 'cards' || view === 'import' || view === 'templates') {
    state.templates = (await api('/api/templates')).items || [];
  }
  if (view === 'overview') {
    const [employees, certifications, companies] = await Promise.all([
      api('/api/employees'),
      api('/api/certifications'),
      state.admin.scope === 'company' ? Promise.resolve({ items: [] }) : api('/api/companies'),
    ]);
    state.employees = employees.items || [];
    state.certifications = certifications.items || [];
    state.companies = companies.items || [];
  } else if (view === 'companies') {
    state.companies = (await api('/api/companies')).items || [];
  } else if (view === 'cert') {
    state.certifications = (await api('/api/certifications')).items || [];
    if (state.admin.scope === 'company' && state.admin.companyId) {
      const brand = await api('/api/company?id=' + encodeURIComponent(state.admin.companyId));
      state.certCode = (brand.company && brand.company.certCode) || '';
    } else {
      state.certCode = '';
    }
  } else if (view === 'cards') {
    const [employees, companies] = await Promise.all([
      api('/api/employees?q=' + encodeURIComponent(state.query)),
      api('/api/companies').catch(() => ({ items: [] })),
    ]);
    state.employees = employees.items;
    state.companies = (companies && companies.items) || [];
  } else if (view === 'brand') {
    state.company = (await api('/api/company' + companyQuery)).company;
  } else if (view === 'templates') {
    if (state.admin.scope === 'company') {
      const company = await api('/api/company' + companyQuery);
      state.company = company.company;
      state.companies = [{ ...company.company, id: state.admin.companyId }];
    } else {
      const [company, companies] = await Promise.all([api('/api/company'), api('/api/companies')]);
      state.company = company.company;
      state.companies = companies.items || [];
    }
  } else if (view === 'visits') {
    state.employees = (await api('/api/employees')).items;
    state.visitPage = 1;
    await loadVisits();
  }
  paint();
}

async function route() {
  if (!token()) {
    renderLogin();
    return;
  }
  const view = (location.hash || '#/overview').replace('#/', '') || 'overview';
  const known = views.some(([id]) => id === view);
  try {
    await loadView(known ? view : 'overview');
  } catch (err) {
    if (err.status === 401) renderLogin(err.message);
    else {
      state.error = err.message;
      paint();
    }
  }
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function splitImportRow(line) {
  if (line.indexOf('\t') >= 0) return line.split('\t').map((cell) => cell.trim());
  return line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
}

function parseImportTable(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('请粘贴表格或选择文件');
  if (text.startsWith('[')) return JSON.parse(text);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const alias = {
    姓名: 'name', 职位: 'title', 职务: 'title', 手机号: 'phone', 手机: 'phone',
    邮箱: 'email', 二维码: 'qr', 公司: 'company', 地址: 'address',
    name: 'name', title: 'title', phone: 'phone', email: 'email', qr: 'qr', company: 'company', address: 'address',
  };
  const header = splitImportRow(lines[0]).map((cell) => alias[cell] || '');
  const hasHeader = header.indexOf('name') >= 0;
  const order = ['name', 'title', 'phone', 'email', 'qr', 'company', 'address'];
  return lines.slice(hasHeader ? 1 : 0).map((line) => {
    const cells = splitImportRow(line);
    const row = {};
    cells.forEach((cell, index) => {
      const key = hasHeader ? header[index] : order[index];
      if (key) row[key] = cell;
    });
    return row;
  }).filter((row) => row.name || row.phone);
}

document.addEventListener('change', (event) => {
  const input = event.target;
  if (!input || input.id !== 'batch-file' || !input.files || !input.files[0]) return;
  const file = input.files[0];
  const name = document.querySelector('#batch-file-name');
  if (name) name.textContent = file.name || '未选择文件';
  const lowerName = (file.name || '').toLowerCase();
  const area = document.querySelector('#batch');
  if (!/\.(csv|txt|tsv)$/.test(lowerName)) {
    if (area) area.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (area) area.value = String(reader.result || '');
  };
  reader.readAsText(file, 'utf-8');
});

function importIssuesHtml() {
  const issues = state.importIssues || [];
  if (!issues.length) return '';
  const rows = issues.map((item) => `
    <tr>
      <td>第 ${esc(item.row)} 行</td>
      <td>${esc(item.name || '未填写姓名')}</td>
      <td>${esc(item.reason)}</td>
    </tr>`).join('');
  return `
    <div class="panel table-wrap">
      <h3>导入失败记录</h3>
      <p class="lede">这些行没有写入名片。补上手机号后可以再次导入。</p>
      <table>
        <thead><tr><th>位置</th><th>姓名</th><th>原因</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function saveEmployee(form) {
  const data = formData(form);
  const id = data.id;
  delete data.id;
  const card = (state.editing && state.editing.cards || []).find((entry) => entry.id === data.cardId);
  const requirePhone = !data.cardId || !card || card.isDefault;
  if (requirePhone && !String(data.phone || '').trim()) throw new Error('创大产控模板的手机号不能为空');
  if (id) await api('/api/employees/' + id, { method: 'PUT', body: data });
  else await api('/api/employees', { method: 'POST', body: data });
  state.editing = null;
  state.notice = '名片已保存';
  await loadView('cards');
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  const kind = form.dataset.form;
  if (!kind) return;
  event.preventDefault();
  state.error = '';
  state.notice = '';
  try {
    if (kind === 'login') {
      const data = formData(form);
      const result = await api('/api/login', { method: 'POST', body: data });
      setToken(result.token);
      state.admin = result;
      location.hash = '#/overview';
      await route();
      return;
    }
    if (kind === 'search') {
      state.query = formData(form).q || '';
      await loadView('cards');
      return;
    }
    if (kind === 'employee') {
      await saveEmployee(form);
      return;
    }
    if (kind === 'batch') {
      const fileInput = form.querySelector('#batch-file');
      const file = fileInput && fileInput.files && fileInput.files[0];
      const lowerName = file ? (file.name || '').toLowerCase() : '';
      let result;
      if (file && !/\.(csv|txt|tsv)$/.test(lowerName)) {
        const body = new FormData();
        body.append('file', file);
        body.append('cardTemplate', formData(form).cardTemplate || 'classic');
        result = await api('/api/employees/import-file', { method: 'POST', form: body });
      } else {
        const list = parseImportTable(formData(form).list);
        result = await api('/api/employees/batch', { method: 'POST', body: { list, cardTemplate: formData(form).cardTemplate || 'classic' } });
      }
      state.importIssues = result.rejected || [];
      const failed = state.importIssues.length;
      state.notice = '已导入 ' + (result.items || []).length + ' 张名片' + (failed ? '，' + failed + ' 条因缺少手机号或其他原因未创建' : '');
      await loadView('import');
      return;
    }
    if (kind === 'company') {
      const fields = formData(form);
      const created = await api('/api/companies', { method: 'POST', body: { name: fields.name, shortName: fields.shortName } });
      await api('/api/company-admins', {
        method: 'POST',
        body: { companyId: created.id, username: fields.username, password: fields.password },
      });
      state.notice = '已创建公司和管理员账号';
      await loadView('companies');
      return;
    }
    if (kind === 'brand') {
      state.company = (await api('/api/company', { method: 'PUT', body: formData(form) })).company;
      state.notice = '品牌已更新';
      paint();
      return;
    }
    if (kind === 'template') {
      const fields = formData(form);
      const qrFile = form.querySelector('#qr-file').files[0];
      let qrUrl = (state.templates || []).find((item) => item.id === fields.templateId)?.qrUrl || '';
      if (qrFile) {
        const upload = new FormData();
        upload.append('file', qrFile);
        qrUrl = (await api('/api/upload', { method: 'POST', form: upload })).url;
      }
      await api(fields.templateId ? '/api/templates/' + encodeURIComponent(fields.templateId) : '/api/templates', {
        method: fields.templateId ? 'PUT' : 'POST',
        body: {
          name: fields['tpl-name'],
          companyName: fields.companyName,
          companyNameEn: fields.companyNameEn,
          shortName: fields.shortName,
          shortNameEn: fields.shortNameEn,
          qrUrl,
          companyIds: new FormData(form).getAll('companyIds'),
        },
      });
      state.editingTemplate = '';
      state.notice = fields.templateId ? '模板已更新' : '模板已创建并分配';
      await loadView('templates');
      return;
    }
    if (kind === 'visits') {
      const data = formData(form);
      state.visitFilter = {
        cardId: data.cardId || '',
        from: data.from || '',
        to: data.to || '',
      };
      state.visitPage = 1;
      await loadVisits();
      paint();
    }
  } catch (err) {
    state.error = err.message;
    if (kind === 'login') renderLogin(err.message);
    else paint();
  }
});

document.addEventListener('change', (event) => {
  const select = event.target;
  if (!select || select.id !== 'pick-card') return;
  const found = state.employees.find((item) => item.id === select.dataset.id);
  const card = found && (found.cards || []).find((entry) => entry.id === select.value);
  if (!found || !card || (state.editing && state.editing.editingCardId === card.id)) return;
  state.editing = cardFields(found, card);
  paint();
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  try {
    if (action === 'open-templates') {
      const gallery = document.getElementById('template-gallery');
      if (gallery && gallery.showModal) {
        gallery.dataset.field = button.dataset.field || 'cardTemplate';
        gallery.showModal();
      }
      return;
    }
    if (action === 'close-templates') {
      const gallery = document.getElementById('template-gallery');
      if (gallery && gallery.close) gallery.close();
      return;
    }
    if (action === 'choose-template') {
      const gallery = document.getElementById('template-gallery');
      const field = (gallery && gallery.dataset.field) || 'cardTemplate';
      const value = cardTemplateId(button.dataset.template);
      const input = document.querySelector('input[name="' + field + '"]');
      const label = document.querySelector('[data-template-label="' + field + '"]');
      if (input) input.value = value;
      if (label) label.textContent = templateName(value);
      if (gallery && gallery.close) gallery.close();
      return;
    }
    if (action === 'edit-template') {
      state.editingTemplate = id;
      state.previewTemplate = '';
      paint();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (action === 'cancel-template') {
      state.editingTemplate = '';
      paint();
      return;
    }
    if (action === 'preview-template') {
      state.previewTemplate = id;
      paint();
      document.getElementById('template-preview')?.showModal();
      return;
    }
    if (action === 'close-template-preview') {
      document.getElementById('template-preview')?.close();
      state.previewTemplate = '';
      return;
    }
    if (action === 'remove-template-assignment') {
      const assigned = (state.templates || []).find((item) => item.id === id);
      if (!assigned || assigned.id === 'classic') return;
      if (!window.confirm('确定移除本公司的「' + assigned.name + '」模板？总部模板和其他公司的分配不会被删除，已有名片也不会被删除。')) return;
      await api('/api/templates/' + encodeURIComponent(id) + '/assignment', { method: 'DELETE' });
      state.previewTemplate = '';
      state.notice = '已移除本公司的模板分配';
      await loadView('templates');
      return;
    }
    if (action === 'visits-prev' || action === 'visits-next') {
      const pages = Math.max(1, Math.ceil((state.visitTotal || 0) / (state.visitLimit || 50)));
      const next = action === 'visits-prev' ? state.visitPage - 1 : state.visitPage + 1;
      if (next < 1 || next > pages) return;
      state.visitPage = next;
      await loadVisits();
      paint();
      return;
    }
    if (action === 'logout') {
      await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
      setToken('');
      location.hash = '#/login';
      renderLogin();
      return;
    }
    if (action === 'create') {
      state.editing = { status: 'active', cardTemplate: 'classic', company: state.company ? state.company.name : '创大产控集团' };
      paint();
      return;
    }
    if (action === 'close-dialog') {
      state.editing = null;
      paint();
      return;
    }
    if (action === 'edit') {
      const found = state.employees.find((item) => item.id === id);
      state.editing = found ? defaultCardFields(found) : null;
      paint();
      return;
    }
    if (action === 'edit-card') {
      const found = state.employees.find((item) => item.id === id);
      const cardId = event.target.getAttribute('data-card');
      const card = found && (found.cards || []).find((entry) => entry.id === cardId);
      if (found && card) state.editing = cardFields(found, card);
      paint();
      return;
    }
    if (action === 'delete-card') {
      const cardId = event.target.getAttribute('data-card');
      if (!window.confirm('确定删除这张名片？该员工至少会保留一张名片。')) return;
      const wasEditing = !!state.editing;
      const saved = await api('/api/employees/' + id + '/cards/' + encodeURIComponent(cardId), { method: 'DELETE' });
      state.notice = '已删除该名片';
      await loadView('cards');
      if (wasEditing) {
        const employee = saved.employee;
        const card = employee && ((employee.cards || []).find((entry) => entry.isDefault) || (employee.cards || [])[0]);
        state.editing = employee && card ? cardFields(employee, card) : null;
        paint();
      }
      return;
    }
    if (action === 'disable' || action === 'restore') {
      await api('/api/employees/' + id, {
        method: 'PUT',
        body: { status: action === 'restore' ? 'active' : 'disabled' },
      });
      state.notice = action === 'restore' ? '账号已恢复，该员工可用原来的微信重新登录' : '已停用，对外名片不可见';
      await loadView('cards');
      return;
    }
    if (action === 'merge') {
      const sourceId = (document.querySelector('#mergeSourceId').value || '').trim();
      await api('/api/employees/' + id + '/merge', { method: 'POST', body: { sourceId } });
      state.editing = null;
      state.notice = '已合并，重复的那条已停用';
      await loadView('cards');
      return;
    }
    if (action === 'approve-cert' || action === 'reject-cert' || action === 'revoke-cert') {
      const verb = action === 'approve-cert' ? 'approve' : action === 'reject-cert' ? 'reject' : 'revoke';
      if (verb === 'revoke' && !window.confirm('取消后，这张名片上的该公司会被清除，对应子公司管理员将看不到这名员工。')) return;
      await api('/api/certifications/' + encodeURIComponent(id) + '/' + verb, { method: 'POST', body: {} });
      state.notice = verb === 'approve'
        ? '已通过。员工可在编辑名片里选择这家公司'
        : verb === 'revoke'
          ? '已取消认证，该公司已从名片中移除'
          : '已拒绝该申请';
      await loadView('cert');
      return;
    }
    if (action === 'remove') {
      const person = state.employees.find((item) => item.id === id);
      const ok = window.confirm('确定删除员工「' + (person ? person.name : '该员工') + '」及其全部名片记录？');
      if (!ok) return;
      await api('/api/employees/' + id, { method: 'DELETE' });
      state.notice = '已删除';
      await loadView('cards');
    }
  } catch (err) {
    state.error = err.message;
    paint();
  }
});

window.addEventListener('hashchange', route);
route();
