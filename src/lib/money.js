const REGIONS = {
  MY: {
    code: 'MY',
    currency: 'MYR',
    symbol: 'RM',
    decimals: 2,
    offsetHours: 8,
    locale: 'ms-MY',
    label: 'Malaysia',
  },
  ID: {
    code: 'ID',
    currency: 'IDR',
    symbol: 'Rp',
    decimals: 0,
    offsetHours: 7,
    locale: 'id-ID',
    label: 'Indonesia',
  },
  PH: {
    code: 'PH',
    currency: 'PHP',
    symbol: '₱',
    decimals: 2,
    offsetHours: 8,
    locale: 'en-PH',
    label: 'Philippines',
  },
};

const REGION_ORDER = ['MY', 'ID', 'PH'];

function normalizeRegion(value) {
  const region = String(value || '').trim().toUpperCase();
  return REGIONS[region] ? region : null;
}

function parseLocaleNumber(raw, region) {
  let text = String(raw).trim().replace(/\s+/g, '');
  if (!text) return NaN;

  if (region === 'MY' || region === 'PH') {
    text = text.replace(/,/g, '');
    return Number(text);
  }

  if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, '');
  } else {
    text = text.replace(/\./g, '').replace(',', '.');
  }
  return Number(text);
}

function amountToUnits(region, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (region === 'MY' || region === 'PH') return Math.round(number * 100);
  return Math.round(number);
}

function parseAmountInput(region, raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let number;
  if (typeof raw === 'number') number = raw;
  else {
    number = parseLocaleNumber(raw, region);
  }
  if (!Number.isFinite(number) || number <= 0) return null;
  return amountToUnits(region, number);
}

function formatUnits(region, units) {
  const config = REGIONS[region] || REGIONS.ID;
  const amount = Number(units) || 0;
  if (region === 'MY') {
    return `RM${(amount / 100).toLocaleString('en-MY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (region === 'PH') {
    return `₱${(amount / 100).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `Rp${amount.toLocaleString('id-ID')}`;
}

function formatNumber(region, units) {
  const amount = Number(units) || 0;
  if (region === 'MY' || region === 'PH') return (amount / 100).toFixed(2);
  return String(Math.round(amount));
}

function parseNotificationAmounts(text) {
  const source = String(text || '');
  const candidates = [];
  const seen = new Set();

  const push = (region, amount, raw) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const key = `${region}:${amount}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ region, amount, raw });
  };

  const myMatch = source.match(/\bRM\s*([0-9][0-9.,]*)/i);
  if (myMatch) {
    const value = parseLocaleNumber(myMatch[1], 'MY');
    if (Number.isFinite(value)) push('MY', amountToUnits('MY', value), myMatch[0]);
  }

  const phMatch = source.match(/(?:\bPHP\b|₱)\s*([0-9][0-9.,]*)/i);
  if (phMatch) {
    const value = parseLocaleNumber(phMatch[1], 'PH');
    if (Number.isFinite(value)) push('PH', amountToUnits('PH', value), phMatch[0]);
  }

  const idMatch = source.match(/(?:\bRp\.?|\bIDR)\s*([0-9][0-9.,]*)/i);
  if (idMatch) {
    const value = parseLocaleNumber(idMatch[1], 'ID');
    if (Number.isFinite(value)) push('ID', amountToUnits('ID', value), idMatch[0]);
  }

  // Fallback untuk notifikasi tanpa simbol mata uang, misalnya:
  // "You received 1,000.00 in your wallet via InstaPay"
  const phContext = /(instapay|peso|maya|gcash|philippines)/i.test(source) || source.includes('₱');
  const incomingContext = isIncomingNotification(source) || candidates.length > 0;
  if (!incomingContext && !phContext) return candidates;

  const barePattern = /(?:^|[^0-9.,])([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+\.[0-9]{1,2}|[0-9]{1,7})(?![0-9.,])/g;
  for (const match of source.matchAll(barePattern)) {
    const token = match[1];
    const hasSeparator = token.includes(',') || token.includes('.');
    const value = Number(token.replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!hasSeparator && token.length > 7) continue;

    if (phContext) {
      push('PH', amountToUnits('PH', value), token);
    } else {
      push('PH', amountToUnits('PH', value), token);
      push('MY', amountToUnits('MY', value), token);
      if (Number.isInteger(value)) push('ID', amountToUnits('ID', value), token);
    }
  }

  return candidates;
}

function parseNotificationAmount(text) {
  return parseNotificationAmounts(text)[0] || null;
}


function isIncomingNotification(text) {
  const source = String(text || '').toLowerCase();
  if (!source.trim()) return false;
  const incoming = [
    'received',
    'you received',
    'money received',
    'sent you',
    'credited',
    'diterima',
    'masuk',
    'menerima',
    'tambah',
    'inflow',
    'cash in',
  ];
  const outgoing = [
    'you sent',
    'sent to',
    'transferred to',
    'payment to',
    'paid to',
    'dikirim',
    'terkirim',
    'mengirim',
    'keluar',
    'you paid',
    'withdraw',
  ];
  const hasIn = incoming.some((word) => source.includes(word));
  const hasOut = outgoing.some((word) => source.includes(word));
  return hasIn && !hasOut;
}

module.exports = {
  REGIONS,
  REGION_ORDER,
  normalizeRegion,
  parseAmountInput,
  amountToUnits,
  parseNotificationAmount,
  parseNotificationAmounts,
  isIncomingNotification,
  formatUnits,
  formatNumber,
};
