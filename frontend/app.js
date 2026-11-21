import {
  addDays, buildQuery, fillPeriods, initialRange, parseDay, totals, validateRange
} from "./analytics.mjs";

const byId = id => document.getElementById(id);
const ui = {
  connection: byId("connection"), connectionText: byId("connectionText"),
  from: byId("dateFrom"), to: byId("dateTo"), form: byId("filtersForm"),
  formError: byId("formError"), apply: byId("applyButton"),
  refresh: byId("refreshButton"), retry: byId("retryButton"),
  reportPeriod: byId("reportPeriod"), updated: byId("lastUpdated"),
  bookings: byId("totalBookings"), revenue: byId("totalRevenue"),
  tickets: byId("totalTickets"), average: byId("averageCheck"),
  bookingsChart: byId("bookingsChart"), revenueChart: byId("revenueChart"),
  bookingsEmpty: byId("bookingsEmpty"), revenueEmpty: byId("revenueEmpty"),
  requestError: byId("requestError"), requestErrorMessage: byId("requestErrorMessage"),
  showEmpty: byId("showEmpty"), tbody: byId("detailsBody"),
  tableDescription: byId("tableDescription"), tableRowsInfo: byId("tableRowsInfo"),
  export: byId("exportButton")
};

const integer = new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 0});
const compact = new Intl.NumberFormat("ru-RU", {notation: "compact", maximumFractionDigits: 1});
const money = new Intl.NumberFormat("ru-RU", {style: "currency", currency: "RUB", maximumFractionDigits: 0});
const dayFormat = new Intl.DateTimeFormat("ru-RU", {timeZone: "UTC", day: "numeric", month: "short", year: "numeric"});
const monthFormat = new Intl.DateTimeFormat("ru-RU", {timeZone: "UTC", month: "long", year: "numeric"});
const shortFormat = new Intl.DateTimeFormat("ru-RU", {timeZone: "UTC", day: "2-digit", month: "2-digit"});
const state = {group: "day", from: "", to: "", rows: [], loaded: false, requestId: 0, controller: null};

function formatDay(value) { return dayFormat.format(parseDay(value)); }
function shortDay(value) { return shortFormat.format(parseDay(value)); }
function periodLabel(value) {
  if (state.group === "month") return monthFormat.format(parseDay(value));
  if (state.group === "week") return shortDay(value) + " — " + shortDay(addDays(value, 6));
  return formatDay(value);
}

function setConnection(label, status) {
  ui.connection.dataset.state = status;
  ui.connectionText.textContent = label;
}

function showError(message) {
  ui.requestError.hidden = false;
  ui.requestErrorMessage.textContent = message;
}
function clearError() { ui.requestError.hidden = true; }
function setBusy(busy) {
  ui.apply.disabled = busy;
  ui.refresh.disabled = busy;
  ui.apply.firstChild.textContent = busy ? "Загрузка… " : "Показать отчёт ";
}
function selectPreset(days) {
  document.querySelectorAll("[data-days]").forEach(button => {
    button.classList.toggle("selected", Number(button.dataset.days) === days);
  });
}
function selectGroup(group) {
  state.group = group;
  document.querySelectorAll("[data-group]").forEach(button => {
    const active = button.dataset.group === group;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function getJSON(path, signal) {
  const response = await fetch(path, {signal, headers: {"Accept": "application/json"}});
  let body;
  try { body = await response.json(); }
  catch { throw new Error("Сервер вернул ответ не в формате JSON."); }
  if (!response.ok) {
    const code = body?.error?.code || "HTTP_ERROR";
    if (response.status === 503) throw new Error("Сервер ещё не готов. Повторите запрос через несколько секунд.");
    throw new Error("Ошибка API: " + code + " (HTTP " + response.status + ").");
  }
  return body;
}

function renderSummary(rows) {
  const sums = totals(rows);
  ui.bookings.textContent = integer.format(sums.reservations);
  ui.revenue.textContent = money.format(sums.revenue);
  ui.tickets.textContent = integer.format(sums.tickets);
  ui.average.textContent = sums.reservations ? money.format(Math.round(sums.revenue / sums.reservations)) : "—";
  ui.reportPeriod.textContent = formatDay(state.from) + " — " + formatDay(state.to) +
    " · " + ({day: "по дням", week: "по неделям", month: "по месяцам"})[state.group];
  ui.updated.textContent = "Обновлено " + new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit", minute: "2-digit"
  }).format(new Date());
}

function svgNode(name, attrs = {}, text = null) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  if (text !== null) el.textContent = text;
  return el;
}

function niceMaximum(value, isCount) {
  if (isCount) return Math.max(4, Math.ceil(value / 4) * 4);
  const raw = value / 4;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const multiple = [1, 2, 5, 10].find(step => step * power >= raw) || 10;
  return multiple * power * 4;
}

