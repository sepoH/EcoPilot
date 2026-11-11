// artifact/oppdater.ts
import path3 from "node:path";
import fs4 from "node:fs";

// artifact/pipeline.ts
import fs from "node:fs";
import path from "node:path";

// lib/analytics/stats.ts
function percentileSorted(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// lib/analytics/factors.ts
var FACTORS = [
  { key: "marked", symbol: "^NDX", label: "Tech market (Nasdaq-100)", unit: "%", help: "Nasdaq-100 return in USD" },
  { key: "halvleder", symbol: "^SOX", label: "Semiconductors beyond the market (SOX)", unit: "%", help: "The semiconductor index relative to what Nasdaq explains" },
  { key: "dollar", symbol: "NOK=X", label: "US dollar (USD/NOK)", unit: "%", help: "Percentage change in USD/NOK" },
  { key: "rente", symbol: "^TNX", label: "US 10-year yield", unit: "pp", help: "Change in the yield in percentage points" }
];
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
function invert(A) {
  const n = A.length;
  return Array.from({ length: n }, (_, j) => solve(A, Array.from({ length: n }, (_2, i) => i === j ? 1 : 0))).reduce((inv, col, j) => {
    col.forEach((v, i) => inv[i][j] = v);
    return inv;
  }, Array.from({ length: n }, () => new Array(n).fill(0)));
}
function ols(y, X) {
  const n = y.length;
  const k = X[0].length;
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_2, j) => X.reduce((s, row) => s + row[i] * row[j], 0)));
  const Xty = Array.from({ length: k }, (_, i) => X.reduce((s, row, t) => s + row[i] * y[t], 0));
  const b = solve(XtX, Xty);
  const resid = y.map((v, t) => v - X[t].reduce((s, x, i) => s + x * b[i], 0));
  const sse = resid.reduce((s, e) => s + e * e, 0);
  const my = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const s2 = sse / (n - k);
  const inv = invert(XtX);
  return { b, se: inv.map((row, i) => Math.sqrt(Math.max(0, row[i] * s2))), r2: 1 - sse / sst, resid };
}
function impliedRateChange(c) {
  const y1 = c.y3m + (c.y5 - c.y3m) * ((1 - 0.25) / (5 - 0.25));
  const y11 = c.y10 + (c.y30 - c.y10) * (1 / 20);
  const forward = (11 * y11 - y1) / 10;
  return { y1, y11, forward, change: forward - c.y10 };
}

