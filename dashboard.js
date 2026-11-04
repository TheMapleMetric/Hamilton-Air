/* Hamilton air quality dashboard.
 * Reads data/readings.csv (date, station_id, pollutant, h00..h23) and draws
 * everything as plain SVG/HTML: no libraries, no build step.
 * The first half of this file is pure logic (tested in Node); the second half
 * is the browser UI.
 */
(function (root) {
  'use strict';

  /* ---------- configuration ---------- */

  // guideline = Ontario 1-hour ambient air quality criterion, as listed by Air Quality Ontario.
  // Only guidelines that were confirmed are set; everything else is shown without one.
  const AQO_STATIONS = [
    { id: '29000', name: 'Hamilton Downtown', color: 'var(--s1)', lat: 43.21778, lon: -79.781664 },
    { id: '29214', name: 'Hamilton Mountain', color: 'var(--s2)', lat: 43.161324, lon: -79.889328 },
    { id: '29118', name: 'Hamilton West', color: 'var(--s3)', lat: 43.257444, lon: -79.90775 },
  ];
  const AQO_POLLUTANTS = [
    { id: 'O3', name: 'Ground-level ozone', label: 'O₃', unit: 'ppb', guideline: 80 },
    { id: 'PM25', name: 'Fine particulate matter', label: 'PM2.5', unit: 'µg/m³', guideline: null },
    { id: 'NO2', name: 'Nitrogen dioxide', label: 'NO₂', unit: 'ppb', guideline: 200 },
    { id: 'SO2', name: 'Sulphur dioxide', label: 'SO₂', unit: 'ppb', guideline: 40 },
    { id: 'CO', name: 'Carbon monoxide', label: 'CO', unit: 'ppm', guideline: 30 },
  ];

  // HAMN station names are the identifiers the portal publishes; positions come from the portal's own station list.
  const HAMN_STATIONS = [
    ['COH_MBL1', 43.159969, -79.911099, 'Mobile station: the position shown is where the portal currently places it'],
    ['STN29102 Beach Blvd', 43.275479, -79.779834], ['STN29153 Parkdale Ave N', 43.25472, -79.783535],
    ['STN29164', 43.2676, -79.777137], ['STN29167 Arcelormittal', 43.279131, -79.798799],
    ['STN29168 Christophers Park', 43.25507, -79.808216], ['STN29171 Stelco', 43.279737, -79.821563],
    ['STN29175 Jones Road', 43.221818, -79.689814], ['STN29180 Gage Ave N', 43.260007, -79.823274],
    ['STN29247 GFL Facility', 43.200016, -79.770459], ['STN29565 Strathearne Ave', 43.249843, -79.794866],
    ['STN29667', 43.269898, -79.841731],
    ['GFL Lagoon', 43.200083, -79.78156], ['GFL North', 43.200016, -79.7711],
    ['GFL SouthEast', 43.19325, -79.768618], ['GFL_NW', 43.200867, -79.775657],
    ['RC East', 43.262718, -79.790017], ['RC North', 43.264074, -79.790143],
    ['RC South', 43.261663, -79.791591], ['RC West', 43.26344, -79.791917],
  ].map(([n, lat, lon, note]) => ({ id: n, name: n, lat, lon, note }));
  const AIR = 'Air quality';
  const WEATHER = 'Weather';
  const HAMN_POLLUTANTS = [
    { id: 'SO2', name: 'Sulphur dioxide', label: 'SO₂', unit: 'ppb', guideline: 40, group: AIR },
    { id: 'TRS', name: 'Total reduced sulphur', label: 'TRS', unit: 'ppb', guideline: null, group: AIR },
    { id: 'CO', name: 'Carbon monoxide', label: 'CO', unit: 'ppm', guideline: 30, group: AIR },
    { id: 'NO', name: 'Nitric oxide', label: 'NO', unit: 'ppb', guideline: null, group: AIR },
    { id: 'NO2', name: 'Nitrogen dioxide', label: 'NO₂', unit: 'ppb', guideline: 200, group: AIR },
    { id: 'NOX', name: 'Oxides of nitrogen', label: 'NOₓ', unit: 'ppb', guideline: null, group: AIR },
    { id: 'O3', name: 'Ground-level ozone', label: 'O₃', unit: 'ppb', guideline: 80, group: AIR },
    { id: 'Benzene', name: 'Benzene', label: 'Benzene', unit: 'µg/m³', guideline: null, group: AIR },
    { id: 'PM25', name: 'Fine particulate matter', label: 'PM2.5', unit: 'µg/m³', guideline: null, group: AIR },
    { id: 'PM10', name: 'Inhalable particulates', label: 'PM10', unit: 'µg/m³', guideline: null, group: AIR },
    { id: 'AT', name: 'Temperature', label: 'Temp', unit: '°C', guideline: null, group: WEATHER },
    { id: 'RH', name: 'Relative humidity', label: 'RH', unit: '%', guideline: null, group: WEATHER },
    { id: 'BP', name: 'Barometric pressure', label: 'BP', unit: 'mb', guideline: null, group: WEATHER },
    { id: 'WS', name: 'Wind speed', label: 'WS', unit: 'km/h', guideline: null, group: WEATHER },
    { id: 'WSMx', name: 'Wind speed, hourly maximum', label: 'WSMx', unit: 'km/h', guideline: null, group: WEATHER },
    // listed in the latest-readings table only: a daily mean of a direction or a rainfall total would mislead
    { id: 'Rain', name: 'Rainfall', label: 'Rain', unit: 'mm', guideline: null, group: WEATHER, chart: false },
    { id: 'WD', name: 'Wind direction', label: 'WD', unit: '°', guideline: null, group: WEATHER, chart: false },
  ];

  const SOURCES = [
    {
      id: 'ministry', label: 'Ministry stations', file: 'data/readings.csv',
      stations: AQO_STATIONS, pollutants: AQO_POLLUTANTS.map((p) => Object.assign({ group: AIR }, p)),
      maxActive: Infinity, defaultActive: AQO_STATIONS.map((s) => s.id),
      lede: "Hourly pollutant readings from the Ontario Ministry's Hamilton monitoring stations.",
      source: 'Air Quality Ontario', sourceUrl: 'https://airqualityontario.com/history/summary.php',
      sourceText: ' (Ontario Ministry of the Environment, Conservation and Parks). Readings are collected automatically and have not gone through final verification, so values can change later; this page refreshes older days each time it updates.',
      guideText: 'Guidelines are the Ontario 1-hour ambient air quality criteria listed by Air Quality Ontario: ozone 80 ppb, nitrogen dioxide 200 ppb, sulphur dioxide 40 ppb, carbon monoxide 30 ppm. Fine particles are shown without a 1-hour guideline. Times are Eastern local time as published. Daily averages and peaks only include days with at least 18 hourly readings.',
    },
    {
      id: 'hamn', label: 'HAMN stations', file: 'data/hamn.csv',
      stations: HAMN_STATIONS, pollutants: HAMN_POLLUTANTS,
      maxActive: 3, defaultActive: ['STN29667', 'STN29102 Beach Blvd', 'COH_MBL1'],
      lede: 'Hourly readings from the Hamilton Air Monitoring Network (HAMN): industry and City of Hamilton stations, with weather.',
      source: 'HAMN reporting portal', sourceUrl: 'https://newreporting.hamnair.ca',
      sourceText: ' (Hamilton Air Monitoring Network). Readings are collected automatically from the public portal and are not final: they can be corrected later and may include instrument faults or unusual values, so check anything surprising against the portal. This page refreshes recent days each time it updates.',
      guideText: 'Guidelines are drawn only for pollutants where the Ontario 1-hour criterion is confirmed (ozone 80 ppb, nitrogen dioxide 200 ppb, sulphur dioxide 40 ppb, carbon monoxide 30 ppm); other pollutants are shown without one. HAMN labels each reading with the hour it ends, so a value shown here at 1 PM covers 12 to 1 PM, which can differ by one hour from the Ministry page. Times are Eastern local time. Daily averages and peaks only include days with at least 18 hourly readings. Charts show up to three stations at a time; the tables cover every station.',
    },
  ];
  const STATIONS = AQO_STATIONS;
  const POLLUTANTS = AQO_POLLUTANTS;

  const HOUR = 3600e3;
  const DAY = 864e5;
  const MIN_VALID_HOURS = 18; // a day needs this many readings to be averaged
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- pure logic ---------- */

  // Times are Eastern wall-clock as published; stored as UTC-naive milliseconds.
  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      if (c.length < 27) continue;
      const [y, m, d] = c[0].split('-').map(Number);
      if (!y || !m || !d) continue;
      const vals = c.slice(3, 27).map((s) => (s === '' || isNaN(Number(s)) ? null : Number(s)));
      rows.push({ day: Date.UTC(y, m - 1, d), station: c[1], pol: c[2], vals });
    }
    return rows;
  }

  // Map "station|pollutant" -> sorted [{t, v}] (readings only, blanks dropped)
  function buildSeries(rows) {
    const map = new Map();
    for (const r of rows) {
      const key = r.station + '|' + r.pol;
      if (!map.has(key)) map.set(key, []);
      const arr = map.get(key);
      r.vals.forEach((v, h) => {
        if (v !== null) arr.push({ t: r.day + h * HOUR, v });
      });
    }
    for (const arr of map.values()) arr.sort((a, b) => a.t - b.t);
    return map;
  }

  function inRange(points, t0, t1) {
    return points.filter((p) => p.t >= t0 && p.t <= t1);
  }

  // mode: 'mean' | 'max'. Days with too few readings are left out.
  function aggregateDaily(points, mode) {
    const byDay = new Map();
    for (const p of points) {
      const d = Math.floor(p.t / DAY) * DAY;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(p.v);
    }
    const out = [];
    for (const [t, vs] of [...byDay].sort((a, b) => a[0] - b[0])) {
      if (vs.length < MIN_VALID_HOURS) continue;
      const v = mode === 'max' ? Math.max(...vs) : vs.reduce((a, b) => a + b, 0) / vs.length;
      out.push({ t, v });
    }
    return out;
  }

  // Mean by hour of day -> 24 entries {x, y|null}
  function hourOfDay(points) {
    const sums = Array.from({ length: 24 }, () => ({ s: 0, n: 0 }));
    for (const p of points) {
      const h = new Date(p.t).getUTCHours();
      sums[h].s += p.v;
      sums[h].n += 1;
    }
    return sums.map((a, h) => ({ x: h, y: a.n ? a.s / a.n : null }));
  }

  function percentile(sorted, p) {
    if (!sorted.length) return null;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function stats(points, guideline, slots) {
    if (!points.length) return null;
    const vs = points.map((p) => p.v).sort((a, b) => a - b);
    let max = -Infinity;
    let maxT = null;
    for (const p of points) if (p.v > max) { max = p.v; maxT = p.t; }
    return {
      n: points.length,
      mean: vs.reduce((a, b) => a + b, 0) / vs.length,
      median: percentile(vs, 0.5),
      p95: percentile(vs, 0.95),
      max,
      maxT,
      above: guideline == null ? null : points.filter((p) => p.v > guideline).length,
      coverage: slots ? Math.min(1, points.length / slots) : null,
    };
  }

  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return n * p;
  }

  function fmtNum(v, polId) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (polId === 'CO') return v.toFixed(2);
    return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  }

  const pad = (n) => String(n).padStart(2, '0');
  function hour12(h) { return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' AM' : ' PM'); }
  function fmtDate(t) { const d = new Date(t); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function fmtDateYear(t) { return fmtDate(t) + ', ' + new Date(t).getUTCFullYear(); }
  function fmtDateHour(t) { return fmtDate(t) + ', ' + hour12(new Date(t).getUTCHours()); }

  const logic = {
    SOURCES, STATIONS, POLLUTANTS, parseCsv, buildSeries, inRange, aggregateDaily, hourOfDay,
    percentile, stats, niceStep, fmtNum, fmtDate, fmtDateHour, fmtDateYear,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;
  root.HamAir = logic;
  if (typeof document === 'undefined') return;

  /* ---------- browser UI ---------- */

  const NS = 'http://www.w3.org/2000/svg';
  const RANGES = [
    { label: 'Last 7 days', days: 7 },
    { label: '30 days', days: 30 },
    { label: '90 days', days: 90 },
    { label: '1 year', days: 365 },
    { label: 'All', days: Infinity },
  ];
  const RESOLUTIONS = [
    { value: 'auto', label: 'Auto' },
    { value: 'hour', label: 'Hourly readings' },
    { value: 'mean', label: 'Daily average' },
    { value: 'max', label: 'Daily peak' },
  ];

  const state = {
    src: SOURCES[0], loaded: new Map(), series: new Map(), tMin: 0, tMax: 0,
    rangeDays: 7, res: 'auto',
    active: new Set(), slots: new Map(), // slots: station id -> colour token (HAMN picks)
    tableView: new Set(), profilePol: 'NO2', showAll: false,
  };
  const SLOT_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
  const stations = () => state.src.stations;
  const pollutants = () => state.src.pollutants;
  const activeStations = () => stations().filter((st) => state.active.has(st.id));
  const chartable = () => pollutants().filter((p) => p.chart !== false);
  function stationColor(st) { return st.color || state.slots.get(st.id) || 'var(--s1)'; }
  function resetSelection() {
    state.active = new Set(state.src.defaultActive);
    state.slots = new Map();
    if (state.src.maxActive !== Infinity) [...state.active].forEach((id, i) => state.slots.set(id, SLOT_COLORS[i]));
  }
  function compass(deg) {
    return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16];
  }

  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k);
    return e;
  }
  function svg(tag, attrs, style) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (style) Object.assign(e.style, style);
    return e;
  }

  const polById = (id) => pollutants().find((p) => p.id === id);

  function currentWindow() {
    const t1 = state.tMax;
    const t0 = isFinite(state.rangeDays) ? t1 - state.rangeDays * DAY + HOUR : state.tMin;
    return [Math.max(t0, state.tMin), t1];
  }
  function resolution() {
    if (state.res !== 'auto') return state.res;
    const [t0, t1] = currentWindow();
    return (t1 - t0) / DAY <= 14 ? 'hour' : 'mean';
  }
  function rangeLabel() {
    const [t0, t1] = currentWindow();
    return fmtDateYear(t0) + ' – ' + fmtDateYear(t1);
  }

  /* ----- line chart ----- */

  function timeTicks(xMin, xMax, maxTicks) {
    const steps = [1, 3, 6, 12].map((h) => h * HOUR).concat([1, 2, 7, 14, 30, 91, 182].map((d) => d * DAY));
    const step = steps.find((s) => (xMax - xMin) / s <= maxTicks) || steps[steps.length - 1];
    const ticks = [];
    for (let t = Math.ceil(xMin / step) * step; t <= xMax; t += step) ticks.push(t);
    const label = (t) => {
      const d = new Date(t);
      if (step >= 30 * DAY) return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
      if (step >= DAY) return fmtDate(t);
      return fmtDate(t) + ' ' + hour12(d.getUTCHours());
    };
    return { ticks, label };
  }

  // o: { series:[{key,name,color,pts:[{x,y}]}], kind:'time'|'hour', stepMs, unit, pol, guideline, fmtX, ariaLabel }
  function renderLine(host, o) {
    host.textContent = '';
    host.classList.add('chart-host');
    const pts = o.series.flatMap((s) => s.pts.filter((p) => p.y !== null));
    if (!pts.length) { host.append(el('p', { class: 'empty' }, 'No readings in this range.')); return; }

    const W = Math.max(280, host.clientWidth || 600);
    const H = 240;
    const m = { l: 48, r: 16, t: 12, b: 30 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;

    let xMin = Math.min(...pts.map((p) => p.x));
    let xMax = Math.max(...pts.map((p) => p.x));
    if (o.kind === 'hour') { xMin = 0; xMax = 23; }
    if (xMin === xMax) { xMin -= o.stepMs || 1; xMax += o.stepMs || 1; }

    const dataMax = Math.max(...pts.map((p) => p.y));
    const dataMin = Math.min(...pts.map((p) => p.y));
    let top = dataMax;
    const showGuide = o.guideline != null && dataMax >= 0.5 * o.guideline;
    if (showGuide) top = Math.max(top, o.guideline * 1.05);
    const step = niceStep((top - Math.min(0, dataMin)) / 4);
    const yMax = Math.ceil(top / step - 1e-9) * step || step;
    const yMin = dataMin < 0 ? Math.floor(dataMin / step) * step : 0;

    const px = (x) => m.l + ((x - xMin) / (xMax - xMin)) * pw;
    const py = (y) => m.t + (1 - (y - yMin) / (yMax - yMin)) * ph;

    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: '0', 'aria-label': o.ariaLabel });
    s.classList.add('chart');

    // y grid + labels
    const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    for (let v = yMin; v <= yMax + step / 1000; v += step) {
      const y = py(v);
      s.append(svg('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: v === 0 ? 'axis' : 'grid' }));
      const t = svg('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', class: 'tick' });
      t.textContent = v.toFixed(dec);
      s.append(t);
    }
    // x labels
    let xTicks, xLabel;
    const maxTicks = Math.max(2, Math.floor(pw / 84));
    if (o.kind === 'hour') {
      xTicks = [0, 3, 6, 9, 12, 15, 18, 21].filter((h) => pw > 380 || h % 6 === 0);
      xLabel = (h) => pad(h) + ':00';
    } else {
      const tt = timeTicks(xMin, xMax, maxTicks);
      xTicks = tt.ticks;
      xLabel = tt.label;
    }
    for (const x of xTicks) {
      const t = svg('text', { x: px(x), y: H - 8, 'text-anchor': 'middle', class: 'tick' });
      t.textContent = xLabel(x);
      s.append(t);
    }

    // guideline
    if (showGuide) {
      const y = py(o.guideline);
      s.append(svg('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: 'guide' }));
      const t = svg('text', { x: m.l + 6, y: y - 5, class: 'guide-label' });
      t.textContent = 'Ontario 1-hour guideline: ' + o.guideline + ' ' + o.unit;
      s.append(t);
    }

    // lines (break on gaps) + end dots
    const gap = (o.stepMs || 1) * 1.6;
    for (const ser of o.series) {
      const good = ser.pts.filter((p) => p.y !== null);
      let d = '';
      let prev = null;
      for (const p of good) {
        d += (prev === null || p.x - prev > gap ? 'M' : 'L') + px(p.x).toFixed(1) + ' ' + py(p.y).toFixed(1);
        prev = p.x;
      }
      s.append(svg('path', { d, class: 'line' }, { stroke: ser.color }));
    }
    for (const ser of o.series) {
      const last = ser.pts.filter((p) => p.y !== null).pop();
      if (last) s.append(svg('circle', { cx: px(last.x), cy: py(last.y), r: 4, class: 'dot' }, { fill: ser.color }));
    }

    // hover layer
    const xs = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b);
    const lookup = o.series.map((ser) => new Map(ser.pts.map((p) => [p.x, p.y])));
    const cross = svg('line', { y1: m.t, y2: m.t + ph, class: 'cross' }, { display: 'none' });
    const focusDots = o.series.map((ser) => svg('circle', { r: 4, class: 'dot' }, { fill: ser.color, display: 'none' }));
    const overlay = svg('rect', { x: m.l, y: m.t, width: pw, height: ph, class: 'overlay' });
    s.append(cross, ...focusDots, overlay);

    const tip = el('div', { class: 'tooltip', role: 'status' });
    tip.hidden = true;
    host.append(s, tip);

    let idx = xs.length - 1;
    function show(i) {
      idx = Math.max(0, Math.min(xs.length - 1, i));
      const x = xs[idx];
      cross.setAttribute('x1', px(x)); cross.setAttribute('x2', px(x)); cross.style.display = '';
      tip.textContent = '';
      tip.append(el('div', { class: 'tip-head' }, o.fmtX(x)));
      o.series.forEach((ser, k) => {
        const y = lookup[k].get(x);
        if (y === undefined || y === null) { focusDots[k].style.display = 'none'; }
        else {
          focusDots[k].setAttribute('cx', px(x)); focusDots[k].setAttribute('cy', py(y)); focusDots[k].style.display = '';
        }
        const key = el('span', { class: 'key' }); key.style.background = ser.color;
        tip.append(el('div', { class: 'tip-row' }, key,
          el('strong', {}, fmtNum(y === undefined ? null : y, o.pol) + (y == null ? '' : ' ' + o.unit)),
          el('span', { class: 'tip-name' }, ser.name)));
      });
      tip.hidden = false;
      const w = tip.offsetWidth;
      let left = px(x) + 14;
      if (left + w > W - 4) left = px(x) - w - 14;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = m.t + 4 + 'px';
    }
    function hide() {
      cross.style.display = 'none'; focusDots.forEach((d) => (d.style.display = 'none')); tip.hidden = true;
    }
    function nearest(clientX) {
      const r = s.getBoundingClientRect();
      const x = xMin + ((clientX - r.left) * (W / r.width) - m.l) / pw * (xMax - xMin);
      let lo = 0, hi = xs.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < x) lo = mid + 1; else hi = mid; }
      if (lo > 0 && Math.abs(xs[lo - 1] - x) <= Math.abs(xs[lo] - x)) lo--;
      return lo;
    }
    overlay.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
    overlay.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
    overlay.addEventListener('pointerleave', hide);
    s.addEventListener('blur', hide);
    s.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { show(idx - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { show(idx + 1); e.preventDefault(); }
      else if (e.key === 'Home') { show(0); e.preventDefault(); }
      else if (e.key === 'End') { show(xs.length - 1); e.preventDefault(); }
      else if (e.key === 'Escape') hide();
    });
  }

  // Table twin of a chart: same numbers, newest first, capped for size
  function renderTable(host, o) {
    host.textContent = '';
    const xs = [...new Set(o.series.flatMap((s) => s.pts.filter((p) => p.y !== null).map((p) => p.x)))].sort((a, b) => b - a);
    if (!xs.length) { host.append(el('p', { class: 'empty' }, 'No readings in this range.')); return; }
    const lookups = o.series.map((s) => new Map(s.pts.map((p) => [p.x, p.y])));
    const shown = xs.slice(0, 200);
    const table = el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, o.kind === 'hour' ? 'Hour' : 'Time'),
        o.series.map((s) => el('th', { scope: 'col' }, s.name + ' (' + o.unit + ')')))),
      el('tbody', {}, shown.map((x) => el('tr', {}, el('th', { scope: 'row' }, o.fmtX(x)),
        lookups.map((l) => el('td', {}, fmtNum(l.get(x) ?? null, o.pol)))))));
    const wrap = el('div', { class: 'table-scroll' }, table);
    host.append(wrap);
    if (xs.length > shown.length) host.append(el('p', { class: 'note' }, `Showing the latest ${shown.length} of ${xs.length} rows. The full history is in ${state.src.file}.`));
  }

  /* ----- sections ----- */

  function seriesFor(polId, t0, t1, res) {
    return activeStations().map((st) => {
      const all = state.series.get(st.id + '|' + polId);
      if (!all) return null;
      let pts = inRange(all, t0, t1);
      if (res !== 'hour') pts = aggregateDaily(pts, res);
      return { key: st.id, name: st.name, color: stationColor(st), pts: pts.map((p) => ({ x: p.t, y: p.v })) };
    }).filter((s) => s && s.pts.length);
  }

  function xFormatter(res) { return res === 'hour' ? fmtDateHour : fmtDateYear; }

  function renderCharts() {
    const [t0, t1] = currentWindow();
    const res = resolution();
    const grid = document.getElementById('charts');
    grid.textContent = '';
    const resText = { hour: 'Hourly readings', mean: 'Daily average', max: 'Daily peak' }[res];
    let group = null;
    let shown = 0;
    for (const pol of chartable()) {
      const o = {
        series: seriesFor(pol.id, t0, t1, res), kind: 'time', stepMs: res === 'hour' ? HOUR : DAY,
        unit: pol.unit, pol: pol.id, guideline: pol.guideline, fmtX: xFormatter(res),
        ariaLabel: `${pol.name} in ${pol.unit}, ${resText.toLowerCase()}, by station. Use arrow keys to read values.`,
      };
      if (!o.series.length) continue; // no selected station measures this
      if (state.src.pollutants.some((p) => p.group !== AIR) && pol.group !== group) {
        group = pol.group;
        grid.append(el('h3', { class: 'group-title' }, group));
      }
      shown++;
      const showTable = state.tableView.has(pol.id);
      const body = el('div', { class: 'chart-body' });
      const toggle = el('button', {
        type: 'button', class: 'link-btn', 'aria-pressed': String(showTable),
        onclick: () => { showTable ? state.tableView.delete(pol.id) : state.tableView.add(pol.id); renderCharts(); },
      }, showTable ? 'Show chart' : 'Show table');
      const guide = pol.guideline == null ? 'No 1-hour guideline shown' : `Ontario 1-hour guideline: ${pol.guideline} ${pol.unit}`;
      grid.append(el('article', { class: 'card' },
        el('div', { class: 'card-head' },
          el('div', {}, el('h3', {}, `${pol.name} (${pol.label})`), el('p', { class: 'sub' }, `${resText} · ${pol.unit} · ${guide}`)),
          toggle),
        body));
      (showTable ? renderTable : renderLine)(body, o);
    }
    if (!shown) grid.append(el('p', { class: 'empty' }, 'None of the selected stations has readings in this range.'));
  }

  function renderProfile() {
    const [t0, t1] = currentWindow();
    const pol = polById(state.profilePol);
    const series = activeStations().map((st) => {
      const all = state.series.get(st.id + '|' + pol.id);
      if (!all) return null;
      const pts = hourOfDay(inRange(all, t0, t1));
      return { key: st.id, name: st.name, color: stationColor(st), pts };
    }).filter((s) => s && s.pts.some((p) => p.y !== null));
    const host = document.getElementById('profile-chart');
    const o = {
      series, kind: 'hour', stepMs: 1, unit: pol.unit, pol: pol.id, guideline: pol.guideline,
      fmtX: (h) => 'Average at ' + pad(h) + ':00', ariaLabel: `Average ${pol.name} by hour of day. Use arrow keys to read values.`,
    };
    (state.tableView.has('profile') ? renderTable : renderLine)(host, o);
    const btn = document.getElementById('profile-toggle');
    btn.textContent = state.tableView.has('profile') ? 'Show chart' : 'Show table';
    document.getElementById('profile-sub').textContent = `Average ${pol.name.toLowerCase()} (${pol.unit}) by hour of day · ${rangeLabel()}`;
  }

  function slotsFor(series, t0, t1) {
    // hours between the first reading in range and the end of the data
    if (!series.length) return 0;
    return Math.floor((t1 - series[0].t) / HOUR) + 1;
  }

  function renderSummary() {
    const [t0, t1] = currentWindow();
    const tbody = document.getElementById('summary-body');
    tbody.textContent = '';
    let totalAbove = 0;
    const flagged = [];
    for (const pol of chartable()) {
      for (const st of activeStations()) {
        const all = state.series.get(st.id + '|' + pol.id);
        if (!all) continue;
        const pts = inRange(all, t0, t1);
        const s = stats(pts, pol.guideline, slotsFor(pts, t0, t1));
        if (!s) continue;
        if (s.above) { totalAbove += s.above; flagged.push(`${pol.label} at ${st.name.replace('Hamilton ', '')}: ${s.above} h`); }
        const aboveCell = s.above == null ? el('td', { class: 'num muted' }, 'n/a')
          : s.above > 0 ? el('td', { class: 'num flag' }, '▲ ' + s.above) : el('td', { class: 'num' }, '0');
        tbody.append(el('tr', {},
          el('th', { scope: 'row' }, pol.label), el('td', {}, st.name),
          el('td', { class: 'num' }, fmtNum(s.mean, pol.id)), el('td', { class: 'num' }, fmtNum(s.median, pol.id)),
          el('td', { class: 'num' }, fmtNum(s.p95, pol.id)),
          el('td', { class: 'num' }, fmtNum(s.max, pol.id) + ' ' + pol.unit),
          el('td', {}, fmtDateHour(s.maxT)), aboveCell,
          el('td', { class: 'num' }, s.coverage == null ? '—' : Math.round(s.coverage * 100) + '%')));
      }
    }
    // hero figure
    document.getElementById('hero-value').textContent = String(totalAbove);
    const guided = pollutants().filter((p) => p.guideline != null).map((p) => p.label).join(', ');
    document.getElementById('hero-detail').textContent = flagged.length ? flagged.join(' · ') : `No readings above the 1-hour guidelines for ${guided} at the selected stations.`;
    document.getElementById('hero-range').textContent = rangeLabel();
  }

  function renderCurrent() {
    const host = document.getElementById('current');
    host.textContent = '';
    const ministry = state.src.maxActive === Infinity;
    const rowsFor = ministry || !state.showAll ? activeStations() : stations();
    if (!ministry) {
      host.append(el('button', {
        type: 'button', class: 'link-btn', 'aria-pressed': String(state.showAll),
        onclick: () => { state.showAll = !state.showAll; renderCurrent(); },
      }, state.showAll ? 'Show only the selected stations' : `Show all ${stations().length} stations`));
    }
    const groups = [...new Set(pollutants().map((p) => p.group))];
    let any = false;
    for (const g of groups) {
      const pols = pollutants().filter((p) => p.group === g && rowsFor.some((st) => state.series.get(st.id + '|' + p.id)));
      const stationsHere = rowsFor.filter((st) => pols.some((p) => state.series.get(st.id + '|' + p.id)));
      if (!pols.length) continue;
      any = true;
      if (groups.length > 1) host.append(el('h3', { class: 'group-title' }, g));
      const tbody = el('tbody');
      for (const st of stationsHere) {
        const color = state.active.has(st.id) ? stationColor(st) : null;
        const key = el('span', { class: 'key' });
        if (color) key.style.background = color; else key.style.visibility = 'hidden';
        const row = el('tr', {}, el('th', { scope: 'row' }, key, st.name));
        for (const pol of pols) {
          const all = state.series.get(st.id + '|' + pol.id);
          const last = all && all[all.length - 1];
          if (!last) { row.append(el('td', { class: 'muted' }, ministry ? 'Not measured' : '—')); continue; }
          const over = pol.guideline != null && last.v > pol.guideline;
          row.append(el('td', {},
            el('strong', {}, fmtNum(last.v, pol.id)), ' ', el('span', { class: 'unit' }, pol.unit),
            pol.id === 'WD' ? ' ' + compass(last.v) : null,
            over ? el('div', { class: 'flag' }, '▲ Above guideline') : null,
            el('div', { class: 'when' }, fmtDateHour(last.t))));
        }
        tbody.append(row);
      }
      host.append(el('div', { class: 'card wide-scroll' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Station'),
          pols.map((p) => el('th', { scope: 'col' }, ministry ? `${p.name} (${p.label})` : `${p.label} (${p.unit})`)))),
        tbody)));
    }
    if (!any) host.append(el('p', { class: 'empty' }, 'The selected stations have no readings yet.'));
  }

  // Returns a short message when the click could not be applied.
  function toggleStation(st) {
    const limited = state.src.maxActive !== Infinity;
    const on = state.active.has(st.id);
    if (on && state.active.size === 1) return 'Keep at least one station selected.';
    if (!on && limited && state.active.size >= state.src.maxActive) return `Charts show up to ${state.src.maxActive} stations. Deselect one first.`;
    if (on) { state.active.delete(st.id); state.slots.delete(st.id); }
    else {
      state.active.add(st.id);
      if (limited) state.slots.set(st.id, SLOT_COLORS.find((c) => ![...state.slots.values()].includes(c)));
    }
    renderAll();
    return '';
  }

  /* ----- map (Leaflet + OpenStreetMap; the page works without it) ----- */

  const mapState = { map: null, layer: null, srcId: null };
  function renderMap() {
    const box = document.getElementById('map-section');
    if (!window.L) { box.hidden = true; return; }
    box.hidden = false;
    const L = window.L;
    if (!mapState.map) {
      mapState.map = L.map('map', { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(mapState.map);
      mapState.layer = L.layerGroup().addTo(mapState.map);
    }
    const css = getComputedStyle(document.documentElement);
    mapState.layer.clearLayers();
    const pts = [];
    for (const st of stations()) {
      if (st.lat == null) continue;
      const on = state.active.has(st.id);
      const m = L.circleMarker([st.lat, st.lon], {
        radius: on ? 10 : 7, weight: 2, color: '#ffffff', fillOpacity: on ? 0.95 : 0.85,
        fillColor: on ? css.getPropertyValue(stationColor(st).replace(/var\((--[\w-]+)\)/, '$1')).trim() || '#2a78d6' : '#6b6a66',
      });
      m.bindTooltip(st.name + (st.note ? ' (mobile)' : ''), { direction: 'top' });
      m.on('click', () => {
        const msg = toggleStation(st);
        const note = document.getElementById('map-note');
        if (msg) note.textContent = msg;
      });
      m.addTo(mapState.layer);
      pts.push([st.lat, st.lon]);
    }
    if (mapState.srcId !== state.src.id) {
      mapState.srcId = state.src.id;
      mapState.map.invalidateSize();
      mapState.map.fitBounds(pts, { padding: [24, 24], maxZoom: 14 });
    }
    document.getElementById('map-note').textContent = state.src.maxActive === Infinity
      ? 'Click a station to show or hide it.'
      : `Click a station to add it to the charts (up to ${state.src.maxActive}), or click a selected one to remove it. Grey dots are not selected. You can also use the station buttons below the map.`;
  }

  function renderControls() {
    const range = document.getElementById('range');
    range.textContent = '';
    for (const r of RANGES) {
      const on = r.days === state.rangeDays;
      range.append(el('button', {
        type: 'button', class: 'seg' + (on ? ' on' : ''), 'aria-pressed': String(on),
        onclick: () => { state.rangeDays = r.days; renderAll(); },
      }, on ? el('span', { 'aria-hidden': 'true', class: 'check' }, '✓ ') : null, r.label));
    }
    const legend = document.getElementById('legend');
    legend.textContent = '';
    const limited = state.src.maxActive !== Infinity;
    if (limited) legend.append(el('span', { class: 'label' }, `Charts (pick up to ${state.src.maxActive}):`));
    for (const st of stations()) {
      const on = state.active.has(st.id);
      const full = limited && !on && state.active.size >= state.src.maxActive;
      const key = el('span', { class: 'key' }); key.style.background = on ? stationColor(st) : 'var(--muted)';
      legend.append(el('button', {
        type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on),
        title: full ? 'Deselect a station first' : '', ...(full ? { disabled: '' } : {}),
        onclick: () => toggleStation(st),
      }, key, st.name));
    }
  }

  function renderSource() {
    const box = document.getElementById('source');
    box.textContent = '';
    for (const src of SOURCES) {
      const on = src === state.src;
      box.append(el('button', {
        type: 'button', class: 'seg' + (on ? ' on' : ''), 'aria-pressed': String(on),
        onclick: () => { location.hash = src.id; },
      }, on ? el('span', { 'aria-hidden': 'true', class: 'check' }, '✓ ') : null, src.label));
    }
    document.getElementById('lede-text').textContent = state.src.lede;
    document.getElementById('source-note').textContent = '';
    document.getElementById('source-note').append('Source: ', el('a', { href: state.src.sourceUrl }, state.src.source), state.src.sourceText);
    document.getElementById('guide-note').textContent = state.src.guideText;
    const sel = document.getElementById('profile-pol');
    sel.textContent = '';
    for (const p of chartable()) sel.append(el('option', { value: p.id }, `${p.name} (${p.label})`));
    if (!chartable().some((p) => p.id === state.profilePol)) state.profilePol = 'NO2';
    sel.value = state.profilePol;
  }

  function renderAll() {
    renderSource();
    renderControls();
    renderMap();
    renderSummary();
    renderCurrent();
    renderCharts();
    renderProfile();
  }

  /* ----- start-up ----- */

  function fail(msg) {
    const box = document.getElementById('status');
    box.textContent = msg;
    box.hidden = false;
  }

  async function loadSource(src) {
    if (state.loaded.has(src.id)) return state.loaded.get(src.id);
    const r = await fetch(src.file, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const series = buildSeries(parseCsv(await r.text()));
    const all = [...series.values()].flat();
    if (!all.length) throw new Error('no readings yet');
    const entry = { series, tMin: Math.min(...all.map((p) => p.t)), tMax: Math.max(...all.map((p) => p.t)) };
    state.loaded.set(src.id, entry);
    return entry;
  }

  async function showSource(src) {
    const box = document.getElementById('status');
    box.hidden = true;
    state.src = src;
    resetSelection();
    let entry;
    try {
      entry = await loadSource(src);
    } catch (err) {
      renderSource();
      document.getElementById('app').hidden = false;
      document.getElementById('dash').hidden = true;
      fail(`Could not load ${src.file} (${err.message}). If you opened this file directly from disk, serve the folder with a web server instead; otherwise run the collector first.`);
      return;
    }
    document.getElementById('dash').hidden = false;
    state.series = entry.series; state.tMin = entry.tMin; state.tMax = entry.tMax;
    document.getElementById('updated').textContent = fmtDateHour(state.tMax) + ' (Eastern time)';
    renderAll();
  }

  const fromHash = () => SOURCES.find((s) => s.id === location.hash.slice(1)) || SOURCES[0];

  async function start() {
    const res = document.getElementById('resolution');
    for (const r of RESOLUTIONS) res.append(el('option', { value: r.value }, r.label));
    res.addEventListener('change', () => { state.res = res.value; renderCharts(); });
    const sel = document.getElementById('profile-pol');
    sel.addEventListener('change', () => { state.profilePol = sel.value; renderProfile(); });
    document.getElementById('profile-toggle').addEventListener('click', () => {
      state.tableView.has('profile') ? state.tableView.delete('profile') : state.tableView.add('profile');
      renderProfile();
    });
    window.addEventListener('hashchange', () => showSource(fromHash()));
    document.getElementById('app').hidden = false;
    await showSource(fromHash());

    let raf = 0;
    let lastW = document.getElementById('app').clientWidth;
    new ResizeObserver(() => {
      const w = document.getElementById('app').clientWidth;
      if (w === lastW) return;
      lastW = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { renderCharts(); renderProfile(); });
    }).observe(document.getElementById('app'));
  }

  start();
})(typeof window !== 'undefined' ? window : globalThis);
