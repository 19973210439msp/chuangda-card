function digits(phone) {
  const value = String(phone || '').replace(/\D/g, '');
  return value.length >= 11 ? value.slice(-11) : value;
}

function maskPhone(phone) {
  const local = digits(phone);
  if (local.length < 7) return '';
  return '+86 ' + local.slice(0, 3) + '****' + local.slice(-4);
}

/** 仅记录当前登录身份；一微信一手机号，不做多账号切换。 */
function remember(employee) {
  if (!employee || !employee.id) return;
  try {
    wx.removeStorageSync('loginAccounts');
  } catch (err) {}
}

module.exports = { maskPhone, remember };