// lib/analytics/dates.ts
var MS_PER_DAY = 864e5;
function toUtcMs(date) {
  return Date.parse(date + "T00:00:00Z");
}
function fromUtcMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function calendarDaysBetween(a, b) {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / MS_PER_DAY);
}
function addDays(date, days) {
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}
function addMonths(date, months) {
  const d = new Date(toUtcMs(date));
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return fromUtcMs(d.getTime());
}
function isWeekday(date) {
  const wd = new Date(toUtcMs(date)).getUTCDay();
  return wd !== 0 && wd !== 6;
}
function weekdaysAfter(from, to) {
  const out = [];
  let d = addDays(from, 1);
  while (d <= to) {
    if (isWeekday(d)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

// lib/analytics/types.ts
var DAYS_PER_YEAR = 365;

// lib/analytics/returns.ts
function annualize(navStart, navEnd, calendarDays) {
  if (calendarDays <= 0) return NaN;
  return Math.pow(navEnd / navStart, DAYS_PER_YEAR / calendarDays) - 1;
}
function periodReturn(start, end) {
  const calendarDays = calendarDaysBetween(start.date, end.date);
  return {
    startDate: start.date,
    endDate: end.date,
    startNav: start.nav,
    endNav: end.nav,
    calendarDays,
    total: end.nav / start.nav - 1,
    annualized: annualize(start.nav, end.nav, calendarDays)
  };
}
function indexAtOrBefore(points, date) {
  let lo = 0;
  let hi = points.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    if (points[mid].date <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
var TRAILING_LABELS = {
  "1M": "1 month",
  "3M": "3 months",
  "6M": "6 months",
  YTD: "Year to date",
  "1Y": "1 year",
  "3Y": "3 years",
  MAX: "Full period"
};
function trailingStartDate(key, endDate, firstDate) {
  switch (key) {
    case "1M":
      return addMonths(endDate, -1);
    case "3M":
      return addMonths(endDate, -3);
    case "6M":
      return addMonths(endDate, -6);
    case "YTD":
      return `${Number(endDate.slice(0, 4)) - 1}-12-31`;
    case "1Y":
      return addMonths(endDate, -12);
    case "3Y":
      return addMonths(endDate, -36);
    case "MAX":
      return firstDate;
  }
}
function trailingReturns(points) {
  const last = points[points.length - 1];
  const first = points[0];
  const out = {};
  for (const key of Object.keys(TRAILING_LABELS)) {
    const startDate = trailingStartDate(key, last.date, first.date);
    const i = key === "MAX" ? 0 : indexAtOrBefore(points, startDate);
    out[key] = i < 0 || i === points.length - 1 ? null : periodReturn(points[i], last);
  }
  return out;
}

// lib/analytics/random.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function normalGenerator(rand) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

// lib/analytics/dips.ts
function findDips(points, threshold = 0.05) {
  const out = [];
  const lastNav = points[points.length - 1].nav;
  let peakIdx = 0;
  let active = null;
  const close = (recoveryIndex) => {
    const a = active;
    const pk = points[peakIdx];
    const tr = points[a.trough];
    const tg = points[a.trigger];
    out.push({
      peakIndex: peakIdx,
      peakDate: pk.date,
      peakNav: pk.nav,
      triggerDate: tg.date,
      triggerNav: tg.nav,
      troughIndex: a.trough,
      troughDate: tr.date,
      troughNav: tr.nav,
      depth: tr.nav / pk.nav - 1,
      daysToTrough: calendarDaysBetween(pk.date, tr.date),
      recoveryIndex,
      recoveryDate: recoveryIndex === null ? null : points[recoveryIndex].date,
      daysToRecovery: recoveryIndex === null ? null : calendarDaysBetween(tr.date, points[recoveryIndex].date),
      ongoing: recoveryIndex === null,
      returnFromTrigger: lastNav / tg.nav - 1,
      returnFromTrough: lastNav / tr.nav - 1,
      returnFromPeak: lastNav / pk.nav - 1
    });
    active = null;
  };
  for (let i = 0; i < points.length; i++) {
    const nav = points[i].nav;
    if (nav >= points[peakIdx].nav) {
      if (active) close(i);
      peakIdx = i;
      continue;
    }
    const dd = nav / points[peakIdx].nav - 1;
    if (!active && dd <= -threshold) active = { trigger: i, trough: i };
    if (active && nav < points[active.trough].nav) active.trough = i;
  }
  if (active) close(null);
  return out;
}

// lib/analytics/crash.ts
var VOL_DECAY_PHI = 0.98;
var EWMA_LAMBDA = 0.94;
function findCrashes(ndxDaily, threshold = 0.2) {
  const dips = findDips(ndxDaily, threshold);
  const years2 = (Date.parse(ndxDaily[ndxDaily.length - 1].date) - Date.parse(ndxDaily[0].date)) / (365.25 * 864e5);
  return {
    events: dips.map((d) => ({ peakDate: d.peakDate, troughDate: d.troughDate, depth: d.depth, tradingDays: Math.max(1, d.troughIndex - d.peakIndex) })),
    years: years2
  };
}
function ewmaVol(returns, lambda = EWMA_LAMBDA) {
  const seedN = Math.min(60, returns.length);
  let v = returns.slice(0, seedN).reduce((s, r) => s + r * r, 0) / seedN;
  for (let i = seedN; i < returns.length; i++) v = lambda * v + (1 - lambda) * returns[i] ** 2;
  return Math.sqrt(v * 252);
}
function buildShockModel(crashes, years2, marketBeta, sigmaNow) {
  return {
    lambda: crashes.length / years2,
    events: crashes.map((c) => ({ logDrop: marketBeta * Math.log(1 + c.depth), tradingDays: c.tradingDays })),
    sigmaNow,
    phi: VOL_DECAY_PHI
  };
}
function makeStepper(annualReturn, sigma, dt, nSteps, paths, shock, rand) {
  const meanDrop = shock && shock.events.length ? shock.events.reduce((s, e) => s + e.logDrop, 0) / shock.events.length : 0;
  const drift = (Math.log(1 + annualReturn) - (shock ? shock.lambda * meanDrop : 0)) * dt;
  const daysPerStep = 252 * dt;
  const vol = new Float64Array(nSteps);
  for (let s = 0; s < nSteps; s++) {
    const v2 = shock ? sigma * sigma + (shock.sigmaNow ** 2 - sigma * sigma) * Math.pow(shock.phi, s * daysPerStep) : sigma * sigma;
    vol[s] = Math.sqrt(Math.max(0, v2) * dt);
  }
  const hazard = shock ? shock.lambda * dt : 0;
  const left = new Int32Array(paths);
  const perStep = new Float64Array(paths);
  const hit = new Uint8Array(paths);
  return {
    drift,
    /** Logaritmisk avkastning for bane p i steg s, gitt et standardnormalt tall z. */
    step(p, s, z) {
      let jump = 0;
      if (shock) {
        if (left[p] > 0) {
          jump = perStep[p];
          left[p]--;
        } else if (rand() < hazard) {
          const e = shock.events[Math.floor(rand() * shock.events.length)];
          const steps = Math.max(1, Math.round(e.tradingDays / daysPerStep));
          perStep[p] = e.logDrop / steps;
          left[p] = steps - 1;
          jump = perStep[p];
          hit[p] = 1;
        }
      }
      return drift + vol[s] * z + jump;
    },
    reset(p) {
      left[p] = 0;
      hit[p] = 0;
    },
    hit
  };
}

// lib/analytics/portfolio.ts
var FUND = "__FUND__";
function weekKey(date) {
  const wd = new Date(toUtcMs(date)).getUTCDay();
  return addDays(date, -((wd + 6) % 7));
}
function weeklyLast(points) {
  const m = /* @__PURE__ */ new Map();
  for (const p of points) m.set(weekKey(p.date), p.nav);
  return m;
}
function buildWeeklyPanel(fund, stocks, fx) {
  const fundW = weeklyLast(fund);
  const fxW = {};
  for (const [c, pts] of Object.entries(fx)) fxW[c] = weeklyLast(pts);
  const stockW = Object.fromEntries(Object.entries(stocks).map(([s, v]) => [s, { c: v.currency, m: weeklyLast(v.points) }]));
  const weeks = [...fundW.keys()].filter(
    (w) => Object.values(stockW).every((s) => s.m.has(w) && (s.c === "NOK" || fxW[s.c]?.has(w)))
  ).sort();
  const prices = { [FUND]: weeks.map((w) => fundW.get(w)) };
  for (const [s, v] of Object.entries(stockW)) {
    prices[s] = weeks.map((w) => v.m.get(w) * (v.c === "NOK" ? 1 : fxW[v.c].get(w)));
  }
  return { weeks, prices };
}

// lib/analytics/generic/model.ts
var GENERIC_FACTORS = [
  { key: "marked", symbol: "^GSPC", label: "Stock market (S&P 500)", unit: "%", kind: "ret" },
  { key: "teknologi", symbol: "^NDX", label: "Tech beyond the market (Nasdaq-100)", unit: "%", kind: "resid" },
  { key: "norge", symbol: "OSEBX.OL", label: "Oslo B\xF8rs beyond the market (OSEBX)", unit: "%", kind: "resid" },
  { key: "europa", symbol: "^STOXX", label: "Europe beyond the market (STOXX 600)", unit: "%", kind: "resid" },
  { key: "fremvoksende", symbol: "EEM", label: "Emerging markets beyond the market (EEM)", unit: "%", kind: "resid" },
  { key: "dollar", symbol: "NOK=X", label: "US dollar (USD/NOK)", unit: "%", kind: "ret" },
  { key: "euro", symbol: "EURNOK=X", label: "Euro (EUR/NOK)", unit: "%", kind: "ret" },
  { key: "olje", symbol: "BZ=F", label: "Oil price (Brent)", unit: "%", kind: "ret" },
  { key: "rente", symbol: "^TNX", label: "US 10-year yield", unit: "pp", kind: "diff" }
];
function factorReturns(f, start, end) {
  const ret = (s) => {
    const p = f.weekly[s].slice(start, end + 1);
    return p.slice(1).map((x, i) => x / p[i] - 1);
  };
  const mkt = ret("^GSPC");
  const out = {};
  for (const g of GENERIC_FACTORS) {
    if (g.kind === "ret") out[g.key] = g.key === "marked" ? mkt : ret(g.symbol);
    else if (g.kind === "diff") {
      const p = f.weekly[g.symbol].slice(start, end + 1);
      out[g.key] = p.slice(1).map((x, i) => x - p[i]);
    } else {
      const r = ret(g.symbol);
      const b = f.residSlope[g.key] ?? 0;
      out[g.key] = r.map((x, i) => x - b * mkt[i]);
    }
  }
  return out;
}
var REVERSAL_PER_DAY = 0.02;
var BETA_PRIOR_SD = 0.5;
var ALPHA_PRIOR_SD = 0.03;
function winsorize(x, k = 5) {
  if (x.length < 20) return { values: x, lo: -Infinity, hi: Infinity, clipped: [] };
  const sorted = [...x].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  const dev = x.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = dev[dev.length >> 1] * 1.4826;
  if (!(mad > 0)) return { values: x, lo: -Infinity, hi: Infinity, clipped: [] };
  const lo = med - k * mad, hi = med + k * mad;
  const clipped = [];
  const values = x.map((v, i) => {
    if (v < lo || v > hi) {
      clipped.push(i);
      return v < lo ? lo : hi;
    }
    return v;
  });
  return { values, lo, hi, clipped };
}
function buildGenericModel(points, f, opts = {}) {
  const maxWeeks = opts.maxWeeks ?? 104;
  const minWeeks = opts.minWeeks ?? 52;
  const fundW = weeklyLast(points);
  const idx = [];
  f.weeks.forEach((w, i) => {
    if (fundW.has(w)) idx.push(i);
  });
  if (!idx.length) return null;
  let k = idx.length - 1;
  const used = [idx[k]];
  while (k > 0 && idx[k] - idx[k - 1] === 1 && used.length < maxWeeks + 1) {
    k--;
    used.unshift(idx[k]);
  }
  if (used.length - 1 < minWeeks) return null;
  const s0 = used[0], s1 = used[used.length - 1];
  const fr = factorReturns(f, s0, s1);
  const fundP = used.map((i) => fundW.get(f.weeks[i]));
  const yRaw = fundP.slice(1).map((x, i) => x / fundP[i] - 1);
  const robustY = winsorize(yRaw);
  const y = robustY.values;
  const keys = GENERIC_FACTORS.map((g) => g.key);
  const X = y.map((_, t) => [1, ...keys.map((k2) => fr[k2][t])]);
  const fit = ols(y, X);
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  const varY = y.reduce((a, v) => a + (v - my) ** 2, 0);
  const betas = {};
  const tStats = {};
  const varianceShare = {};
  const rawBetas = {};
  const shrinkWeight = {};
  keys.forEach((k2, i) => {
    rawBetas[k2] = fit.b[i + 1];
    const se = fit.se[i + 1];
    shrinkWeight[k2] = Number.isFinite(se) ? BETA_PRIOR_SD ** 2 / (BETA_PRIOR_SD ** 2 + se ** 2) : 0;
    const prior = k2 === "marked" ? 1 : 0;
    betas[k2] = shrinkWeight[k2] * rawBetas[k2] + (1 - shrinkWeight[k2]) * prior;
    tStats[k2] = fit.b[i + 1] / se;
    const mf = fr[k2].reduce((a, b) => a + b, 0) / fr[k2].length;
    varianceShare[k2] = rawBetas[k2] * fr[k2].reduce((a, v, t) => a + (v - mf) * (y[t] - my), 0) / varY;
  });
  const reg = { alpha: fit.b[0], alphaT: fit.b[0] / fit.se[0], betas, tStats, r2: fit.r2, varianceShare, n: y.length };
  const parts = GENERIC_FACTORS.map((g) => ({ key: g.key, beta: betas[g.key], shock: f.prediction[g.key], effect: betas[g.key] * f.prediction[g.key] }));
  const alphaAnnual = reg.alpha * 52;
  const alphaSe = Math.abs(reg.alpha / reg.alphaT) * 52;
  const alphaWeight = Number.isFinite(alphaSe) ? ALPHA_PRIOR_SD ** 2 / (ALPHA_PRIOR_SD ** 2 + alphaSe ** 2) : 0;
  const alphaUsed = opts.useAlpha !== false && Math.abs(reg.alphaT) >= 2 ? alphaWeight * alphaAnnual : 0;
  const total = Math.max(-0.9, parts.reduce((a, p) => a + p.effect, 0) + alphaUsed);
  const ly = winsorize(fundP.slice(1).map((x, i) => Math.log(x / fundP[i]))).values;
  const ml = ly.reduce((a, b) => a + b, 0) / ly.length;
  const sigma = Math.sqrt(ly.reduce((a, v) => a + (v - ml) ** 2, 0) / (ly.length - 1) * 52);
  const last = points[points.length - 1];
  const move = (sym) => {
    const pts = f.recent[sym];
    if (!pts?.length) return null;
    const i = indexAtOrBefore(pts, last.date);
    const j = pts.length - 1;
    if (i < 0 || pts[j].date <= last.date) return null;
    return { from: pts[i].nav, to: pts[j].nav, date: pts[j].date };
  };
  const mk = move("^GSPC");
  let nowcast = null;
  if (mk && Math.abs(betas.marked) > 0.05) {
    const moves = { "^GSPC": mk };
    const rM = mk.to / mk.from - 1;
    let ret = betas.marked * rM;
    for (const g of GENERIC_FACTORS) {
      if (g.key === "marked") continue;
      const m = move(g.symbol);
      if (!m) continue;
      moves[g.symbol] = m;
      const r = g.kind === "diff" ? m.to - m.from : m.to / m.from - 1;
      ret += betas[g.key] * (g.kind === "resid" ? r - (f.residSlope[g.key] ?? 0) * rM : r);
    }
    nowcast = { date: mk.date, nav: last.nav * (1 + ret), ret, baseDate: last.date, moves };
  }
  const start = nowcast ? { date: nowcast.date, nav: nowcast.nav } : last;
  const daily = winsorize(points.slice(-260).map((p, i, a) => i ? Math.log(p.nav / a[i - 1].nav) : 0).slice(1), 6).values;
  if (nowcast) daily.push(Math.log(1 + nowcast.ret));
  const sigmaNow = daily.length > 60 ? ewmaVol(daily) : sigma;
  const shock = buildShockModel(f.crashes, f.crashYears, Math.max(0, betas.marked), sigmaNow);
  const recentRev = (() => {
    const tail = points.slice(-6);
    if (tail.length < 6) return null;
    const r5 = tail[5].nav / tail[0].nav - 1 + (nowcast ? nowcast.ret : 0);
    const mk5 = (() => {
      const pts = f.recent["^GSPC"];
      if (!pts?.length) return 0;
      const i = indexAtOrBefore(pts, tail[0].date);
      const j = nowcast ? pts.length - 1 : indexAtOrBefore(pts, tail[5].date);
      return i >= 0 && j > i ? pts[j].nav / pts[i].nav - 1 : 0;
    })();
    const excess = Math.max(-0.3, Math.min(0.3, r5 - betas.marked * mk5));
    return { r5, market5: mk5, excess, shift: -REVERSAL_PER_DAY * excess, from: tail[0].date };
  })();
  return {
    /** Short-term reversal for the next trading day (null when there is too little recent data). */
    reversal: recentRev,
    /** Weeks whose return was dampened by the robust limits (one-off jumps such as unadjusted share issues). */
    dampenedWeeks: robustY.clipped.length,
    regression: reg,
    betas,
    rawBetas,
    shrinkWeight,
    parts,
    alphaAnnual,
    alphaUsed,
    alphaWeight,
    annualReturn: total,
    sigma,
    sigmaNow,
    shock,
    nowcast,
    start,
    weeksUsed: y.length,
    fromWeek: f.weeks[s0],
    toWeek: f.weeks[s1],
    crashes: f.crashes,
    crashYears: f.crashYears,
    crashFrom: f.crashFrom,
    explain: f.explain,
    prediction: f.prediction
  };
}

// lib/analytics/horizonPredict.ts
function predictHorizons(start, annualReturn, sigma, shock, paths = 2e3, seed = 20240505, shift1d = 0) {
  const targets = [
    { key: "1d", date: weekdaysAfter(start.date, addMonths(start.date, 1))[0] },
    { key: "1m", date: addMonths(start.date, 1) },
    { key: "3m", date: addMonths(start.date, 3) },
    { key: "6m", date: addMonths(start.date, 6) },
    { key: "12m", date: addMonths(start.date, 12) },
    { key: "10y", date: addMonths(start.date, 120) }
  ];
  const end = targets[targets.length - 1].date;
  const dates = weekdaysAfter(start.date, end);
  const n = dates.length;
  const dt = calendarDaysBetween(start.date, end) / DAYS_PER_YEAR / n;
  const idx = targets.map((t) => {
    const i = dates.findIndex((d) => d >= t.date);
    return i < 0 ? n - 1 : i;
  });
  const snap2 = targets.map(() => new Float64Array(paths));
  const z = normalGenerator(mulberry32(seed));
  const stepper = makeStepper(annualReturn, sigma, dt, n, paths, shock, mulberry32(seed ^ 2654435769));
  for (let p = 0; p < paths; p++) {
    let logV = 0;
    let t = 0;
    for (let s = 0; s < n; s++) {
      logV += stepper.step(p, s, z());
      while (t < idx.length && idx[t] === s) {
        snap2[t][p] = Math.exp(logV) - 1;
        t++;
      }
    }
  }
  return targets.map((tg, k) => {
    if (tg.key === "1d" && shift1d) for (let p = 0; p < paths; p++) snap2[k][p] = (1 + snap2[k][p]) * (1 + shift1d) - 1;
    const v = snap2[k].sort();
    const years2 = calendarDaysBetween(start.date, dates[idx[k]]) / DAYS_PER_YEAR;
    const median2 = percentileSorted(v, 0.5);
    let up = 0;
    for (const x of v) if (x > 0) up++;
    return {
      key: tg.key,
      date: dates[idx[k]],
      median: median2,
      p10: percentileSorted(v, 0.1),
      p90: percentileSorted(v, 0.9),
      probUp: up / paths,
      annualized: years2 >= 1 ? Math.pow(1 + median2, 1 / years2) - 1 : null
    };
  });
}

// lib/data/dnbPage.ts
function parseDnbFundPage(html, isin, url = "") {
  const s = html.replace(/\\"/g, '"').replace(/\\u0026/g, "&");
  const start = s.indexOf('"fundPortfolioBreakdown":');
  let latest = null;
  let holdings = [];
  if (start >= 0) {
    const before = s.slice(Math.max(0, start - 6e3), start);
    if (before.includes(`"${isin}"`) || before.includes(isin)) {
      const price = [...before.matchAll(/"unitPrice":\{"value":"([\d.]+)","currency":"NOK"\},"unitPriceDate":"(\d{4}-\d{2}-\d{2})/g)].pop();
      if (price) latest = { date: price[2], nav: Number(price[1]) };
      const arr = s.slice(start + '"fundPortfolioBreakdown":'.length);
      const end = arr.indexOf("]");
      try {
        holdings = JSON.parse(arr.slice(0, end + 1)).map((h) => ({ isin: h.id, name: h.securityName, weight: Number(h.weight) / 100 })).filter((h) => Number.isFinite(h.weight) && h.weight > 0);
      } catch {
        holdings = [];
      }
    }
  }
  return { url, fetchedAt: (/* @__PURE__ */ new Date()).toISOString(), latest, holdings };
}
async function fetchDnbFundPage(url, isin, revalidateSeconds = 3600) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; QuantAnalytics/1.0)", Accept: "text/html" },
      next: { revalidate: revalidateSeconds },
      signal: AbortSignal.timeout(15e3)
    });
    if (!res.ok) return null;
    return parseDnbFundPage(await res.text(), isin, url);
  } catch {
    return null;
  }
}
function mergeLatest(points, page) {
  const l = page?.latest;
  if (!l || !(l.nav > 0) || l.date <= points[points.length - 1].date) return { points, added: null };
  return { points: [...points, l], added: l };
}

// lib/funds.ts
var FUNDS = [
  {
    id: "dnb-teknologi-a",
    name: "DNB Teknologi A",
    isin: "NO0010337678",
    type: "fond",
    currency: "NOK",
    manager: "DNB Asset Management AS",
    yahooSymbol: "0P00000MVB.IR",
    dnbPageUrl: "https://www.dnb.no/sparing/fond/fond-liste/d/dnb-teknologi-a-NO0010337678",
    description: "Actively managed equity fund investing globally in technology, media and telecom companies."
  }
];

// lib/data/xlsx.ts
import zlib from "node:zlib";
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66e3); i--) if (buf.readUInt32LE(i) === 101010256) {
    eocd = i;
    break;
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = /* @__PURE__ */ new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 33639248) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lName = buf.readUInt16LE(local + 26), lExtra = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lName + lExtra, local + 30 + lName + lExtra + csize);
    out.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
var unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
function readXlsxRows(buf) {
  const files = new Map([...unzip(buf)].map(([k, v]) => [k, Buffer.from(v.toString("utf8").replace(/<(\/?)x:/g, "<$1"))]));
  const shared = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) shared.push(unescape((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  const sheet = files.get(sheetName)?.toString("utf8") ?? "";
  const rows = [];
  for (const row of sheet.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const cells = [];
    for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = /r="([A-Z]+)\d+"/.exec(c)?.[1] ?? "";
      let col = 0;
      for (const ch of ref) col = col * 26 + (ch.charCodeAt(0) - 64);
      const t = /t="(\w+)"/.exec(c)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c)?.[1] ?? "";
      while (cells.length < col - 1) cells.push("");
      cells.push(t === "s" ? shared[Number(v)] ?? "" : unescape(v));
    }
    rows.push(cells);
  }
  return rows;
}

// lib/data/countries.ts
var COUNTRIES = {
  FR: { name: "France", region: "europe" },
  NL: { name: "Netherlands", region: "europe" },
  BE: { name: "Belgium", region: "europe" },
  PT: { name: "Portugal", region: "europe" },
  IE: { name: "Ireland", region: "europe" },
  IT: { name: "Italy", region: "europe" },
  DE: { name: "Germany", region: "europe" },
  CH: { name: "Switzerland", region: "europe" },
  SE: { name: "Sweden", region: "europe" },
  DK: { name: "Denmark", region: "europe" },
  FI: { name: "Finland", region: "europe" },
  IS: { name: "Iceland", region: "europe" },
  GB: { name: "United Kingdom", region: "europe" },
  ES: { name: "Spain", region: "europe" },
  LU: { name: "Luxembourg", region: "europe" },
  AT: { name: "Austria", region: "europe" },
  GR: { name: "Greece", region: "europe" },
  PL: { name: "Poland", region: "europe" },
  EU: { name: "Europe (ETFs on Xetra)", region: "europe" },
  JP: { name: "Japan", region: "asia" },
  HK: { name: "Hong Kong", region: "asia" },
  IN: { name: "India", region: "asia" },
  CN: { name: "China", region: "asia" },
  TW: { name: "Taiwan", region: "asia" },
  KR: { name: "South Korea", region: "asia" },
  SG: { name: "Singapore", region: "asia" },
  IL: { name: "Israel", region: "asia" },
  ID: { name: "Indonesia", region: "asia" },
  KZ: { name: "Kazakhstan", region: "asia" },
  AU: { name: "Australia", region: "oceania" },
  NZ: { name: "New Zealand", region: "oceania" },
  CA: { name: "Canada", region: "americas" },
  BR: { name: "Brazil", region: "americas" },
  MX: { name: "Mexico", region: "americas" },
  AR: { name: "Argentina", region: "americas" },
  CL: { name: "Chile", region: "americas" },
  PE: { name: "Peru", region: "americas" },
  CO: { name: "Colombia", region: "americas" },
  BM: { name: "Bermuda", region: "americas" },
  KY: { name: "Cayman Islands", region: "americas" },
  ZA: { name: "South Africa", region: "africa" }
};

