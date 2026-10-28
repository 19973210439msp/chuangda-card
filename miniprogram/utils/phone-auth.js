/**
 * 解析 button open-type="getPhoneNumber" 的回调。
 * 授权失败时几乎都带 fail，不能一律当成“用户拒绝”。
 */
function phoneAuthError(detail) {
  const info = detail || {};
  const errMsg = String(info.errMsg || '');
  const errno = info.errno;
  const msg = errMsg.toLowerCase();

  if (/user deny|user cancel|auth deny|cancel/.test(msg)) {
    return '你取消了手机号授权，请再点一次并选择允许';
  }
  if (
    errno === 1400001
    || errno === 104
    || /no permission|not enough|quota|未开通|没有权限|api scope/.test(msg)
  ) {
    return '小程序未开通手机号能力或额度不足，请联系管理员开通手机号快速验证';
  }
  if (!errMsg && (errno === undefined || errno === null)) {
    return '未拿到手机号授权码，请重试';
  }
  return '手机号授权失败：' + (errMsg || '未知错误') + (errno != null ? '（' + errno + '）' : '');
}

function phoneCodeFromEvent(event) {
  const detail = (event && event.detail) || {};
  return detail.code ? String(detail.code) : '';
}

module.exports = {
  phoneAuthError: phoneAuthError,
  phoneCodeFromEvent: phoneCodeFromEvent,
};
