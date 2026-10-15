const root = document.querySelector('#card-root');
const params = new URLSearchParams(location.search);
const cardId = params.get('cardId') || '';
const shareCard = params.get('shareCard') || '';
const visitorKey = 'chuangda_visitor';
let viewId = '';
let started = Date.now();

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function visitorId() {
  let id = localStorage.getItem(visitorKey);
  if (!id) {
    id = 'web-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(visitorKey, id);
  }
  return id;
}

function absolute(url) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return location.origin + url;
}

const PHONE_ICON = 'M9.36556 10.6821C10.302 12.3288 11.6712 13.698 13.3179 14.6344L14.2024 13.3961C14.4965 12.9845 15.0516 12.8573 15.4956 13.0998C16.9024 13.8683 18.4571 14.3353 20.0789 14.4637C20.599 14.5049 21 14.9389 21 15.4606V19.9234C21 20.4361 20.6122 20.8657 20.1022 20.9181C19.5723 20.9726 19.0377 21 18.5 21C9.93959 21 3 14.0604 3 5.5C3 4.96227 3.02742 4.42771 3.08189 3.89776C3.1343 3.38775 3.56394 3 4.07665 3H8.53942C9.0611 3 9.49513 3.40104 9.5363 3.92109C9.66467 5.54288 10.1317 7.09764 10.9002 8.50444C11.1427 8.9484 11.0155 9.50354 10.6039 9.79757L9.36556 10.6821ZM6.84425 10.0252L8.7442 8.66809C8.20547 7.50514 7.83628 6.27183 7.64727 5H5.00907C5.00303 5.16632 5 5.333 5 5.5C5 12.9558 11.0442 19 18.5 19C18.667 19 18.8337 18.997 19 18.9909V16.3527C17.7282 16.1637 16.4949 15.7945 15.3319 15.2558L13.9748 17.1558C13.4258 16.9425 12.8956 16.6915 12.3874 16.4061L12.3293 16.373C10.3697 15.2587 8.74134 13.6303 7.627 11.6707L7.59394 11.6126C7.30849 11.1044 7.05754 10.5742 6.84425 10.0252Z';
const CONTACT_ICON = 'M3 2H19.0049C20.1068 2 21 2.89821 21 3.9908V20.0092C21 21.1087 20.1074 22 19.0049 22H3V2ZM7 4H5V20H7V4ZM9 20H19V4H9V20ZM11 16C11 14.3431 12.3431 13 14 13C15.6569 13 17 14.3431 17 16H11ZM14 12C12.8954 12 12 11.1046 12 10C12 8.89543 12.8954 8 14 8C15.1046 8 16 8.89543 16 10C16 11.1046 15.1046 12 14 12ZM22 6H24V10H22V6ZM22 12H24V16H22V12Z';
const EXCHANGE_ICON = 'M12.0049 22.0027C6.48204 22.0027 2.00488 17.5256 2.00488 12.0027C2.00488 6.4799 6.48204 2.00275 12.0049 2.00275C17.5277 2.00275 22.0049 6.4799 22.0049 12.0027C22.0049 17.5256 17.5277 22.0027 12.0049 22.0027ZM12.0049 20.0027C16.4232 20.0027 20.0049 16.421 20.0049 12.0027C20.0049 7.58447 16.4232 4.00275 12.0049 4.00275C7.5866 4.00275 4.00488 7.58447 4.00488 12.0027C4.00488 16.421 7.5866 20.0027 12.0049 20.0027ZM7.00488 13.0027H16.0049V15.0027H12.0049V18.0027L7.00488 13.0027ZM12.0049 9.00275V6.00275L17.0049 11.0027H8.00488V9.00275H12.0049Z';

function openOfficialQr() {
  let mask = document.querySelector('#qr-mask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'qr-mask';
    mask.innerHTML = '<div class="qr-panel"><img alt="公众号二维码"><p>长按二维码，选择识别图中二维码，即可关注公众号</p><button type="button">关闭</button></div>';
    mask.addEventListener('click', (event) => {
      if (event.target === mask || event.target.tagName === 'BUTTON') mask.hidden = true;
    });
    document.body.append(mask);
  }
  mask.hidden = false;
  mask.querySelector('img').src = document.querySelector('#official-qr').src;
}

function icon(path) {
  return `<svg viewBox="0 0 24 24" fill="#182850" aria-hidden="true"><path d="${path}"/></svg>`;
}

function row(label, value) {
  if (!value) return '';
  return `<div class="row"><dt>${label}</dt><dd>${esc(value)}</dd></div>`;
}

