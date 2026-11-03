// Run with: node test_dashboard.js
const assert = require('assert');
const fs = require('fs');
const H = require('./dashboard.js');

const rows = H.parseCsv(fs.readFileSync(__dirname + '/data/readings.csv', 'utf8'));
assert.strictEqual(rows.length, 36, 'seed file has 36 day-rows');

const series = H.buildSeries(rows);
assert.strictEqual(series.size, 12, '12 station/pollutant series');

// Downtown SO2: 3 days x 24 hours = 72 slots, 2 blank (Nov 2 at 4 AM and 11 PM)
const so2 = series.get('29000|SO2');
assert.strictEqual(so2.length, 70, 'blank hours are dropped');
assert.ok(so2.every((p, i) => i === 0 || p.t > so2[i - 1].t), 'sorted by time');

// Peak is 62.1 on Nov 1 at 6 PM; only 46.8, 44.7 and 62.1 exceed the 40 ppb guideline
const s = H.stats(so2, 40, 72);
assert.strictEqual(s.max, 62.1);
assert.strictEqual(new Date(s.maxT).toISOString(), '2026-11-01T18:00:00.000Z');
assert.strictEqual(s.above, 3);
assert.ok(Math.abs(s.coverage - 70 / 72) < 1e-9);

// A guideline of null means "not applicable"
assert.strictEqual(H.stats(series.get('29000|PM25'), null, 72).above, null);

// Daily aggregation: Oct 31 and Nov 1 are full days; Nov 2 has only 22 readings (>= 18, kept)
const pm = series.get('29000|PM25');
const daily = H.aggregateDaily(pm, 'mean');
assert.strictEqual(daily.length, 3);
const oct31 = [4, 5, 5, 6, 6, 5, 5, 5, 5, 5, 4, 4, 3, 3, 3, 3, 3, 4, 4, 6, 7, 7, 7, 7];
const expectedMean = oct31.reduce((a, b) => a + b, 0) / 24;
assert.ok(Math.abs(daily[0].v - expectedMean) < 1e-9);
assert.strictEqual(H.aggregateDaily(pm, 'max')[1].v, 16); // Nov 1 peak
// a day with too few readings is left out
assert.strictEqual(H.aggregateDaily(pm.slice(0, 10), 'mean').length, 0);

// Hour-of-day: PM2.5 at 4 AM is 6, 12, 12 across the three days
const hod = H.hourOfDay(pm);
assert.strictEqual(hod.length, 24);
assert.ok(Math.abs(hod[4].y - 10) < 1e-9);
assert.ok(Math.abs(hod[0].y - (4 + 7 + 13) / 3) < 1e-9);
// SO2 at 4 AM: Nov 2 is blank, so only Oct 31 (0.2) and Nov 1 (0.2) count
assert.ok(Math.abs(H.hourOfDay(so2)[4].y - 0.2) < 1e-9);

// Percentiles and axis steps
assert.strictEqual(H.percentile([1, 2, 3, 4], 0.5), 2.5);
assert.strictEqual(H.percentile([10], 0.95), 10);
assert.strictEqual(H.percentile([], 0.5), null);
assert.strictEqual(H.niceStep(7.3), 10);
assert.strictEqual(H.niceStep(0.34), 0.5);
assert.strictEqual(H.niceStep(0), 1);

// Formatting
assert.strictEqual(H.fmtNum(0.456, 'CO'), '0.46');
assert.strictEqual(H.fmtNum(62.14, 'SO2'), '62.1');
assert.strictEqual(H.fmtNum(null, 'O3'), '—');
assert.strictEqual(H.fmtDateHour(Date.UTC(2026, 10, 1, 18)), 'Nov 1, 6 PM');

// ---- HAMN source ----
const hamn = H.SOURCES.find((x) => x.id === 'hamn');
const hrows = H.parseCsv(fs.readFileSync(__dirname + '/' + hamn.file, 'utf8'));
const hseries = H.buildSeries(hrows);
// every series in the file belongs to a configured station and pollutant
const stationIds = new Set(hamn.stations.map((x) => x.id));
const polIds = new Set(hamn.pollutants.map((x) => x.id));
for (const key of hseries.keys()) {
  const [st, pol] = key.split('|');
  assert.ok(stationIds.has(st), 'unknown HAMN station ' + st);
  assert.ok(polIds.has(pol), 'unknown HAMN pollutant ' + pol);
}
// STN29667 SO2 peaks at 80 ppb on Nov 1 (stamp 15:00); two hours exceed 40 ppb
const hso2 = hseries.get('STN29667|SO2');
const hs = H.stats(hso2, 40, 48);
assert.strictEqual(hs.max, 80);
assert.strictEqual(new Date(hs.maxT).toISOString(), '2026-11-01T15:00:00.000Z');
assert.strictEqual(hs.above, 2);
// blank hours are dropped: COH_MBL1 NO2 has one blank on Nov 2 (09:00)
assert.strictEqual(hseries.get('COH_MBL1|NO2').length, 47);
// the Ministry source is unchanged and defaults are valid station ids
assert.strictEqual(H.SOURCES[0].file, 'data/readings.csv');
for (const src of H.SOURCES) for (const id of src.defaultActive) assert.ok(src.stations.some((x) => x.id === id));
assert.ok(hamn.defaultActive.length <= hamn.maxActive);

console.log('all dashboard logic tests passed');
