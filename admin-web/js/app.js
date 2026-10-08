const app = document.querySelector('#app');
const views = [
  ['dashboard', '数据看板'],
  ['cards', '名片管理'],
  ['brand', '品牌设置'],
  ['visits', '浏览明细'],
];

const state = {
  view: 'dashboard',
  company: null,
  employees: [],
  summary: [],
  visits: [],
  query: '',
  editing: null,
  error: '',
  notice: '',
  importIssues: [],
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

function shell(title, body) {
  const nav = views.map(([id, label]) => (
    `<a href="#/${id}" ${state.view === id ? 'aria-current="page"' : ''}>${label}</a>`
  )).join('');
  return `
    <div class="shell">
      <aside class="rail">
        <div class="seal" aria-hidden="true">创</div>
        <p class="brand-name">创大产控</p>
        <p class="brand-sub">电子名片管理</p>
        <nav aria-label="后台">${nav}</nav>
      </aside>
      <main id="main">
        <div class="section-head">
          <div>
            <h2>${title}</h2>
          </div>
          <button class="btn secondary small" type="button" data-action="logout">退出</button>
        </div>
        ${state.notice ? `<p class="banner ok" role="status">${esc(state.notice)}</p>` : ''}
        ${state.error ? `<p class="banner" role="alert">${esc(state.error)}</p>` : ''}
        ${body}
      </main>
    </div>`;
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

function dashboardHtml() {
  const cards = state.summary;
  const viewsCount = cards.reduce((sum, item) => sum + item.views, 0);
  const exchanges = cards.reduce((sum, item) => sum + item.exchanges, 0);
  const ranked = cards.slice().sort((a, b) => b.interestIndex - a.interestIndex);
  const rows = ranked.map((item) => `
    <tr>
      <td>${esc(item.name)}</td>
      <td>${item.views}</td>
      <td>${item.visitors}</td>
      <td>${item.avgDurationSec} 秒</td>
      <td>${item.exchanges}</td>
      <td>${item.interestIndex}</td>
    </tr>`).join('');
  const closed = state.employees.filter((item) => item.status === 'closed');
  const closedRows = closed.map((item) => `
    <tr>
      <td>${esc(item.name || '未命名')}</td>
      <td>${esc(item.title)}</td>
      <td>${esc(item.phone)}</td>
      <td>${esc(item.email)}</td>
      <td>${esc(item.company)}</td>
      <td><button class="btn small" type="button" data-action="restore" data-id="${esc(item.id)}">恢复账号</button></td>
    </tr>`).join('');
  return shell('数据看板', `
    <p class="lede">兴趣指数综合浏览次数、停留时长、独立访客和交换留资，满分 100。</p>
    <div class="panel table-wrap">
      <h3>已注销账号</h3>
      <p class="lede">注销标记保存在员工记录的状态里，不会另建一张表。同一微信不能再注册新号，点「恢复账号」后用原来的微信重新登录。</p>
      <table>
        <thead><tr><th>姓名</th><th>职位</th><th>手机号</th><th>邮箱</th><th>公司</th><th>操作</th></tr></thead>
        <tbody>${closedRows || '<tr><td colspan="6">目前没有已注销账号</td></tr>'}</tbody>
      </table>
    </div>
    <section class="stat-row" aria-label="汇总">
      <div class="stat"><b>${state.employees.length}</b><span>员工名片</span></div>
      <div class="stat"><b>${viewsCount}</b><span>累计浏览</span></div>
      <div class="stat"><b>${exchanges}</b><span>交换留资</span></div>
    </section>
    <div class="panel table-wrap">
      <table>
        <thead>
          <tr><th>姓名</th><th>浏览</th><th>访客</th><th>平均停留</th><th>交换</th><th>兴趣指数</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="6">还没有名片数据</td></tr>'}</tbody>
      </table>
    </div>`);
}

function cardsHtml() {
  const rows = state.employees.map((item) => `
    <tr>
      <td>${esc(item.name || '未命名')}</td>
      <td>${esc(item.title)}</td>
      <td>${esc(item.phone)}</td>
      <td>${esc(item.email)}</td>
      <td><span class="tag ${esc(item.status)}">${statusLabel(item.status)}</span></td>
      <td class="inline-actions">
        <button class="btn secondary small" type="button" data-action="edit" data-id="${esc(item.id)}">编辑</button>
        ${item.status === 'closed' || item.status === 'disabled'
          ? `<button class="btn small" type="button" data-action="restore" data-id="${esc(item.id)}">恢复账号</button>`
          : `<button class="btn secondary small" type="button" data-action="disable" data-id="${esc(item.id)}">停用</button>`}
        <button class="btn danger small" type="button" data-action="remove" data-id="${esc(item.id)}">删除</button>
      </td>
    </tr>`).join('');
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
        <input id="q" name="q" value="${esc(state.query)}" placeholder="姓名、手机、邮箱">
        <button class="btn secondary" type="submit">搜索</button>
      </form>
      <button class="btn" type="button" data-action="create">新建名片</button>
    </div>
    <div class="panel table-wrap">
      <table>
        <thead><tr><th>员工</th><th>职位</th><th>手机</th><th>邮箱</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">没有匹配的员工</td></tr>'}</tbody>
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
    <form class="panel" data-form="batch">
      <h3>批量导入</h3>
      <p class="lede">可粘贴表格，或选择 xlsx、xls、xlsm、csv、tsv、ods 文件。表头为：姓名、职位、手机号、邮箱、二维码、公司、地址。手机号必填，缺电话的行不会创建，并记在下方失败记录里。同一手机号会更新原名片。</p>
      <label for="batch">导入内容</label>
      <textarea id="batch" name="list" placeholder="姓名,职位,手机号,邮箱,二维码,公司,地址"></textarea>
      <input id="batch-file" type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.txt,.tsv,.ods" style="margin-top:12px">
      <button class="btn" type="submit" style="margin-top:12px">导入</button>
    </form>
    ${importIssuesHtml()}
    ${dialog}`);
}

function field(id, label, value, type, required) {
  const mark = required ? '（必填）' : '';
  return `<label for="${id}">${label}${mark}</label><input id="${id}" name="${id}" type="${type || 'text'}" value="${esc(value || '')}" ${required ? 'required' : ''}>`;
}

function employeeDialog(item) {
  return `
    <dialog class="dialog">
      <form data-form="employee">
        <h3>${item.id ? '编辑名片' : '新建名片'}</h3>
        <input type="hidden" name="id" value="${esc(item.id || '')}">
        <div class="grid-2">
          <div>${field('name', '姓名', item.name)}</div>
          <div>${field('department', '部门', item.department)}</div>
          <div>${field('title', '职务', item.title)}</div>
          <div>${field('phone', '手机号', item.phone, 'tel', !item.id)}</div>
          <div>${field('wechat', '微信', item.wechat)}</div>
          <div>${field('email', '邮箱', item.email, 'email')}</div>
          <div>${field('company', '公司', item.company)}</div>
        </div>
        <label for="address">地址</label>
        <input id="address" name="address" value="${esc(item.address || '')}">
        ${item.id ? `<label for="mergeSourceId">把另一条记录并入这条</label><input id="mergeSourceId" placeholder="填写对方的员工编号，例如 emp-xxxx"><button class="btn secondary" type="button" data-action="merge" data-id="${esc(item.id)}" style="margin-top:8px">合并微信身份</button>` : ''}
        <label for="status">状态</label>
        <select id="status" name="status">
          ${['active', 'disabled', 'closed'].map((status) => (
            `<option value="${status}" ${item.status === status ? 'selected' : ''}>${statusLabel(status)}</option>`
          )).join('')}
        </select>
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
        <div>${field('slogan', '标语', company.slogan)}</div>
        <div>${field('website', '官网', company.website)}</div>
        <div>${field('phone', '电话', company.phone)}</div>
        <div>${field('wechat', '微信', company.wechat)}</div>
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

function visitsHtml() {
  const options = state.employees.map((item) => (
    `<option value="${esc(item.id)}">${esc(item.name)} ${esc(item.employeeNo)}</option>`
  )).join('');
  const rows = state.visits.map((item) => `
    <tr>
      <td>${esc(item.cardName)}</td>
      <td>${esc(item.visitorId || '匿名')}</td>
      <td>${esc(String(item.startedAt).replace('T', ' ').slice(0, 16))}</td>
      <td>${item.durationSec} 秒</td>
      <td>${item.exchange ? esc((item.exchange.name || '') + ' ' + (item.exchange.phone || '')) : '—'}</td>
    </tr>`).join('');
  return shell('浏览明细', `
    <form class="toolbar" data-form="visits">
      <label for="cardId">名片</label>
      <select id="cardId" name="cardId"><option value="">全部</option>${options}</select>
      <label for="from">从</label>
      <input id="from" name="from" type="date">
      <label for="to">到</label>
      <input id="to" name="to" type="date">
      <button class="btn secondary" type="submit">筛选</button>
    </form>
    <div class="panel table-wrap">
      <table>
        <thead><tr><th>名片</th><th>访客</th><th>开始时间</th><th>停留</th><th>交换</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">这个范围内没有浏览</td></tr>'}</tbody>
      </table>
    </div>`);
}

function paint() {
  if (state.view === 'dashboard') app.innerHTML = dashboardHtml();
  else if (state.view === 'cards') app.innerHTML = cardsHtml();
  else if (state.view === 'brand') app.innerHTML = brandHtml();
  else app.innerHTML = visitsHtml();
  const dialog = app.querySelector('dialog');
  if (dialog) dialog.showModal();
}

async function loadView(view) {
  state.view = view;
  state.error = '';
  if (view === 'dashboard') {
    const [summary, employees] = await Promise.all([
      api('/api/analytics/summary'),
      api('/api/employees'),
    ]);
    state.summary = summary.items;
    state.employees = employees.items;
  } else if (view === 'cards') {
    const employees = await api('/api/employees?q=' + encodeURIComponent(state.query));
    state.employees = employees.items;
  } else if (view === 'brand') {
    state.company = (await api('/api/company')).company;
  } else if (view === 'visits') {
    const [employees, visits] = await Promise.all([
      api('/api/employees'),
      api('/api/analytics/list'),
    ]);
    state.employees = employees.items;
    state.visits = visits.items;
  }
  paint();
}

async function route() {
  if (!token()) {
    renderLogin();
    return;
  }
  const view = (location.hash || '#/dashboard').replace('#/', '') || 'dashboard';
  const known = views.some(([id]) => id === view);
  try {
    await loadView(known ? view : 'dashboard');
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
  if (!String(data.phone || '').trim()) throw new Error('手机号不能为空');
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
      location.hash = '#/dashboard';
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
        result = await api('/api/employees/import-file', { method: 'POST', form: body });
      } else {
        const list = parseImportTable(formData(form).list);
        result = await api('/api/employees/batch', { method: 'POST', body: { list } });
      }
      state.importIssues = result.rejected || [];
      const failed = state.importIssues.length;
      state.notice = '已导入 ' + (result.items || []).length + ' 张名片' + (failed ? '，' + failed + ' 条因缺少手机号或其他原因未创建' : '');
      await loadView('cards');
      return;
    }
    if (kind === 'brand') {
      state.company = (await api('/api/company', { method: 'PUT', body: formData(form) })).company;
      state.notice = '品牌已更新';
      paint();
      return;
    }
    if (kind === 'visits') {
      const data = formData(form);
      const params = new URLSearchParams();
      if (data.cardId) params.set('cardId', data.cardId);
      if (data.from) params.set('from', data.from);
      if (data.to) params.set('to', data.to);
      state.visits = (await api('/api/analytics/list?' + params.toString())).items;
      paint();
    }
  } catch (err) {
    state.error = err.message;
    if (kind === 'login') renderLogin(err.message);
    else paint();
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  try {
    if (action === 'logout') {
      await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
      setToken('');
      location.hash = '#/login';
      renderLogin();
      return;
    }
    if (action === 'create') {
      state.editing = { status: 'active', company: state.company ? state.company.name : '创大产控集团' };
      paint();
      return;
    }
    if (action === 'close-dialog') {
      state.editing = null;
      paint();
      return;
    }
    if (action === 'edit') {
      state.editing = state.employees.find((item) => item.id === id);
      paint();
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
    if (action === 'remove') {
      const person = state.employees.find((item) => item.id === id);
      const ok = window.confirm('确定删除「' + (person ? person.name : '该员工') + '」的名片记录？');
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
