const KEY = 'loginAccounts';

function digits(phone) {
  const value = String(phone || '').replace(/\D/g, '');
  return value.length >= 11 ? value.slice(-11) : value;
}

function maskPhone(phone) {
  const local = digits(phone);
  if (local.length < 7) return '';
  return '+86 ' + local.slice(0, 3) + '****' + local.slice(-4);
}

function read() {
  const list = wx.getStorageSync(KEY);
  return Array.isArray(list) ? list : [];
}

function remember(employee) {
  if (!employee || !employee.id) return read();
  const phone = /^1\d{10}$/.test(digits(employee.phone)) ? digits(employee.phone) : '';
  const token = wx.getStorageSync('token') || '';
  const devOpenId = wx.getStorageSync('devOpenId') || '';
  const next = {
    employeeId: employee.id,
    phone,
    token,
    devOpenId,
    name: employee.name || '',
  };
  const list = read().filter((item) => {
    if (item.employeeId === next.employeeId) return false;
    if (phone && item.phone === phone) return false;
    if (token && item.token === token) return false;
    return true;
  });
  list.unshift(next);
  const saved = list.slice(0, 12);
  wx.setStorageSync(KEY, saved);
  return saved;
}

function present(currentId) {
  return read().map((item) => ({
    ...item,
    current: item.employeeId === currentId,
    phoneText: item.phone ? maskPhone(item.phone) : '未绑定手机号',
  })).sort((a, b) => Number(b.current) - Number(a.current));
}

function activate(account) {
  if (!account) return;
  if (account.token) wx.setStorageSync('token', account.token);
  else wx.removeStorageSync('token');
  if (account.devOpenId) wx.setStorageSync('devOpenId', account.devOpenId);
  else wx.removeStorageSync('devOpenId');
}

module.exports = { maskPhone, remember, present, activate };
