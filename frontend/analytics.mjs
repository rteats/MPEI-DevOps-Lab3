// Чистые функции аналитики: время группируется по московским календарным датам.
export const TIMEZONE = "Europe/Moscow";
export const GROUPS = ["day", "week", "month"];
const DAY_MS = 86_400_000;

export function parseDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Укажите корректную дату.");
  }
  const result = new Date(value + "T00:00:00.000Z");
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) {
    throw new Error("Укажите корректную дату.");
  }
  return result;
}

export function dayString(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(value, count) {
  const date = parseDay(value);
  date.setUTCDate(date.getUTCDate() + count);
  return dayString(date);
}

export function moscowDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Некорректное время в метаданных API.");
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const get = name => parts.find(part => part.type === name)?.value;
  return get("year") + "-" + get("month") + "-" + get("day");
}

export function lastDayOfMonth(monthStart) {
  const date = parseDay(monthStart);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(date.getUTCDate() - 1);
  return dayString(date);
}

export function startOfPeriod(value, group) {
  const date = parseDay(value);
  if (group === "day") return dayString(date);
  if (group === "week") {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return dayString(date);
  }
  if (group === "month") {
    date.setUTCDate(1);
    return dayString(date);
  }
  throw new Error("Неизвестный тип группировки.");
}

export function nextPeriod(value, group) {
  if (group === "day") return addDays(value, 1);
  if (group === "week") return addDays(value, 7);
  if (group === "month") {
    const date = parseDay(value);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    return dayString(date);
  }
  throw new Error("Неизвестный тип группировки.");
}

export function validateRange(from, to) {
  const start = parseDay(from).getTime();
  const end = parseDay(to).getTime();
  if (start > end) throw new Error("Дата начала не может быть позже даты окончания.");
  const length = Math.round((end - start) / DAY_MS) + 1;
  if (length > 3660) throw new Error("Выберите период не более 10 лет.");
  return length;
}

export function buildQuery(from, to, group) {
  validateRange(from, to);
  if (!GROUPS.includes(group)) throw new Error("Неизвестный тип группировки.");
  return new URLSearchParams({
    group_by: group,
    booked_from: from + "T00:00:00+03:00",
    booked_to: addDays(to, 1) + "T00:00:00+03:00",
    metrics: "reservation_count,sold_tickets,revenue_rub"
  });
}

function count(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("API вернул некорректный показатель.");
  }
  return number;
}

export function fillPeriods(rows, from, to, group) {
  validateRange(from, to);
  if (!GROUPS.includes(group)) throw new Error("Неизвестный тип группировки.");
  if (!Array.isArray(rows)) throw new Error("API вернул некорректный ответ.");
  const byPeriod = new Map(rows.map(row => [row.group_key, row]));
  const output = [];
  let key = startOfPeriod(from, group);
  // Периоды без строк в ответе API заполняются нулями для непрерывного графика.
  while (key <= to) {
    const row = byPeriod.get(key);
    output.push({
      date: key,
      reservations: count(row?.reservation_count),
      tickets: count(row?.sold_tickets),
      revenue: count(row?.revenue_rub)
    });
    key = nextPeriod(key, group);
  }
  return output;
}

export function totals(rows) {
  return rows.reduce((result, row) => ({
    reservations: result.reservations + row.reservations,
    tickets: result.tickets + row.tickets,
    revenue: result.revenue + row.revenue
  }), {reservations: 0, tickets: 0, revenue: 0});
}

export function initialRange(months, referenceTime) {
  if (!Array.isArray(months)) throw new Error("API вернул некорректный ответ.");
  const keys = months.map(item => item.group_key)
    .filter(key => typeof key === "string" && /^\d{4}-\d{2}-01$/.test(key))
    .sort();
  const to = keys.length ? lastDayOfMonth(keys[keys.length - 1]) : moscowDay(referenceTime);
  return {from: addDays(to, -89), to};
}
