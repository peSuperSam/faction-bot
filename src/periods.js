const TIME_ZONE = 'America/Sao_Paulo';

function saoPauloYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isoWeekFromYmd(ymd) {
  const [year, month, day] = ymd.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  const weekday = date.getUTCDay() || 7;
  const thursday = new Date(utc);
  thursday.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = thursday.getUTCFullYear();
  const jan4 = Date.UTC(weekYear, 0, 4);
  const jan4Date = new Date(jan4);
  const jan4Weekday = jan4Date.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4Date.getUTCDate() - (jan4Weekday - 1));
  const week =
    Math.floor((mondayUtc(date) - week1Monday.getTime()) / (7 * 86400000)) + 1;
  const monday = new Date(utc);
  monday.setUTCDate(date.getUTCDate() - (weekday - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    key: `${weekYear}-W${String(week).padStart(2, '0')}`,
    weekYear,
    week,
    startsAt: monday.toISOString().slice(0, 10),
    endsAt: sunday.toISOString().slice(0, 10),
    label: `Semana ${week}/${weekYear}`,
  };
}

function mondayUtc(date) {
  const weekday = date.getUTCDay() || 7;
  const monday = new Date(date.getTime());
  monday.setUTCDate(date.getUTCDate() - (weekday - 1));
  return monday.getTime();
}

function currentWeekInfo(date = new Date()) {
  return isoWeekFromYmd(saoPauloYmd(date));
}

module.exports = {
  TIME_ZONE,
  currentWeekInfo,
};
