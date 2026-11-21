import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays, buildQuery, fillPeriods, initialRange, lastDayOfMonth,
  moscowDay, startOfPeriod, totals, validateRange
} from "../frontend/analytics.mjs";

test("период бронирования включает последний день, API получает полуоткрытый интервал по Москве", () => {
  const query = buildQuery("2027-02-28", "2027-03-01", "day");
  assert.equal(query.get("group_by"), "day");
  assert.equal(query.get("booked_from"), "2027-02-28T00:00:00+03:00");
  assert.equal(query.get("booked_to"), "2027-03-02T00:00:00+03:00");
  assert.equal(query.get("metrics"), "reservation_count,sold_tickets,revenue_rub");
  assert.match(query.toString(), /%2B03%3A00/);
});

test("неделя начинается с понедельника", () => {
  assert.equal(startOfPeriod("2027-03-07", "week"), "2027-03-01");
  assert.equal(startOfPeriod("2027-03-08", "week"), "2027-03-08");
  assert.equal(startOfPeriod("2027-01-01", "week"), "2026-12-28");
});

test("месяц начинается с первого числа, конец февраля учитывает високосный год", () => {
  assert.equal(startOfPeriod("2028-02-29", "month"), "2028-02-01");
  assert.equal(lastDayOfMonth("2028-02-01"), "2028-02-29");
  assert.equal(addDays("2027-12-31", 1), "2028-01-01");
});

test("пропущенные дни дополняются нулями, подтверждённые брони суммируются", () => {
  const rows = fillPeriods([
    {group_key: "2027-03-01", reservation_count: 2, sold_tickets: 3, revenue_rub: 900},
    {group_key: "2027-03-03", reservation_count: 1, sold_tickets: 2, revenue_rub: 1200}
  ], "2027-03-01", "2027-03-03", "day");
  assert.deepEqual(rows, [
    {date: "2027-03-01", reservations: 2, tickets: 3, revenue: 900},
    {date: "2027-03-02", reservations: 0, tickets: 0, revenue: 0},
    {date: "2027-03-03", reservations: 1, tickets: 2, revenue: 1200}
  ]);
  assert.deepEqual(totals(rows), {reservations: 3, tickets: 5, revenue: 2100});
});

test("недельная группировка включает частичные недели выбранного диапазона", () => {
  const rows = fillPeriods([
    {group_key: "2027-03-08", reservation_count: 4, sold_tickets: 4, revenue_rub: 400}
  ], "2027-03-03", "2027-03-16", "week");
  assert.deepEqual(rows.map(row => row.date), ["2027-03-01", "2027-03-08", "2027-03-15"]);
  assert.deepEqual(rows.map(row => row.reservations), [0, 4, 0]);
});

test("месячная группировка корректно заполняет отсутствующие месяцы", () => {
  const rows = fillPeriods([
    {group_key: "2027-01-01", reservation_count: 1, revenue_rub: 100},
    {group_key: "2027-03-01", reservation_count: 3, revenue_rub: 500}
  ], "2027-01-25", "2027-03-02", "month");
  assert.deepEqual(rows.map(row => row.date), ["2027-01-01", "2027-02-01", "2027-03-01"]);
  assert.deepEqual(rows.map(row => row.revenue), [100, 0, 500]);
});

test("демонстрационный период выбирается по последнему месяцу данных, а не текущей дате ПК", () => {
  assert.deepEqual(initialRange([
    {group_key: "2027-02-01"}, {group_key: "2027-03-01"}
  ], "2027-03-01T00:00:00+03:00"), {from: "2027-01-01", to: "2027-03-31"});
  assert.deepEqual(initialRange([], "2027-03-01T00:00:00+03:00"),
    {from: "2026-12-02", to: "2027-03-01"});
});

test("метаданные даты интерпретируются по часовому поясу Москвы", () => {
  assert.equal(moscowDay("2027-02-28T21:00:00Z"), "2027-03-01");
});

test("ошибочные диапазоны и тип группировки отклоняются", () => {
  assert.throws(() => validateRange("2027-02-30", "2027-03-10"), /корректную/);
  assert.throws(() => validateRange("2027-03-10", "2027-03-01"), /позже/);
  assert.throws(() => validateRange("2000-01-01", "2027-01-01"), /10 лет/);
  assert.throws(() => buildQuery("2027-01-01", "2027-01-02", "hour"), /группировки/);
  assert.throws(() => fillPeriods([{group_key: "2027-01-01", revenue_rub: -1}],
    "2027-01-01", "2027-01-02", "day"), /показатель/);
});