function paintChart(svg, empty, rows, key, color, bars) {
  svg.replaceChildren();
  const maximum = Math.max(0, ...rows.map(row => row[key]));
  if (!rows.length || maximum === 0) {
    svg.hidden = true;
    empty.hidden = false;
    return;
  }
  svg.hidden = false;
  empty.hidden = true;

  // Система координат соответствует фактическому размеру области графика.
  // При фиксированном viewBox=900x275 браузер растягивал текст и оси.
  const width = Math.round(svg.parentElement.clientWidth) || 900;
  const height = Math.round(svg.parentElement.clientHeight) || 280;
  const left = width < 420 ? 53 : 63;
  const right = width < 420 ? 9 : 17;
  const top = 16, bottom = 47;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const baseY = top + plotHeight;
  const upper = niceMaximum(maximum, key === "reservations");
  const interval = plotWidth / rows.length;
  const x = i => left + (i + .5) * interval;
  const y = amount => baseY - (amount / upper) * plotHeight;
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  for (let i = 0; i <= 4; i++) {
    const value = upper * i / 4, yy = y(value);
    svg.append(svgNode("line", {
      x1: left, y1: yy, x2: width - right, y2: yy, stroke: "#e9eef6", "stroke-width": 1
    }));
    svg.append(svgNode("text", {x: left - 14, y: yy + 4, "text-anchor": "end"},
      key === "reservations" ? integer.format(value) : compact.format(value)));
  }

  if (bars) {
    const barWidth = Math.max(1, Math.min(32, interval * .7));
    rows.forEach((row, i) => {
      if (row[key] === 0) return;
      svg.append(svgNode("rect", {
        x: x(i) - barWidth / 2, y: y(row[key]), width: barWidth,
        height: Math.max(1, baseY - y(row[key])), rx: Math.min(3, barWidth / 3), fill: color
      }));
    });
  } else {
    const path = rows.map((row, i) => (i === 0 ? "M" : "L") + x(i).toFixed(2) +
      " " + y(row[key]).toFixed(2)).join(" ");
    const area = "M" + x(0).toFixed(2) + " " + baseY + " " +
      path.replace(/^M/, "L") + " L" + x(rows.length - 1).toFixed(2) + " " + baseY + " Z";
    svg.append(svgNode("path", {d: area, fill: color, opacity: ".10"}));
    svg.append(svgNode("path", {d: path, fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round"}));
    if (rows.length <= 45) {
      rows.forEach((row, i) => svg.append(svgNode("circle", {
        cx: x(i), cy: y(row[key]), r: 3.5, fill: color, stroke: "#fff", "stroke-width": 1.4
      })));
    }
  }

  // Не размещаем шесть подписей вплотную на мобильных экранах.
  const labels = Math.min(6, rows.length, Math.max(1, Math.floor(plotWidth / 95)));
  const shown = new Set();
  for (let i = 0; i < labels; i++) {
    const index = labels === 1 ? 0 : Math.round(i * (rows.length - 1) / (labels - 1));
    if (shown.has(index)) continue;
    shown.add(index);
    const value = state.group === "month" ? rows[index].date.slice(0, 7) : shortDay(rows[index].date);
    svg.append(svgNode("text", {x: x(index), y: height - 16, "text-anchor": "middle"}, value));
  }

  // Каждому периоду соответствует область для стандартной подсказки SVG.
  rows.forEach((row, i) => {
    const hit = svgNode("rect", {
      x: left + i * interval, y: top, width: interval, height: plotHeight,
      fill: "transparent", style: "cursor:crosshair"
    });
    hit.append(svgNode("title", {}, periodLabel(row.date) + "\n" +
      (key === "reservations" ? "Бронирования: " + integer.format(row[key]) : "Выручка: " + money.format(row[key]))));
    svg.append(hit);
  });
}

function renderCharts(rows) {
  paintChart(ui.bookingsChart, ui.bookingsEmpty, rows, "reservations", "#315ce8", false);
  paintChart(ui.revenueChart, ui.revenueEmpty, rows, "revenue", "#0b9d91", true);
}

// Перерисовываем SVG при изменении ширины карточки, а не растягиваем
// готовый график вместе с текстом осей.
if (typeof ResizeObserver !== "undefined") {
  const resizeObserver = new ResizeObserver(() => {
    if (state.loaded) renderCharts(state.rows);
  });
  document.querySelectorAll(".chart-body").forEach(body => resizeObserver.observe(body));
} else {
  window.addEventListener("resize", () => {
    if (state.loaded) renderCharts(state.rows);
  });
}

function shownRows() {
  return state.rows.filter(row => ui.showEmpty.checked || row.reservations > 0 || row.tickets > 0 || row.revenue > 0).reverse();
}

function renderTable() {
  ui.tbody.replaceChildren();
  const rows = shownRows();
  const fragment = document.createDocumentFragment();
  rows.forEach(row => {
    const tr = document.createElement("tr");
    const avg = row.reservations ? money.format(Math.round(row.revenue / row.reservations)) : "—";
    [periodLabel(row.date), integer.format(row.reservations), integer.format(row.tickets), money.format(row.revenue), avg]
      .forEach((text, index) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (index > 0) td.className = "numeric";
        tr.append(td);
      });
    fragment.append(tr);
  });
  if (!rows.length) {
    const tr = document.createElement("tr"), td = document.createElement("td");
    td.colSpan = 5;
    td.className = "table-message";
    td.textContent = state.loaded ? "В выбранном периоде нет подтверждённых бронирований." : "Нет данных для отображения.";
    tr.append(td);
    fragment.append(tr);
  }
  ui.tbody.append(fragment);
  ui.tableRowsInfo.textContent = "Показано периодов: " + rows.length + " из " + state.rows.length;
  ui.tableDescription.textContent = "Сначала новые · " + ({day: "дни", week: "недели", month: "месяцы"})[state.group];
}

function render() {
  renderSummary(state.rows);
  renderCharts(state.rows);
  renderTable();
  ui.export.disabled = !state.loaded;
}

async function load() {
  let query;
  try {
    query = buildQuery(ui.from.value, ui.to.value, state.group);
  } catch (error) {
    ui.formError.textContent = error.message;
    ui.formError.hidden = false;
    return;
  }
  ui.formError.hidden = true;
  state.from = ui.from.value;
  state.to = ui.to.value;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const requestId = ++state.requestId;
  setBusy(true);
  clearError();
  setConnection("Загрузка данных", "loading");
  try {
    const payload = await getJSON("/api/v1/analytics/reservations?" + query.toString(), controller.signal);
    if (requestId !== state.requestId) return;
    state.rows = fillPeriods(payload.data, state.from, state.to, state.group);
    state.loaded = true;
    render();
    setConnection("API доступен", "ok");
  } catch (error) {
    if (controller.signal.aborted || requestId !== state.requestId) return;
    state.rows = [];
    state.loaded = false;
    ui.reportPeriod.textContent = "Не удалось получить показатели";
    ui.updated.textContent = "";
    ui.bookings.textContent = "—";
    ui.revenue.textContent = "—";
    ui.tickets.textContent = "—";
    ui.average.textContent = "—";
    renderCharts([]);
    renderTable();
    ui.export.disabled = true;
    setConnection("Ошибка соединения", "error");
    showError(error.message || "Неизвестная ошибка");
  } finally {
    if (requestId === state.requestId) setBusy(false);
  }
}

async function initialize() {
  clearError();
  setBusy(true);
  setConnection("Подключение к API", "loading");
  try {
    const [meta, overview] = await Promise.all([
      getJSON("/api/v1/meta"), getJSON("/api/v1/analytics/reservations?group_by=month&metrics=reservation_count")
    ]);
    const range = initialRange(overview.data, meta.reference_time);
    ui.from.value = range.from;
    ui.to.value = range.to;
    selectPreset(90);
    await load();
  } catch (error) {
    setConnection("Ошибка соединения", "error");
    showError(error.message || "Не удалось инициализировать отчёт.");
  } finally {
    setBusy(false);
  }
}

function csvCell(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function downloadCsv() {
  if (!state.loaded) return;
  const records = [
    ["Период", "Подтверждённые бронирования", "Билеты", "Выручка (руб.)", "Средний чек (руб.)"],
    ...shownRows().map(row => [
      periodLabel(row.date), row.reservations, row.tickets, row.revenue,
      row.reservations ? Math.round(row.revenue / row.reservations) : ""
    ])
  ];
  const csv = "\uFEFF" + records.map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
  const objectUrl = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "reservations-" + state.group + "-" + state.from + "-" + state.to + ".csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

ui.form.addEventListener("submit", event => { event.preventDefault(); void load(); });
ui.refresh.addEventListener("click", () => {
  if (ui.from.value && ui.to.value) void load();
  else void initialize();
});
ui.retry.addEventListener("click", () => {
  if (ui.from.value && ui.to.value) void load();
  else void initialize();
});
ui.showEmpty.addEventListener("change", renderTable);
ui.export.addEventListener("click", downloadCsv);
document.querySelectorAll("[data-group]").forEach(button => {
  button.addEventListener("click", () => {
    if (state.group === button.dataset.group) return;
    selectGroup(button.dataset.group);
    if (ui.from.value && ui.to.value) void load();
  });
});
document.querySelectorAll("[data-days]").forEach(button => {
  button.addEventListener("click", () => {
    const days = Number(button.dataset.days);
    if (!ui.to.value) return;
    ui.from.value = addDays(ui.to.value, 1 - days);
    selectPreset(days);
    void load();
  });
});
for (const field of [ui.from, ui.to]) {
  field.addEventListener("input", () => selectPreset(null));
}
void initialize();