function renderCard(card, company) {
  const brand = company || {};
  const logoSrc = '/brand-logo.png';
  const files = (card.attachments || []).filter((item) => item && item.name !== '微信二维码').map((file) => (
    `<li><a href="${esc(absolute(file.url))}">${esc(file.name)}</a></li>`
  )).join('');
  document.title = (card.name || '电子名片') + (brand.shortName ? ' · ' + brand.shortName : '');
  root.innerHTML = `
    <article class="front ${card.cardTemplate === 'horizon' ? 'front-horizon' : ''}">
      <div class="corp">
        <p class="corp-cn" data-fit-target>${esc(brand.name || card.company || '')}</p>
        <div class="en-clip"><p class="corp-en" data-fit="left">${esc(brand.nameEn || '')}</p></div>
      </div>
      <div class="brand">
        <div class="seal"><img class="seal-img" alt="" src="${esc(logoSrc)}"></div>
        <div class="brand-names">
          <p class="brand-cn" data-fit-target>${esc(brand.shortName || '创大产控')}</p>
          <div class="en-clip"><p class="brand-en" data-fit="center">${esc(brand.brandEn || '')}</p></div>
        </div>
      </div>
      <p class="who"><strong>${esc(card.name || '')}</strong><span>${esc(card.title || '')}</span></p>
      <p class="mobile">M:${esc(card.phone || '')}</p>
      <div class="tick" aria-hidden="true"></div>
      <div class="contact">
        <p>电话/Tel:${esc(brand.phone || '')}</p>
        <p>邮箱/E-mail:${esc(card.email || '')}</p>
        <p>地址/Add:${esc(card.address || brand.address || '')}</p>
      </div>
      <img class="qr" id="official-qr" alt="公众号二维码" src="${esc(brand.qrUrl || '/official-qr.jpg')}">
    </article>
    ${files ? `<ul class="files">${files}</ul>` : ''}
    <div class="icon-actions">
        ${card.phone ? `<a class="op" href="tel:${esc(card.phone)}">${icon(PHONE_ICON)}<span>拨打电话</span></a>` : ''}
        <button type="button" class="op" id="save-contact">${icon(CONTACT_ICON)}<span>保存联系人</span></button>
        <button type="button" class="op" id="exchange">${icon(EXCHANGE_ICON)}<span>交换名片</span></button>
      </div>
    <dialog id="exchange-dialog">
      <form id="exchange-form">
        <h2>交换名片</h2>
        <p>留下联系方式，方便对方回访。</p>
        <label for="ex-name">姓名</label>
        <input id="ex-name" name="name" required>
        <label for="ex-phone">电话</label>
        <input id="ex-phone" name="phone" required>
        <label for="ex-company">公司</label>
        <input id="ex-company" name="company">
        <p class="form-error" id="exchange-error" hidden></p>
        <menu>
          <button type="button" id="exchange-cancel">取消</button>
          <button class="solid" type="submit">提交</button>
        </menu>
      </form>
    </dialog>`;
  document.querySelector('#save-contact').addEventListener('click', () => downloadVcard(card));
  document.querySelector('#official-qr').addEventListener('click', openOfficialQr);
  const dialog = document.querySelector('#exchange-dialog');
  document.querySelector('#exchange').addEventListener('click', () => dialog.showModal());
  document.querySelector('#exchange-cancel').addEventListener('click', () => dialog.close());
  document.querySelector('#exchange-form').addEventListener('submit', (event) => submitExchange(event, dialog));
  requestAnimationFrame(() => requestAnimationFrame(fitEnglish));
  window.addEventListener('resize', fitEnglish);
}

function fitEnglish() {
  document.querySelectorAll('[data-fit]').forEach((en) => {
    const target = en.parentElement.parentElement.querySelector('[data-fit-target]');
    if (!target) return;
    en.style.transform = 'none';
    const targetWidth = target.getBoundingClientRect().width;
    const textWidth = en.scrollWidth || en.getBoundingClientRect().width;
    if (!targetWidth || !textWidth) return;
    en.style.transformOrigin = en.dataset.fit === 'center' ? 'center center' : 'left center';
    en.style.transform = 'scaleX(' + (targetWidth / textWidth) + ')';
  });
}

function downloadVcard(card) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:' + card.name,
    'ORG:' + (card.company || ''),
    'TITLE:' + (card.title || ''),
    'TEL:' + (card.phone || ''),
    'EMAIL:' + (card.email || ''),
    'ADR:;;' + (card.address || ''),
    'END:VCARD',
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/vcard' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = (card.name || 'card') + '.vcf';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function submitExchange(event, dialog) {
  event.preventDefault();
  const error = document.querySelector('#exchange-error');
  const data = Object.fromEntries(new FormData(event.target).entries());
  if (!viewId) {
    error.hidden = false;
    error.textContent = '浏览记录还没建立，请刷新后再试';
    return;
  }
  const response = await fetch('/api/analytics/view/' + viewId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exchange: data, durationSec: Math.round((Date.now() - started) / 1000) }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    error.hidden = false;
    error.textContent = (body.error && body.error.message) || '提交失败';
    return;
  }
  dialog.close();
  const done = document.createElement('p');
  done.className = 'note';
  done.textContent = '已提交，对方可以在数据里看到这次交换。';
  root.append(done);
}

function renderMessage(title, text) {
  document.title = title;
  root.innerHTML = `<section class="status"><h1>${esc(title)}</h1><p>${esc(text)}</p></section>`;
}

async function track(active) {
  if (!active) return;
  const response = await fetch('/api/analytics/view', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, visitorId: visitorId() }),
  });
  if (!response.ok) return;
  const data = await response.json();
  viewId = data.viewId;
  started = Date.now();
}

function reportDuration() {
  if (!viewId) return;
  const durationSec = Math.round((Date.now() - started) / 1000);
  fetch('/api/analytics/view/' + viewId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ durationSec }),
    keepalive: true,
  });
}

async function main() {
  if (!cardId) {
    renderMessage('缺少名片', '请使用完整的分享链接打开。');
    return;
  }
  const [response, companyResponse] = await Promise.all([
    fetch('/api/cards/' + encodeURIComponent(cardId) + (shareCard ? '?shareCard=' + encodeURIComponent(shareCard) : '')),
    fetch('/api/company'),
  ]);
  const data = await response.json().catch(() => ({}));
  const companyData = await companyResponse.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data.error && data.error.message) || '暂时无法打开';
    renderMessage(response.status === 404 ? '名片不可用' : '打开失败', message);
    return;
  }
  renderCard(data.card, data.company || companyData.company);
  await track(Boolean(data.card));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') reportDuration();
  });
  window.addEventListener('pagehide', reportDuration);
}

main();
