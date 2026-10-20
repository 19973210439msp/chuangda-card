function emptyCardState({ hasCard, templates, certified, pending }) {
  if (hasCard) return { visible: false, kind: '', title: '', description: '', action: '' };
  if ((templates || []).length) {
    return {
      visible: true,
      kind: 'ready',
      title: '企业认证已通过',
      description: `已有 ${(templates || []).length} 套可用模板，请选择模板创建你的第一张名片。`,
      action: '创建名片',
    };
  }
  if ((certified || []).length) {
    return {
      visible: true,
      kind: 'waiting-template',
      title: '企业认证已通过',
      description: '认证企业暂未获得可用模板，请联系管理员发放模板。',
      action: '查看认证',
    };
  }
  if ((pending || []).length) {
    return {
      visible: true,
      kind: 'pending',
      title: '企业认证审核中',
      description: '认证申请已提交，审核通过并获得模板后即可创建名片。',
      action: '查看进度',
    };
  }
  return {
    visible: true,
    kind: 'uncertified',
    title: '还没有可用名片',
    description: '请先完成企业认证。认证通过且企业获得模板后，即可创建名片。',
    action: '去企业认证',
  };
}

module.exports = { emptyCardState };
