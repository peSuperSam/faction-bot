function normalizeMaterial(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function displayMaterial(value) {
  return String(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatQuantity(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
}

function formatPercent(current, target) {
  if (!target) {
    return '—';
  }
  return `${Math.min(999, Math.round((Number(current) / Number(target)) * 100))}%`;
}

function truncate(text, max = 1000) {
  const value = String(text || '');
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function sanitizeNickname(value) {
  const nick = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!nick || nick.length > 32) {
    return null;
  }
  if (/@everyone|@here|discord\.gg/i.test(nick)) {
    return null;
  }
  return nick;
}

function parsePositiveInt(value) {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000_000) {
    return null;
  }
  return parsed;
}

module.exports = {
  normalizeMaterial,
  displayMaterial,
  formatQuantity,
  formatPercent,
  truncate,
  parsePositiveInt,
  sanitizeNickname,
};
