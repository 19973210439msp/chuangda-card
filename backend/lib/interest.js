/**
 * 兴趣指数 0–100。
 * 浏览次数最多 40，平均停留最多 30，发生交换留资 20，独立访客最多 10。
 */
function interestIndex(views) {
  if (!views || !views.length) return 0;
  const viewScore = Math.min(40, views.length * 8);
  const totalDuration = views.reduce((sum, view) => sum + (Number(view.durationSec) || 0), 0);
  const durationScore = Math.min(30, Math.round(totalDuration / views.length / 6));
  const exchangeScore = views.some((view) => view.exchange && (view.exchange.phone || view.exchange.name))
    ? 20
    : 0;
  const unique = new Set(views.map((view) => view.visitorId).filter(Boolean)).size;
  const uniqueScore = Math.min(10, unique * 2);
  return Math.min(100, viewScore + durationScore + exchangeScore + uniqueScore);
}

function averageDuration(views) {
  if (!views.length) return 0;
  const total = views.reduce((sum, view) => sum + (Number(view.durationSec) || 0), 0);
  return Math.round(total / views.length);
}

module.exports = { interestIndex, averageDuration };