// lib/data/world.ts
var UA = { "User-Agent": "Mozilla/5.0 (compatible; QuantAnalytics/1.0)" };
async function get(url, timeout = 9e4) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}
var csvSplit = (line, sep) => {
  const out = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
};
var titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-&/(.])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(Asa|Ab|Ag|Sa|Nv|Se|Plc|Spa|Oyj|Ltd|Inc)\b/g, (m) => m.toUpperCase());
async function euronextEurope() {
  const mics = ["XPAR", "XAMS", "XBRU", "XLIS", "XMSM", "MTAA", "ALXP", "ALXB", "ALXL", "XESM", "EXGM", "ENXL", "ALXA", "TNLA", "TNLB", "MLXB"];
  const text = await (await get(`https://live.euronext.com/en/pd_es/data/stocks/download?mics=${mics.join("%2C")}`)).text();
  const map = [[/Paris/i, ".PA", "FR"], [/Amsterdam/i, ".AS", "NL"], [/Brussels/i, ".BR", "BE"], [/Lisbon/i, ".LS", "PT"], [/Dublin/i, ".IR", "IE"], [/Milan/i, ".MI", "IT"]];
  const out = [];
  for (const line of text.split(/\r?\n/).slice(4)) {
    const c = csvSplit(line, ";");
    if (c.length < 5 || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(c[1])) continue;
    const m = map.find(([re]) => re.test(c[3]));
    if (!m) continue;
    out.push({ symbol: `${c[2]}${m[1]}`, name: titleCase(c[0]), country: m[2], exchange: c[3], kind: "stock", isin: c[1] });
  }
  return out;
}
async function nasdaqNordic() {
  const markets = [["STO", ".ST", "SE", "Nasdaq Stockholm"], ["CPH", ".CO", "DK", "Nasdaq Copenhagen"], ["HEL", ".HE", "FI", "Nasdaq Helsinki"], ["ICE", ".IC", "IS", "Nasdaq Iceland"]];
  const out = [];
  for (const [m, suffix, country, exchange] of markets) {
    try {
      const j = await (await get(`https://api.nasdaq.com/api/nordic/screener/shares?category=MAIN_MARKET&tableonly=false&market=${m}`)).json();
      for (const r of j.data.instrumentListing.rows) out.push({ symbol: `${r.symbol.trim().replace(/\s+/g, "-")}${suffix}`, name: r.fullName, country, exchange, kind: "stock", isin: r.isin, sector: r.sector || void 0 });
    } catch {
    }
  }
  return out;
}
async function xetra() {
  const page = await (await get("https://www.xetra.com/xetra-en/instruments/instruments")).text();
  const link = /href="([^"]*allTradableInstruments\.csv)"/.exec(page)?.[1];
  if (!link) throw new Error("Xetra list link not found");
  const text = await (await get(new URL(link, "https://www.xetra.com").toString())).text();
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex((l) => l.startsWith("Product Status"));
  const head = csvSplit(lines[hi], ";");
  const col = (n) => head.indexOf(n);
  const [iName, iIsin, iMn, iType] = [col("Instrument"), col("ISIN"), col("Mnemonic"), col("Instrument Type")];
  const out = [];
  for (const line of lines.slice(hi + 1)) {
    const c = csvSplit(line, ";");
    if (!c[iMn]) continue;
    if (c[iType] === "CS" && c[iIsin]?.startsWith("DE")) out.push({ symbol: `${c[iMn]}.DE`, name: titleCase(c[iName]), country: "DE", exchange: "Xetra", kind: "stock", isin: c[iIsin] });
    else if (c[iType] === "ETF") out.push({ symbol: `${c[iMn]}.DE`, name: c[iName], country: "EU", exchange: "Xetra", kind: "fund", isin: c[iIsin] });
  }
  return out;
}
async function six() {
  const text = await (await get("https://www.six-group.com/sheldon/equity_issuers/v1/equity_issuers.csv")).text();
  const out = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const c = csvSplit(line, ";");
    if (c[4] !== "CH" || c[5] !== "CHF" || c[16] !== "TRUE") continue;
    out.push({ symbol: `${c[2]}.SW`, name: c[0], country: "CH", exchange: "SIX Swiss Exchange", kind: "stock", isin: c[1] });
  }
  return out;
}
async function japan() {
  const page = await (await get("https://www.jpx.co.jp/english/markets/statistics-equities/misc/01.html")).text();
  const link = /href="([^"]*data_e\.xlsx?)"/.exec(page)?.[1];
  if (!link) throw new Error("JPX list link not found");
  const rows = readXlsxRows(Buffer.from(await (await get(new URL(link, "https://www.jpx.co.jp").toString())).arrayBuffer()));
  const out = [];
  for (const r of rows.slice(1)) {
    const [, code, name, market, , sector] = r;
    if (!code || !name) continue;
    if (/Market\s*\(?\s*Domestic/i.test(market) && !/PRO/i.test(market)) out.push({ symbol: `${code}.T`, name, country: "JP", exchange: `Tokyo (${market.replace(/\s*\(Domestic\)/i, "")})`, kind: "stock", sector: sector && sector !== "-" ? sector : void 0 });
    else if (/^ETFs/i.test(market)) out.push({ symbol: `${code}.T`, name, country: "JP", exchange: "Tokyo", kind: "fund" });
  }
  return out;
}
async function hongKong() {
  const rows = readXlsxRows(Buffer.from(await (await get("https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx")).arrayBuffer()));
  const out = [];
  for (const r of rows) {
    const [code, name, cat, sub] = r;
    if (!/^\d+$/.test(code ?? "")) continue;
    const symbol = `${String(Number(code)).padStart(4, "0")}.HK`;
    if (cat === "Equity" && /Main Board/i.test(sub ?? "")) out.push({ symbol, name: titleCase(name), country: "HK", exchange: "Hong Kong", kind: "stock" });
    else if (cat === "Exchange Traded Products" && /Exchange Traded Funds/i.test(sub ?? "")) out.push({ symbol, name, country: "HK", exchange: "Hong Kong", kind: "fund" });
  }
  return out;
}
async function india() {
  const text = await (await get("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv")).text();
  const out = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const c = csvSplit(line, ",");
    if (c[2] !== "EQ") continue;
    out.push({ symbol: `${c[0]}.NS`, name: c[1], country: "IN", exchange: "NSE India", kind: "stock", isin: c[6] });
  }
  return out;
}
async function australia() {
  const text = await (await get("https://www.asx.com.au/asx/research/ASXListedCompanies.csv")).text();
  const out = [];
  for (const line of text.split(/\r?\n/).slice(3)) {
    const c = csvSplit(line, ",");
    if (!c[1] || !/^[A-Z0-9]{3,5}$/.test(c[1])) continue;
    out.push({ symbol: `${c[1]}.AX`, name: titleCase(c[0]), country: "AU", exchange: "ASX", kind: "stock", sector: c[2] && c[2] !== "Not Applic" ? c[2] : void 0 });
  }
  return out;
}
var WORLD_SOURCES = [
  ["Euronext", euronextEurope],
  ["Nasdaq Nordic", nasdaqNordic],
  ["Xetra", xetra],
  ["SIX", six],
  ["Japan", japan],
  ["Hong Kong", hongKong],
  ["India", india],
  ["Australia", australia]
];
function countryCode(name) {
  const n = name.trim().toLowerCase();
  if (!n || n === "united states") return null;
  const special = { "united kingdom": "GB", "south korea": "KR", "hong kong": "HK", "cayman islands": "KY" };
  if (special[n]) return special[n];
  const hit = Object.entries(COUNTRIES).find(([, v]) => v.name.toLowerCase() === n);
  return hit ? hit[0] : null;
}

// lib/data/yahoo.ts
function parseYahooChart(json, opts = {}) {
  if (json.chart.error) throw new Error(`Yahoo Finance: ${json.chart.error.description}`);
  const res = json.chart.result?.[0];
  if (!res || !res.timestamp) throw new Error("Yahoo Finance returned no time series.");
  const close = (opts.adjusted ? res.indicators.adjclose?.[0]?.adjclose : void 0) ?? res.indicators.quote[0]?.close ?? [];
  const byDate = /* @__PURE__ */ new Map();
  res.timestamp.forEach((ts, i) => {
    const v = close[i];
    if (v == null || !Number.isFinite(v) || v <= 0) return;
    byDate.set(new Date(ts * 1e3).toISOString().slice(0, 10), v);
  });
  const points = [...byDate.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([date, nav]) => ({ date, nav }));
  const vol = res.indicators.quote[0]?.volume ?? [];
  const raw = res.indicators.quote[0]?.close ?? [];
  const turn = [];
  for (let i = res.timestamp.length - 1; i >= 0 && turn.length < 60; i--) {
    const v = vol[i], c = raw[i];
    if (v != null && c != null && v > 0) turn.push(v * c);
  }
  const dollarVolume = turn.length ? turn.reduce((a, b) => a + b, 0) / turn.length : void 0;
  return { points, currency: res.meta.currency, name: res.meta.longName ?? res.meta.shortName, dollarVolume };
}
async function fetchYahooNav(symbol, opts = {}) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=${Math.floor(Date.now() / 1e3)}&interval=${opts.interval ?? "1d"}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; QuantAnalytics/1.0)", Accept: "application/json" },
    next: { revalidate: opts.revalidateSeconds ?? 21600 },
    signal: AbortSignal.timeout(15e3)
  });
  if (!res.ok) throw new Error(`Yahoo Finance returned HTTP ${res.status}`);
  const { points, currency } = parseYahooChart(await res.json());
  const expected = opts.currency ?? "NOK";
  if (currency && currency !== expected) throw new Error(`Unexpected currency from the source for ${symbol}: ${currency}`);
  if (points.length < 30) throw new Error("Too few data points from the source.");
  return points;
}

