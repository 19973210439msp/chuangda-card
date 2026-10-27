function emptyCardState({ hasCard, templates, permission } = {}) {
  if (hasCard) return { visible: false, kind: '', title: '', description: '', action: '' };
  if ((templates || []).length) return {
    visible: true, kind: 'ready', title: '可以创建名片',
    description: `已有 ${templates.length} 套可用模板，请选择模板创建名片。`, action: '创建名片',
  };
  return {
    visible: true, kind: 'ordinary', title: '暂无可用名片',
    description: permission && permission.level > 1
      ? '暂无可用模板，请联系管理员为授权企业发放模板。'
      : '请联系管理员分配名片。', action: '',
  };
}
module.exports = { emptyCardState };
