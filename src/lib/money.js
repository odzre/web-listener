const REGIONS = {
  MY: {
    code: 'MY',
    currency: 'MYR',
    symbol: 'RM',
    decimals: 2,
    offsetHours: 8,
    locale: 'ms-MY',
  },
  ID: {
    code: 'ID',
    currency: 'IDR',
    symbol: 'Rp',
    decimals: 0,
    offsetHours: 7,
    locale: 'id-ID',
  },
};

function normalizeRegion(value) {
  const region = String(value || '').trim().toUpperCase();
  return REGIONS[region] ? region : null;
}

function parseLocaleNumber(raw, region) {
  let text = String(raw).trim().replace(/\s+/g, '');
  if (!text) return NaN;

  if (region === 'MY') {
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
  if (region === 'MY') return Math.round(number * 100);
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
  return `Rp${amount.toLocaleString('id-ID')}`;
}

function formatNumber(region, units) {
  const amount = Number(units) || 0;
  if (region === 'MY') return (amount / 100).toFixed(2);
  return String(Math.round(amount));
}

function parseNotificationAmount(text) {
  const source = String(text || '');
  const myMatch = source.match(/\bRM\s*([0-9][0-9.,]*)/i);
  if (myMatch) {
    const value = parseLocaleNumber(myMatch[1], 'MY');
    if (Number.isFinite(value)) {
      return { region: 'MY', amount: amountToUnits('MY', value), raw: myMatch[0] };
    }
  }

  const idMatch = source.match(/(?:\bRp\.?|\bIDR)\s*([0-9][0-9.,]*)/i);
  if (idMatch) {
    const value = parseLocaleNumber(idMatch[1], 'ID');
    if (Number.isFinite(value)) {
      return { region: 'ID', amount: amountToUnits('ID', value), raw: idMatch[0] };
    }
  }

  return null;
}

module.exports = {
  REGIONS,
  normalizeRegion,
  parseAmountInput,
  amountToUnits,
  parseNotificationAmount,
  formatUnits,
  formatNumber,
};
