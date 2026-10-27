const { httpError } = require('./errors');

function defaultPermissionEnabled() {
  return process.env.MINIPROGRAM_DEFAULT_CARD_PERMISSION_ENABLED === 'true';
}

function normalizePermission(input) {
  const level = input && input.level;
  if (![1, 2, 3].includes(level)) throw httpError(400, 'VALIDATION_ERROR', '请选择一级、二级或三级名片权限');
  const companyIds = level === 2 && Array.isArray(input.companyIds)
    ? [...new Set(input.companyIds.map(String).filter(Boolean))] : [];
  if (level === 2 && !companyIds.length) throw httpError(400, 'VALIDATION_ERROR', '二级权限至少选择一家企业');
  return { level, companyIds };
}

function effectivePermission(person, root, enabled = defaultPermissionEnabled()) {
  const explicit = person.cardPermission;
  const base = explicit || (enabled && root && root.defaultCardPermission) || { level: 1 };
  const companies = new Set(base.level === 2 ? base.companyIds || [] : []);
  if (!explicit && base.level !== 3) {
    for (const [id, allowed] of Object.entries(person.companyCardPermissions || {})) {
      if (allowed === true) companies.add(id);
      if (allowed === false) companies.delete(id);
    }
  }
  const level = base.level === 3 ? 3 : (companies.size ? 2 : 1);
  return {
    level,
    companyIds: [...companies],
    source: explicit ? 'individual' : (Object.keys(person.companyCardPermissions || {}).length ? 'company' : (enabled ? 'default' : 'ordinary')),
  };
}

function canManageCompany(permission, companyId) {
  return !!companyId && (permission.level === 3 || (permission.level === 2 && permission.companyIds.includes(companyId)));
}

function assertManageCompany(permission, companyId) {
  if (!canManageCompany(permission, companyId)) throw httpError(403, 'CARD_PERMISSION_REQUIRED', '没有该企业的名片操作权限，请联系管理员');
}

function setPermission(person, admin, body) {
  const next = { ...person };
  if (admin.scope === 'company') {
    if (person.cardPermission || ![1, 2].includes(body.level)
      || (body.companyIds || []).some((id) => id !== admin.companyId)) {
      throw httpError(403, 'FORBIDDEN', '子管理员只能设置本企业权限，不能修改总部单独设置的权限');
    }
    next.companyCardPermissions = { ...(person.companyCardPermissions || {}), [admin.companyId]: body.level === 2 };
  } else if (body.level === null) {
    delete next.cardPermission;
    delete next.companyCardPermissions;
  } else {
    next.cardPermission = normalizePermission(body);
    delete next.companyCardPermissions;
  }
  return next;
}

function mergePermissions(target, source) {
  const next = { ...target };
  const hasExplicit = !!(target.cardPermission || source.cardPermission);
  if (hasExplicit) {
    const permissions = [effectivePermission(target, null, false), effectivePermission(source, null, false)];
    if (permissions.some((permission) => permission.level === 3)) {
      next.cardPermission = { level: 3, companyIds: [] };
    } else {
      const companyIds = [...new Set(permissions.flatMap((permission) => (
        permission.level === 2 ? permission.companyIds : []
      )))];
      next.cardPermission = companyIds.length
        ? { level: 2, companyIds }
        : { level: 1, companyIds: [] };
    }
    delete next.companyCardPermissions;
    return next;
  }

  const combined = {};
  const keys = new Set([
    ...Object.keys(target.companyCardPermissions || {}),
    ...Object.keys(source.companyCardPermissions || {}),
  ]);
  for (const id of keys) {
    const values = [target.companyCardPermissions && target.companyCardPermissions[id], source.companyCardPermissions && source.companyCardPermissions[id]];
    combined[id] = values.includes(true) ? true : false;
  }
  if (keys.size) next.companyCardPermissions = combined;
  else delete next.companyCardPermissions;
  return next;
}

module.exports = { defaultPermissionEnabled, normalizePermission, effectivePermission, canManageCompany, assertManageCompany, setPermission, mergePermissions };
