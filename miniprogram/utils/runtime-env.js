function envVersion() {
  try {
    const info = typeof wx !== 'undefined' && typeof wx.getAccountInfoSync === 'function'
      ? wx.getAccountInfoSync() : null;
    const value = info && info.miniProgram && info.miniProgram.envVersion;
    return ['develop', 'trial', 'release'].includes(value) ? value : 'release';
  } catch (err) {
    return 'release';
  }
}

function reviewEnvironmentAllowed() {
  const value = envVersion();
  return value === 'develop' || value === 'trial';
}

module.exports = { envVersion, reviewEnvironmentAllowed };