// lib/data/universe.ts
var UA2 = { "User-Agent": "Mozilla/5.0 (compatible; QuantAnalytics/1.0)" };
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function parseDnbFundList(html) {
  const s = html.replace(/\\"/g, '"').replace(/\\u0026/g, "&");
  const i = s.indexOf('"fundProducts":[');
  if (i < 0) return [];
  const j = i + '"fundProducts":'.length;
  let depth = 0;
  for (let k = j; k < s.length; k++) {
    if (s[k] === "[") depth++;
    else if (s[k] === "]" && --depth === 0) {
      try {
        return JSON.parse(s.slice(j, k + 1)).filter((f) => /^[A-Z]{2}[A-Z0-9]{10}$/.test(f.isin));
      } catch {
        return [];
      }
    }
  }
  return [];
}
async function fetchYahoo(symbol, fromUnix, interval = "1d", adjusted = false) {
  for (let tries = 0; tries < 4; tries++) {
    const res = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${fromUnix}&period2=${Math.floor(Date.now() / 1e3)}&interval=${interval}`, { headers: UA2, signal: AbortSignal.timeout(2e4) });
    if (res.status === 429) {
      await sleep(15e3 * (tries + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${symbol}`);
    return parseYahooChart(await res.json(), { adjusted });
  }
  throw new Error(`Too many requests for ${symbol}`);
}
async function searchYahooSymbol(isin) {
  const res = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${isin}&quotesCount=3&newsCount=0`, { headers: UA2, signal: AbortSignal.timeout(15e3) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return j.quotes?.find((q) => q.quoteType === "MUTUALFUND" || q.quoteType === "ETF")?.symbol ?? null;
}
var FX_TO_NOK = { USD: "NOK=X", EUR: "EURNOK=X", SEK: "SEKNOK=X", GBP: "GBPNOK=X", DKK: "DKKNOK=X", CHF: "CHFNOK=X", JPY: "JPYNOK=X" };
function toNok(points, fx) {
  if (!fx) return points;
  return points.flatMap((p) => {
    const i = indexAtOrBefore(fx, p.date);
    return i < 0 ? [] : [{ date: p.date, nav: p.nav * fx[i].nav }];
  });
}
var years = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
var weeklyRet = (m, weeks) => weeks.slice(1).map((w, i) => m.get(w) / m.get(weeks[i]) - 1);
async function buildFactorData() {
  const t1950 = Math.floor(Date.parse("1950-01-01") / 1e3);
  const t1985 = Math.floor(Date.parse("1985-01-01") / 1e3);
  const syms = [...new Set(GENERIC_FACTORS.map((g) => g.symbol))];
  const daily = {};
  for (const s of syms) {
    daily[s] = (await fetchYahoo(s, s === "^GSPC" ? t1950 : t1985)).points;
    await sleep(300);
  }
  const tr = (await fetchYahoo("^SP500TR", t1985)).points;
  const curve = {};
  for (const s of ["^IRX", "^FVX", "^TYX"]) {
    curve[s] = (await fetchYahoo(s, Math.floor(Date.now() / 1e3) - 30 * 86400)).points;
    await sleep(300);
  }
  const wm = Object.fromEntries(syms.map((s) => [s, weeklyLast(daily[s])]));
  const cutoff = weekKey(new Date(Date.now() - 5.3 * 365 * 864e5).toISOString().slice(0, 10));
  const weeks = [...wm["^GSPC"].keys()].filter((w) => w >= cutoff && syms.every((s) => wm[s].has(w))).sort();
  const weekly = Object.fromEntries(syms.map((s) => [s, weeks.map((w) => wm[s].get(w))]));
  const residSlope = {};
  const prediction = {};
  const explain = {};
  const pct = (x) => `${(x * 100).toFixed(1).replace("-", "\u2212")}%`;
  for (const g of GENERIC_FACTORS.filter((x) => x.kind === "resid")) {
    const common = [...wm[g.symbol].keys()].filter((w) => wm["^GSPC"].has(w)).sort();
    const ri = weeklyRet(wm[g.symbol], common);
    const rm = weeklyRet(wm["^GSPC"], common);
    const fit = ols(ri, rm.map((m) => [1, m]));
    residSlope[g.key] = fit.b[1];
    prediction[g.key] = fit.b[0] * 52;
    explain[g.key] = `Average of ${g.label.split(" (")[1]?.replace(")", "") ?? g.symbol} beyond what the S&P 500 explains, ${common[0].slice(0, 4)}\u2013${common[common.length - 1].slice(0, 4)}: ${pct(prediction[g.key])} per year.`;
  }
  const mk = Math.pow(tr[tr.length - 1].nav / tr[0].nav, 1 / years(tr[0].date, tr[tr.length - 1].date)) - 1;
  prediction.marked = mk;
  explain.marked = `The S&P 500 including dividends has returned ${pct(mk)} per year on average from ${tr[0].date.slice(0, 4)} to ${tr[tr.length - 1].date.slice(0, 4)}.`;
  prediction.dollar = 0;
  explain.dollar = 'Unchanged USD rate: "no change" beats other currency forecasts over one year.';
  prediction.olje = 0;
  explain.olje = 'Unchanged oil price: like currencies, oil is close to a random walk, so "no change" is the best simple forecast.';
  prediction.euro = 0;
  explain.euro = "Unchanged EUR rate, for the same reason as the dollar.";
  const last = (p) => p[p.length - 1].nav;
  const c = { date: daily["^TNX"].at(-1).date, y3m: last(curve["^IRX"]), y5: last(curve["^FVX"]), y10: last(daily["^TNX"]), y30: last(curve["^TYX"]) };
  const rate = impliedRateChange(c);
  prediction.rente = rate.change;
  explain.rente = `The yield curve (${c.date}) prices the 10-year yield moving from ${c.y10.toFixed(2)}% to ${rate.forward.toFixed(2)}% in one year.`;
  const { events, years: crashYears } = findCrashes(daily["^GSPC"], 0.2);
  return {
    asOf: (/* @__PURE__ */ new Date()).toISOString(),
    weeks,
    weekly,
    residSlope,
    prediction,
    explain,
    crashes: events,
    crashYears,
    crashFrom: daily["^GSPC"][0].date,
    recent: Object.fromEntries(syms.map((s) => [s, daily[s].slice(-15)]))
  };
}
function packSeries(points) {
  const d = [];
  let prev = Date.parse(points[0].date);
  for (const p of points) {
    const t = Date.parse(p.date);
    d.push(Math.round((t - prev) / 864e5));
    prev = t;
  }
  const b = points[0].nav;
  const moves = points.slice(1).map((p, i) => Math.abs(Math.log(p.nav / points[i].nav))).filter((x) => x > 0).sort((x, y) => x - y);
  const med = moves.length ? moves[moves.length >> 1] : 0.01;
  const k = Math.min(8, Math.max(4, Math.ceil(Math.log10(100 / med))));
  const scale = 10 ** k;
  let last = 0;
  const v = points.map((p) => {
    const L = Math.round(Math.log(p.nav / b) * scale);
    const dv = L - last;
    last = L;
    return dv;
  });
  return { s: points[0].date, d, b: Number(b.toPrecision(8)), k, v };
}
function parseEuronextCsv(csv) {
  const out = [];
  for (const line of csv.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const cells = line.match(/("([^"]*)"|[^;]*)(;|$)/g)?.map((c) => c.replace(/;$/, "").replace(/^"|"$/g, "").trim()) ?? [];
    if (cells.length < 5 || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(cells[1])) continue;
    out.push({ name: cells[0], isin: cells[1], symbol: cells[2], market: cells[3], currency: cells[4] });
  }
  return out;
}
var EURONEXT_OSLO_CSV = "https://live.euronext.com/en/pd_es/data/stocks/download?mics=XOSL%2CMERK%2CXOAS";
async function fetchOsloStocks() {
  const res = await fetch(EURONEXT_OSLO_CSV, { headers: UA2, signal: AbortSignal.timeout(3e4) });
  if (!res.ok) throw new Error(`Euronext returned HTTP ${res.status}`);
  return parseEuronextCsv(await res.text());
}
var yahooOsloSymbol = (ticker) => `${ticker.trim().replace(/\s+/g, "-")}.OL`;
function cutAtCorporateActions(points) {
  let cut = -1;
  for (let i = 1; i < points.length; i++) {
    const r = points[i].nav / points[i - 1].nav - 1;
    if (r < -0.75 || r > 3) cut = i;
  }
  return cut < 0 ? { points, cutDate: null } : { points: points.slice(cut), cutDate: points[cut].date };
}
async function fetchUsStocks(minCap) {
  const res = await fetch("https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true", { headers: { ...UA2, Accept: "application/json" }, signal: AbortSignal.timeout(6e4) });
  if (!res.ok) throw new Error(`Nasdaq returned HTTP ${res.status}`);
  const j = await res.json();
  return j.data.rows.map((r) => ({ symbol: r.symbol.trim(), name: cleanUsName(r.name), marketCap: Number(r.marketCap) || 0, country: r.country || "", sector: r.sector || "", industry: r.industry || "" })).filter((r) => r.marketCap >= minCap && /^[A-Z]+([./][A-Z]+)?$/.test(r.symbol)).sort((a, b) => b.marketCap - a.marketCap);
}
async function fetchUsEtfs() {
  const res = await fetch("https://api.nasdaq.com/api/screener/etf?tableonly=true&download=true", { headers: { ...UA2, Accept: "application/json" }, signal: AbortSignal.timeout(6e4) });
  if (!res.ok) throw new Error(`Nasdaq returned HTTP ${res.status}`);
  const j = await res.json();
  const rows = j.data.data?.rows ?? j.data.rows ?? [];
  const leveraged = /\b(\d(\.\d+)?x|bull|bear|ultra(pro|short)?|inverse|short(?![- ](term|duration|maturity|dated|treasury|bond|income|government|corporate|high|municipal))|leverage[ds]?|daily)\b/i;
  return rows.map((r) => ({ symbol: r.symbol.trim(), name: r.companyName.trim() })).filter((r) => /^[A-Z]+$/.test(r.symbol) && !leveraged.test(r.name));
}
var yahooUsSymbol = (s) => s.replace(/[./]/g, "-");
function cleanUsName(n) {
  return n.replace(/\s+(Common Stock|Ordinary Shares|Class [A-C] (Common Stock|Ordinary Shares)|American Depositary Shares?|Common Shares|Depositary Shares).*$/i, "").trim();
}
async function pool(items, workers, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

// artifact/pipeline.ts
var DNB_URL = "https://www.dnb.no/sparing/fond/fond-liste/d/dnb-teknologi-a-NO0010337678";
var CHUNK = 32;
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
var US_MIN_CAP = { full: 1, claude: 2e9 };
var WORLD_MIN_TURNOVER = 1e6;
var WORLD_ETFS = { EU: 300, JP: 80, HK: 80 };
var US_ETF_COUNT = 1e3;
var WORKERS = 6;
var DISPLAY_CURRENCIES = ["NOK", "EUR", "USD", "GBP", "SEK", "DKK", "ISK", "CHF", "PLN", "CZK", "HUF", "RON", "TRY", "JPY", "CNY", "HKD", "SGD", "KRW", "TWD", "INR", "IDR", "MYR", "THB", "PHP", "VND", "AUD", "NZD", "CAD", "MXN", "BRL", "ARS", "CLP", "COP", "PEN", "ZAR", "EGP", "NGN", "KES", "MAD", "ILS", "AED", "SAR", "QAR", "KWD", "PKR", "BDT", "UAH"];
var NORDNET_FUNDS = [
  { name: "Nordnet Norge Indeks", symbol: "0P000134K7.IR", type: "AKSJEFOND", region: "NORGE", cost: null },
  { name: "Nordnet Global Indeks NOK", symbol: "0P0001K6NJ.IR", type: "AKSJEFOND", region: "GLOBAL", cost: null },
  { name: "Nordnet Global Indeks 125 NOK", symbol: "0P0001RMV1.IR", type: "AKSJEFOND", region: "GLOBAL", cost: null },
  { name: "Nordnet USA Indeks NOK", symbol: "0P0001K6NN.IR", type: "AKSJEFOND", region: "USA", cost: null },
  { name: "Nordnet Europa Indeks NOK", symbol: "0P0001K6NF.IR", type: "AKSJEFOND", region: "EUROPA", cost: null },
  { name: "Nordnet Emerging Markets Indeks", symbol: "0P0001K6NB.IR", type: "AKSJEFOND", region: "ASIA", cost: null },
  { name: "Nordnet Teknologi Indeks NOK", symbol: "0P0001M5YQ.IR", type: "AKSJEFOND", region: "GLOBAL", cost: null },
  { name: "Nordnet Sverige Index", symbol: "0P0000J24W.ST", type: "AKSJEFOND", region: "NORDEN", cost: null },
  { name: "Nordnet Suomi Indeksi", symbol: "0P000134K9.F", type: "AKSJEFOND", region: "NORDEN", cost: null },
  { name: "Nordnet Danmark Indeks A", symbol: "0P000134KA.CO", type: "AKSJEFOND", region: "NORDEN", cost: null },
  { name: "Nordnet One Offensiv NOK", symbol: "0P0001PDI1.IR", type: "KOMBINASJONSFOND", region: "GLOBAL", cost: null }
];
async function run(outDir, symbolsIn, opts = {}) {
  const scope2 = opts.scope ?? "full";
  const usMinCap = US_MIN_CAP[scope2];
  fs.mkdirSync(outDir, { recursive: true });
  const log = (...a) => console.log((/* @__PURE__ */ new Date()).toISOString().slice(11, 19), ...a);
  const html = await (await fetch(DNB_URL, { headers: { "User-Agent": "Mozilla/5.0 (compatible; QuantAnalytics/1.0)" } })).text();
  let list = parseDnbFundList(html);
  if (list.length < 100) throw new Error(`Fondslisten fra DNB er for kort (${list.length})`);
  if (!list.some((f) => f.isin === "NO0010337678")) list.push({ isin: "NO0010337678", fundName: "DNB Teknologi A", companyName: "DNB Asset Management AS", fundType: "AKSJEFOND", sector: "TEKNOLOGI", region: "GLOBAL" });
  list = list.sort((a, b) => a.isin.localeCompare(b.isin));
  if (opts.limit) list = list.slice(0, opts.limit);
  const dnbTek = await fetchDnbFundPage(DNB_URL, "NO0010337678", 0);
  log("fond i listen:", list.length);
  const symbols2 = symbolsIn && fs.existsSync(symbolsIn) ? JSON.parse(fs.readFileSync(symbolsIn, "utf8")) : {};
  for (const f of FUNDS) if (!symbols2[f.isin]) symbols2[f.isin] = f.yahooSymbol;
  let searches = 0;
  for (const f of list) {
    if (symbols2[f.isin] !== void 0 || searches >= (opts.maxNewSearches ?? 60)) continue;
    try {
      symbols2[f.isin] = await searchYahooSymbol(f.isin);
    } catch {
    }
    searches++;
    await sleep2(1200);
  }
  fs.writeFileSync(path.join(outDir, "symbols.json"), JSON.stringify(symbols2));
  log("nye symbols\xF8k:", searches);
  const factors = await buildFactorData();
  fs.writeFileSync(path.join(outDir, "factors.json"), JSON.stringify(factors));
  log("faktorer:", factors.weeks.length, "uker, krakk:", factors.crashes.length);
  const from = Math.floor((Date.now() - 5.2 * 365 * 864e5) / 1e3);
  const fx = {};
  for (const [c, s] of Object.entries(FX_TO_NOK)) {
    fx[c] = (await fetchYahoo(s, from - 30 * 86400)).points;
    await sleep2(200);
  }
  const displayFx = { NOK: 1 };
  const recentFrom = Math.floor((Date.now() - 10 * 864e5) / 1e3);
  const nokPerUsd = fx.USD?.at(-1)?.nav;
  if (nokPerUsd) {
    displayFx.USD = nokPerUsd;
    await pool(DISPLAY_CURRENCIES.filter((c) => c !== "USD" && c !== "NOK"), 4, async (c) => {
      try {
        const p = (await fetchYahoo(`${c}=X`, recentFrom)).points.at(-1)?.nav;
        if (p && p > 0) displayFx[c] = nokPerUsd / p;
      } catch {
      }
      await sleep2(100);
    });
  }
  log("visningsvalutaer:", Object.keys(displayFx).length);
  const index = [];
  const chunks = [];
  let withData = 0;
  const counts = { fund: { ok: 0, none: 0 }, stock: { ok: 0, none: 0 } };
  const fxPending = /* @__PURE__ */ new Map();
  function fxFor(cur) {
    if (!fxPending.has(cur)) fxPending.set(cur, (async () => {
      try {
        const direct = (await fetchYahoo(`${cur}NOK=X`, from - 30 * 86400)).points;
        if (direct.length > 500) return direct;
      } catch {
      }
      try {
        const perUsd = (await fetchYahoo(`${cur}=X`, from - 30 * 86400)).points;
        if (perUsd.length < 500 || !fx.USD) return null;
        return toNok(perUsd.map((p) => ({ date: p.date, nav: 1 / p.nav })), fx.USD);
      } catch {
        return null;
      }
    })());
    return fxPending.get(cur);
  }
  async function processAsset(base, sym, adjusted, fixName = false) {
    const c = counts[base.kind];
    if (!sym) {
      index.push({ ...base, status: "ingen-data", reason: "No price history found" });
      c.none++;
      return;
    }
    try {
      const y = await fetchYahoo(sym, from, "1d", adjusted);
      if (fixName && y.name) base.name = y.name;
      const cur = y.currency ?? "NOK";
      if (cur !== "NOK" && !fx[cur]) {
        const series = await fxFor(cur);
        if (!series) {
          index.push({ ...base, status: "ingen-data", reason: `Unknown currency ${cur}` });
          c.none++;
          return;
        }
        fx[cur] = series;
      }
      let points = cur === "NOK" ? y.points : toNok(y.points, fx[cur]);
      if (base.isin === "NO0010337678") points = mergeLatest(points, dnbTek).points;
      if (base.kind === "stock" || base.market !== "no") {
        const cut = cutAtCorporateActions(points);
        if (cut.cutDate) {
          points = cut.points;
          base.note = `Price history starts ${cut.cutDate} because of a likely corporate action (price change of more than \u221275% or +300% in one day).`;
        }
      }
      if (points.length < 60) {
        index.push({ ...base, status: "ingen-data", reason: "Price history too short" });
        c.none++;
        return;
      }
      const chunk = Math.floor(withData / CHUNK);
      withData++;
      (chunks[chunk] ??= []).push({ isin: base.isin, currency: cur, series: packSeries(points) });
      const model = buildGenericModel(points, factors, { useAlpha: base.kind !== "stock" });
      const last = points[points.length - 1];
      const tr = trailingReturns(points);
      const hist = { "1Y": tr["1Y"]?.total ?? null, "3Y": tr["3Y"]?.annualized ?? null, YTD: tr.YTD?.total ?? null };
      if (!model) {
        index.push({ ...base, status: "kort", reason: "Less than one year of weekly data", chunk, currency: cur, lastDate: last.date, lastNav: last.nav, hist });
        c.ok++;
        return;
      }
      const h = predictHorizons(model.start, model.annualReturn, model.sigma, model.shock, 600, 20240505, model.reversal?.shift ?? 0);
      index.push({
        ...base,
        status: "ok",
        chunk,
        currency: cur,
        lastDate: last.date,
        lastNav: last.nav,
        hist,
        R: model.annualReturn,
        sigma: model.sigma,
        r2: model.regression.r2,
        betaMarked: model.betas.marked,
        estimated: model.nowcast ? { date: model.nowcast.date, ret: model.nowcast.ret } : null,
        pred: Object.fromEntries(h.map((x) => [x.key, { m: x.median, lo: x.p10, hi: x.p90, up: x.probUp, d: x.date, a: x.annualized }]))
      });
      c.ok++;
    } catch (e) {
      index.push({ ...base, status: "feil", reason: e.message });
      c.none++;
    }
  }
  await pool(list, WORKERS, async (f) => {
    await processAsset({
      kind: "fund",
      market: "no",
      country: "NO",
      isin: f.isin,
      name: f.fundName,
      company: f.companyName,
      type: f.fundType,
      sector: f.sector ?? null,
      region: f.region ?? null,
      risk: f.riskScore ?? null,
      cost: f.totalCostPercent ? Number(f.totalCostPercent) : null,
      index: f.isIndexFund ?? false,
      symbol: symbols2[f.isin] ?? null
    }, symbols2[f.isin] ?? null, false);
    await sleep2(100);
    if ((counts.fund.ok + counts.fund.none) % 100 === 0) log("fond behandlet:", counts.fund.ok + counts.fund.none);
  });
  for (const n of NORDNET_FUNDS) {
    if (opts.limit) break;
    await processAsset({
      kind: "fund",
      market: "no",
      country: "NO",
      isin: `NN-${n.symbol}`,
      name: n.name,
      company: "Nordnet",
      type: n.type,
      sector: null,
      region: n.region,
      risk: null,
      cost: n.cost,
      index: n.type === "AKSJEFOND",
      symbol: n.symbol
    }, n.symbol, false);
    await sleep2(100);
  }
  const norwayFunds = { ...counts.fund };
  let stocks = [];
  try {
    stocks = await fetchOsloStocks();
  } catch (e) {
    log("aksjeliste feilet:", e.message);
  }
  if (opts.limit) stocks = stocks.slice(0, opts.limit);
  log("aksjer i listen:", stocks.length);
  await pool(stocks, WORKERS, async (st) => {
    const sym = yahooOsloSymbol(st.symbol);
    await processAsset({
      kind: "stock",
      market: "oslo",
      country: "NO",
      isin: st.isin,
      name: st.name,
      company: st.market,
      type: "AKSJE",
      sector: null,
      region: "NORGE",
      risk: null,
      cost: null,
      index: false,
      symbol: sym,
      ticker: st.symbol
    }, sym, true, true);
    await sleep2(100);
  });
  const osloStocks = { ...counts.stock };
  let usStocks = [];
  let usEtfs = [];
  if (!opts.skipUs) {
    for (let attempt = 0; attempt < 3 && !usStocks.length; attempt++) {
      try {
        usStocks = await fetchUsStocks(1);
      } catch (e) {
        log("USA-aksjeliste feilet:", e.message);
        await sleep2(5e3);
      }
    }
    if (usStocks.length > 500) symbols2["us-aksjer"] = JSON.stringify(usStocks.map((s) => [s.symbol, s.name, s.marketCap, s.country, s.sector]));
    else if (symbols2["us-aksjer"]) {
      usStocks = JSON.parse(symbols2["us-aksjer"]).map(([symbol, name, marketCap, country, sector]) => ({ symbol, name, marketCap, country, sector, industry: "" }));
      log("bruker lagret USA-aksjeliste:", usStocks.length);
    }
    usStocks = usStocks.filter((s) => s.marketCap >= usMinCap);
    fs.writeFileSync(path.join(outDir, "symbols.json"), JSON.stringify(symbols2));
    if (opts.limit) usStocks = usStocks.slice(0, opts.limit);
    log("USA-aksjer i listen:", usStocks.length);
    await pool(usStocks, WORKERS, async (st) => {
      const sym = yahooUsSymbol(st.symbol);
      await processAsset({
        kind: "stock",
        market: "us",
        country: countryCode(st.country) ?? "US",
        isin: `US-${sym}`,
        name: st.name,
        company: st.country && st.country !== "United States" ? `USA-listed \xB7 ${st.country}` : "USA",
        type: "AKSJE",
        sector: st.sector || null,
        region: "USA",
        risk: null,
        cost: null,
        index: false,
        symbol: sym,
        ticker: st.symbol,
        marketCap: st.marketCap
      }, sym, true);
      await sleep2(100);
      if ((counts.stock.ok + counts.stock.none) % 250 === 0) log("aksjer behandlet:", counts.stock.ok + counts.stock.none);
    });
    const picked = Object.keys(symbols2).filter((k) => k.startsWith("etf:")).map((k) => k.slice(4));
    const stamp = symbols2["etf-utvalg"] ?? "";
    const stale = !stamp || Date.now() - Date.parse(stamp) > 30 * 864e5 || picked.length < 100;
    let names = {};
    try {
      const all = await fetchUsEtfs();
      names = Object.fromEntries(all.map((e) => [e.symbol, e.name]));
      if (stale) usEtfs = all;
    } catch (e) {
      log("ETF-liste feilet:", e.message);
    }
    if (stale && usEtfs.length) {
      log("velger ETF-er blant", usEtfs.length);
      const turnover = [];
      const recent = Math.floor((Date.now() - 100 * 864e5) / 1e3);
      await pool(opts.limit ? usEtfs.slice(0, opts.limit * 3) : usEtfs, 6, async (e) => {
        try {
          const y = await fetchYahoo(e.symbol, recent);
          if (y.dollarVolume) turnover.push({ symbol: e.symbol, dv: y.dollarVolume });
        } catch {
        }
        await sleep2(50);
      });
      const top = turnover.sort((a, b) => b.dv - a.dv).slice(0, opts.limit ?? US_ETF_COUNT);
      for (const k of Object.keys(symbols2)) if (k.startsWith("etf:")) delete symbols2[k];
      for (const t of top) symbols2[`etf:${t.symbol}`] = t.symbol;
      symbols2["etf-utvalg"] = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      fs.writeFileSync(path.join(outDir, "symbols.json"), JSON.stringify(symbols2));
    }
    usEtfs = Object.keys(symbols2).filter((k) => k.startsWith("etf:")).map((k) => ({ symbol: k.slice(4), name: names[k.slice(4)] ?? k.slice(4) }));
    log("USA-ETF-er:", usEtfs.length);
    await pool(usEtfs, WORKERS, async (e) => {
      await processAsset({
        kind: "fund",
        market: "us",
        country: "US",
        isin: `US-${e.symbol}`,
        name: e.name,
        company: "US ETF",
        type: "ETF",
        sector: null,
        region: "USA",
        risk: null,
        cost: null,
        index: false,
        symbol: e.symbol,
        ticker: e.symbol
      }, e.symbol, true, !names[e.symbol]);
      await sleep2(100);
    });
  }
  let world = [];
  if (scope2 === "full" && !opts.skipUs) {
    const stamp = symbols2["verden-utvalg"] ?? "";
    if (symbols2["verden"] && stamp && Date.now() - Date.parse(stamp) < 30 * 864e5) world = JSON.parse(symbols2["verden"]);
    else {
      const candidates = [];
      for (const [name, fn] of WORLD_SOURCES) {
        try {
          const l = await fn();
          candidates.push(...l);
          log(`liste ${name}:`, l.length);
        } catch (e) {
          log(`liste ${name} feilet:`, e.message);
        }
      }
      const pick = opts.limit ? candidates.filter((_, i) => i % Math.ceil(candidates.length / (opts.limit * 10)) === 0) : candidates;
      log("velger blant", pick.length, "aksjer og ETF-er i Europa, Asia og Oseania");
      const recent = Math.floor((Date.now() - 100 * 864e5) / 1e3);
      const turnover = /* @__PURE__ */ new Map();
      await pool(pick, 8, async (c) => {
        try {
          const y = await fetchYahoo(c.symbol, recent);
          const rate = displayFx[y.currency ?? ""] ?? (y.currency === "GBp" ? (displayFx.GBP ?? 0) / 100 : 0);
          if (y.dollarVolume && rate && displayFx.USD) turnover.set(c.symbol, y.dollarVolume * rate / displayFx.USD);
        } catch {
        }
        await sleep2(30);
      });
      const failed = /* @__PURE__ */ new Set();
      for (let round = 0; round < 3; round++) {
        const retry = pick.filter((c) => !turnover.has(c.symbol) && !failed.has(c.symbol));
        if (!retry.length) break;
        log(`ny runde ${round + 1} for`, retry.length);
        await sleep2(3e4);
        await pool(retry, 3, async (c) => {
          try {
            const y = await fetchYahoo(c.symbol, recent);
            const rate = displayFx[y.currency ?? ""] ?? (y.currency === "GBp" ? (displayFx.GBP ?? 0) / 100 : 0);
            if (y.dollarVolume && rate && displayFx.USD) turnover.set(c.symbol, y.dollarVolume * rate / displayFx.USD);
            else failed.add(c.symbol);
          } catch (e) {
            if (!/Too many|429/.test(e.message)) failed.add(c.symbol);
          }
          await sleep2(150);
        });
      }
      const stocks2 = pick.filter((c) => c.kind === "stock" && (turnover.get(c.symbol) ?? 0) >= (opts.limit ? 0 : WORLD_MIN_TURNOVER));
      const etfs = Object.entries(WORLD_ETFS).flatMap(([country, n]) => pick.filter((c) => c.kind === "fund" && c.country === country && turnover.has(c.symbol)).sort((a, b) => turnover.get(b.symbol) - turnover.get(a.symbol)).slice(0, opts.limit ?? n));
      world = [...stocks2, ...etfs];
      if (world.length > (opts.limit ? 0 : 500)) {
        symbols2["verden"] = JSON.stringify(world);
        symbols2["verden-utvalg"] = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      }
      fs.writeFileSync(path.join(outDir, "symbols.json"), JSON.stringify(symbols2));
    }
    log("Europa/Asia/Oseania:", world.length);
    const seen = new Set(index.map((x) => String(x.isin)));
    await pool(world, WORKERS, async (c) => {
      const id = c.isin && !seen.has(c.isin) ? c.isin : `X-${c.symbol}`;
      seen.add(id);
      const area = COUNTRIES[c.country]?.region ?? "europe";
      await processAsset({
        kind: c.kind,
        market: area,
        country: c.country,
        isin: id,
        name: c.name,
        company: c.exchange,
        type: c.kind === "stock" ? "AKSJE" : "ETF",
        sector: c.sector ?? null,
        region: null,
        risk: null,
        cost: null,
        index: false,
        symbol: c.symbol,
        ticker: c.symbol.replace(/\.[A-Z]+$/, "")
      }, c.symbol, true, c.kind === "fund");
      await sleep2(60);
      if ((counts.stock.ok + counts.stock.none + counts.fund.ok + counts.fund.none) % 500 === 0) log("behandlet totalt:", counts.stock.ok + counts.stock.none + counts.fund.ok + counts.fund.none);
    });
  }
  chunks.forEach((c, i) => fs.writeFileSync(path.join(outDir, `funds-${String(i).padStart(2, "0")}.json`), JSON.stringify(c)));
  const byMarket = {};
  for (const x of index) if (x.status === "ok" || x.status === "kort") {
    const m = String(x.market);
    (byMarket[m] ??= { fund: 0, stock: 0 })[x.kind]++;
  }
  const meta2 = {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    total: list.length + (opts.limit ? 0 : NORDNET_FUNDS.length),
    withData: norwayFunds.ok,
    withoutData: norwayFunds.none,
    stocksTotal: stocks.length,
    stocksWithData: osloStocks.ok,
    stocksWithoutData: osloStocks.none,
    usStocksTotal: usStocks.length,
    usStocksWithData: byMarket.us?.stock ?? 0,
    usEtfsTotal: usEtfs.length,
    usEtfsWithData: byMarket.us?.fund ?? 0,
    usMinCap,
    worldTotal: world.length,
    byMarket,
    scope: scope2,
    fx: displayFx,
    chunks: chunks.length,
    source: "Funds: DNB fund list, Nordnet, Nasdaq (US ETFs), Xetra, JPX and HKEX (ETFs) \xB7 Stocks: Euronext, Nasdaq, Nasdaq Nordic, Xetra, SIX, JPX, HKEX, NSE India and ASX \xB7 Prices: Yahoo Finance"
  };
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify({ meta: meta2, funds: index }));
  log("ferdig:", meta2);
  return meta2;
}

// artifact/fetch-snapshot.ts
import fs2 from "node:fs";

// lib/holdings.ts
var HOLDINGS_SNAPSHOT = {
  asOf: "2026-09-30",
  source: "DNB Asset Management \u2013 DNB Fund Technology fact sheet (same team and mandate)",
  sourceUrl: "https://dnbam.com/en/our-funds/funds/dnb-fund-technology?isin=LU1047850778",
  crossCheck: "DNB's fund page for DNB Teknologi A: Microsoft 9.7%, NVIDIA 6.1% (NAV date 2 Nov 2026)",
  benchmark: "MSCI World Communication Services & Information Technology",
  managers: ["Anders Tandberg-Johansen (lead)", "Erling Thune", "Sverre Bergland", "Erling Haugan Kise", "Marius Wennersten", "Ola S\xE6ther"],
  typicalHoldings: "40\u201360 companies",
  top: [
    { name: "Microsoft", symbol: "MSFT", isin: "US5949181045", currency: "USD", weight: 0.0939 },
    { name: "Alphabet", symbol: "GOOGL", isin: "US02079K3059", currency: "USD", weight: 0.0694 },
    { name: "Nvidia", symbol: "NVDA", isin: "US67066G1040", currency: "USD", weight: 0.0604, activeWeight: -0.0844 },
    { name: "Amazon", symbol: "AMZN", isin: "US0231351067", currency: "USD", weight: 0.0501, activeWeight: 0.0499 },
    { name: "Meta Platforms", symbol: "META", isin: "US30303M1027", currency: "USD", weight: 0.0452 },
    { name: "Broadcom", symbol: "AVGO", isin: "US11135F1012", currency: "USD", weight: 0.0437 },
    { name: "Visa", symbol: "V", isin: "US92826C8394", currency: "USD", weight: 0.0387, activeWeight: 0.0396 },
    { name: "Mastercard", symbol: "MA", isin: "US57636Q1040", currency: "USD", weight: 0.0367, activeWeight: 0.0377 },
    { name: "Ericsson", symbol: "ERIC-B.ST", isin: "SE0000108656", currency: "SEK", weight: 0.0332, activeWeight: 0.0331 },
    { name: "Adyen", symbol: "ADYEN.AS", isin: "NL0012969182", currency: "EUR", weight: 0.0307, activeWeight: 0.0306 }
  ],
  /** Største undervekter mot indeks som ikke er blant topp 10 (aktiv vekt, fondet minus indeks) */
  underweightsOutsideTop: [
    { name: "Apple", symbol: "AAPL", currency: "USD", weight: 0, activeWeight: -0.1341 },
    { name: "Micron Technology", symbol: "MU", currency: "USD", weight: 0, activeWeight: -0.0334 },
    { name: "AMD", symbol: "AMD", currency: "USD", weight: 0, activeWeight: -0.0275 }
  ],
  /** Alphabet C-aksjen er undervektet med 4,14 pp (fondet eier Alphabet via A-aksjen) */
  alphabetCActive: -0.0414,
  sectors: [
    ["Software & services", 0.2279],
    ["Semiconductors & equipment", 0.2068],
    ["Media & entertainment", 0.1728],
    ["Technology hardware", 0.12],
    ["Financials (payments)", 0.106],
    ["E-commerce", 0.0501],
    ["Consumer durables", 0.0385],
    ["Telecom", 0.0286],
    ["Consumer services", 0.0124]
  ],
  countries: [
    ["USA", 0.6293],
    ["Sweden", 0.0669],
    ["South Korea", 0.0483],
    ["Netherlands", 0.043],
    ["France", 0.0387],
    ["Japan", 0.0333],
    ["Germany", 0.0274],
    ["Taiwan", 0.0238],
    ["Switzerland", 0.0172],
    ["Norway", 0.0147]
  ]
};
var FX_SYMBOLS = { USD: "NOK=X", SEK: "SEKNOK=X", EUR: "EURNOK=X" };
function allHoldingSymbols() {
  return [...HOLDINGS_SNAPSHOT.top, ...HOLDINGS_SNAPSHOT.underweightsOutsideTop];
}

// lib/data/holdingsData.ts
async function getHoldingsPanel(fund, revalidateSeconds = 21600) {
  const holdings = allHoldingSymbols();
  const fxEntries = await Promise.all(
    Object.entries(FX_SYMBOLS).map(async ([c, s]) => [c, await fetchYahooNav(s, { currency: "NOK", revalidateSeconds })])
  );
  const stocks = await Promise.all(
    holdings.map(async (h) => [h.symbol, { currency: h.currency, points: await fetchYahooNav(h.symbol, { currency: h.currency, revalidateSeconds }) }])
  );
  const factorSymbols = [...new Set(FACTORS.map((f) => f.symbol))];
  const factors = await Promise.all(
    factorSymbols.map(async (s) => [s, { currency: "NOK", points: await fetchYahooNav(s, { currency: s === "NOK=X" ? "NOK" : "USD", revalidateSeconds }) }])
  );
  return buildWeeklyPanel(fund, { ...Object.fromEntries(stocks), ...Object.fromEntries(factors) }, Object.fromEntries(fxEntries));
}
async function getMacroData(revalidateSeconds = 21600) {
  const [ndxMonthly, ndxDaily, sox, usdnok, y3m, y5, y10, y30] = await Promise.all([
    fetchYahooNav("^NDX", { currency: "USD", interval: "1mo", revalidateSeconds }),
    fetchYahooNav("^NDX", { currency: "USD", revalidateSeconds }),
    fetchYahooNav("^SOX", { currency: "USD", revalidateSeconds }),
    fetchYahooNav("NOK=X", { currency: "NOK", revalidateSeconds }),
    ...["^IRX", "^FVX", "^TNX", "^TYX"].map((s) => fetchYahooNav(s, { currency: "USD", revalidateSeconds }))
  ]);
  const last = (p) => p[p.length - 1];
  const tail = (p) => p.slice(-15);
  const { events, years: years2 } = findCrashes(ndxDaily, 0.2);
  return {
    ndxMonthly,
    crashes: events,
    crashYears: years2,
    crashFrom: ndxDaily[0].date,
    recent: { ndx: tail(ndxDaily), sox: tail(sox), usdnok: tail(usdnok), tnx: tail(y10) },
    curve: { date: last(y10).date, y3m: last(y3m).nav, y5: last(y5).nav, y10: last(y10).nav, y30: last(y30).nav }
  };
}
async function getModelInput(fund, revalidateSeconds = 21600) {
  try {
    const [panel, macro] = await Promise.all([getHoldingsPanel(fund, revalidateSeconds), getMacroData(revalidateSeconds)]);
    return { input: { panel, macro } };
  } catch (e) {
    return { input: null, error: e.message };
  }
}

// artifact/fetch-snapshot.ts
async function run2(outFile) {
  const yahoo = await fetchYahooNav(FUNDS[0].yahooSymbol, { revalidateSeconds: 0 });
  const dnb = await fetchDnbFundPage(FUNDS[0].dnbPageUrl, FUNDS[0].isin, 0);
  const { points, added } = mergeLatest(yahoo, dnb);
  const rounded = points.map((p) => ({ date: p.date, nav: Math.round(p.nav * 1e4) / 1e4 }));
  const { input, error } = await getModelInput(points, 0);
  if (!input) throw new Error(`Modelldata mangler: ${error}`);
  const { panel, macro } = input;
  for (const k of Object.keys(panel.prices)) panel.prices[k] = panel.prices[k].map((x) => Math.round(x * 1e6) / 1e6);
  const dnbHoldings = dnb?.holdings.length ? dnb.holdings : null;
  fs2.writeFileSync(outFile, JSON.stringify({ fetchedAt: (/* @__PURE__ */ new Date()).toISOString(), points: rounded, dnbAdded: added, model: { panel, macro, dnbHoldings, dnbFetchedAt: dnb?.fetchedAt ?? null } }));
  return {
    dnbAdded: added,
    dnbHoldings: dnbHoldings?.length ?? 0,
    n: rounded.length,
    first: rounded[0].date,
    last: rounded.at(-1).date,
    weeks: panel.weeks.length,
    series: Object.keys(panel.prices).length
  };
}

// artifact/embed.ts
import fs3 from "node:fs";
import path2 from "node:path";
import zlib2 from "node:zlib";
var DATA_MARK = "/*__FP_DATA__*/";
var CHUNK2 = 32;
function readAll(dir2) {
  const read = (f) => JSON.parse(fs3.readFileSync(path2.join(dir2, f), "utf8"));
  const chunkFiles = fs3.readdirSync(dir2).filter((f) => /^funds-\d+\.json$/.test(f)).sort();
  const holdings = fs3.existsSync(path2.join(dir2, "data.json")) ? read("data.json") : null;
  return { index: read("index.json"), factors: read("factors.json"), chunkFiles, holdings, read };
}
var gzB64 = (x) => zlib2.gzipSync(JSON.stringify(x), { level: 9 }).toString("base64");
function fillTemplate(template2, dir2) {
  if (!template2.includes(DATA_MARK)) throw new Error("Malen mangler datamerket");
  const { index, factors, chunkFiles, holdings, read } = readAll(dir2);
  const keep = (f) => f.market === "no" || f.market === "oslo" || f.market === "us" && (f.kind === "fund" || (f.marketCap ?? 0) >= 2e9);
  const funds = index.funds.filter(keep);
  const byIsin = /* @__PURE__ */ new Map();
  for (const f of chunkFiles) for (const x of read(f)) byIsin.set(x.isin, x);
  const chunks = {};
  let n = 0;
  const outFunds = funds.map((f) => {
    if (f.chunk === void 0 || !byIsin.has(f.isin)) return { ...f, chunk: void 0 };
    const c = Math.floor(n++ / CHUNK2);
    (chunks[`funds-${String(c).padStart(2, "0")}.json`] ??= []).push(byIsin.get(f.isin));
    return { ...f, chunk: c };
  });
  const meta2 = { ...index.meta, subset: funds.length < index.funds.length };
  const gz = gzB64({ index: { meta: meta2, funds: outFunds }, factors, chunks, holdings });
  return template2.replace(DATA_MARK, () => `window.__FP_GZ="${gz}";`);
}
function writeSite(template2, dir2, siteDir, head) {
  const { index, factors, chunkFiles, holdings, read } = readAll(dir2);
  fs3.mkdirSync(path2.join(siteDir, "data"), { recursive: true });
  for (const f of chunkFiles) fs3.writeFileSync(path2.join(siteDir, "data", `${f}.gz`), zlib2.gzipSync(JSON.stringify(read(f)), { level: 9 }));
  const gz = gzB64({ index, factors, chunks: {}, holdings });
  const page = template2.replace(DATA_MARK, () => `window.__FP_REMOTE="data/";window.__FP_GZ="${gz}";`);
  fs3.writeFileSync(path2.join(siteDir, "index.html"), `<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body>
${page}
</body>
</html>
`);
  fs3.writeFileSync(path2.join(siteDir, ".nojekyll"), "");
  return { files: chunkFiles.length };
}

// artifact/oppdater.ts
var scope = process.env.QA_SCOPE === "claude" ? "claude" : "full";
var [dir = ".", symbols, template] = process.argv.slice(2);
fs4.mkdirSync(dir, { recursive: true });
var meta = await run(dir, symbols, { maxNewSearches: 60, scope });
var snap = await run2(path3.join(dir, "data.json"));
var HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://www.googletagmanager.com; style-src 'unsafe-inline'; img-src data: https://*.google-analytics.com https://*.googletagmanager.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<script>window.__QS_GA = "G-CZSJ6M3Y22";</script>
<meta name="description" content="Free predictions for funds and stocks in Norway, the USA, Europe and Asia: search, top lists, crash risk, dips and a return calculator. Updated several times a day.">`;
if (template) {
  const tpl = fs4.readFileSync(template, "utf8");
  fs4.writeFileSync(path3.join(dir, "side.html"), fillTemplate(tpl, dir));
  writeSite(tpl, dir, path3.join(dir, "site"), HEAD);
}
console.log("OK", JSON.stringify({ scope, funds: meta.withData, osloStocks: meta.stocksWithData, usStocks: meta.usStocksWithData, usEtfs: meta.usEtfsWithData, world: meta.byMarket, files: meta.chunks, dnbTeknologi: snap.last }));
