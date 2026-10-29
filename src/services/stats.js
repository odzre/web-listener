const { startOfPeriod } = require('../lib/dates');
const { formatUnits } = require('../lib/money');
const { STATUS } = require('./orders');

function summarizeRegion(orders, region, period, now = Date.now()) {
  const start = startOfPeriod(region, period, now);
  const regional = orders.filter((order) => order.region === region);
  const inPeriod = regional.filter((order) => new Date(order.createdAt).getTime() >= start);
  const successAll = regional.filter((order) => order.status === STATUS.SUCCESS);
  const revenueAll = successAll.reduce((total, order) => total + Number(order.amount || 0), 0);

  return {
    pending: inPeriod.filter((order) => order.status === STATUS.PENDING).length,
    success: inPeriod.filter((order) => order.status === STATUS.SUCCESS).length,
    expired: inPeriod.filter((order) => order.status === STATUS.EXPIRED).length,
    totalSuccess: successAll.length,
    revenueAll,
    revenueFormatted: formatUnits(region, revenueAll),
  };
}

function buildUserStats(orders, now = Date.now()) {
  const result = {};
  for (const region of ['MY', 'ID']) {
    result[region] = {
      daily: summarizeRegion(orders, region, 'day', now),
      monthly: summarizeRegion(orders, region, 'month', now),
    };
  }
  return result;
}

function buildAdminStats(orders, now = Date.now()) {
  const todayStartUtc = startOfPeriod('ID', 'day', now);
  const today = orders.filter((order) => new Date(order.createdAt).getTime() >= todayStartUtc);
  const success = orders.filter((order) => order.status === STATUS.SUCCESS);
  const pending = orders.filter((order) => order.status === STATUS.PENDING);
  const expired = orders.filter((order) => order.status === STATUS.EXPIRED);
  const revenueMy = success
    .filter((order) => order.region === 'MY')
    .reduce((total, order) => total + Number(order.amount || 0), 0);
  const revenueId = success
    .filter((order) => order.region === 'ID')
    .reduce((total, order) => total + Number(order.amount || 0), 0);

  return {
    todayOrders: today.length,
    todaySuccess: today.filter((order) => order.status === STATUS.SUCCESS).length,
    totalOrders: orders.length,
    totalSuccess: success.length,
    successMy: success.filter((order) => order.region === 'MY').length,
    successId: success.filter((order) => order.region === 'ID').length,
    totalPending: pending.length,
    totalExpired: expired.length,
    revenueMy,
    revenueId,
    revenueMyFormatted: formatUnits('MY', revenueMy),
    revenueIdFormatted: formatUnits('ID', revenueId),
    successRate: orders.length ? Math.round((success.length / orders.length) * 100) : 0,
  };
}

function lastSevenDays(orders, now = Date.now()) {
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const end = now - i * 86400000;
    const start = end - 86400000;
    const dayOrders = orders.filter((order) => {
      const created = new Date(order.createdAt).getTime();
      return created >= start && created <= end;
    });
    days.push({
      label: new Intl.DateTimeFormat('id-ID', { weekday: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(end)),
      total: dayOrders.length,
      success: dayOrders.filter((order) => order.status === STATUS.SUCCESS).length,
    });
  }
  return days;
}

module.exports = {
  summarizeRegion,
  buildUserStats,
  buildAdminStats,
  lastSevenDays,
};
