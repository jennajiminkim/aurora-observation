(() => {
  'use strict';

  const STATION = {
    signalId: 'aurora-kilpisjarvi-ovation',
    name: 'KILPISJÄRVI 01',
    lat: 69.03,
    lon: 20.79,
    timezone: 'Asia/Seoul'
  };
  const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
  const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
  const LIVE_KEY = 'aot_live_records_v1';
  const REPLAY_KEY = 'aot_fixture_records_v1';
  const EVENT_KEY = 'aot_aurora_events_v1';
  const EVENT_THRESHOLD = 65;
  const REARM_THRESHOLD = 60;
  const POLL_INTERVAL_MS = 15 * 60 * 1000;
  const EVENT_LIMIT = 40;
  const ASSET_ROOT = './assets/studio-task-assets/t04-real-information-board';
  const EXPECTED_HASHES = {
    'README.md': 'b9d0d4c076f8c1e1d9faf1a42d5bea42b0c47e5018e8f46af31f3798adc8d80c',
    'public-contract.json': '647d2ea2ce97005aebcbe9ccd62f380bc6efb10967729464bb1df67b3588edeb',
    'asset-manifest.json': '8adc0f6caea09e45c8fcdd42e239653e942227e306f688c780a18d441a6b7b41'
  };

  const $ = id => document.getElementById(id);
  const els = {
    auroraStage: $('auroraStage'),
    auroraViewport: $('auroraViewport'),
    liveBadge: $('liveBadge'),
    activityValue: $('activityValue'),
    activityUnit: $('activityUnit'),
    activityLabel: $('activityLabel'),
    activityBar: $('activityBar'),
    yesterdayValue: $('yesterdayValue'),
    deltaValue: $('deltaValue'),
    kpValue: $('kpValue'),
    recordDate: $('recordDate'),
    sourceTime: $('sourceTime'),
    fetchedAt: $('fetchedAt'),
    rawValue: $('rawValue'),
    storedValue: $('storedValue'),
    screenValue: $('screenValue'),
    historyChart: $('historyChart'),
    recordsBody: $('recordsBody'),
    commandText: $('commandText'),
    fixtureFreshness: $('fixtureFreshness'),
    fixtureError: $('fixtureError'),
    fixtureRows: $('fixtureRows'),
    fixtureLastGood: $('fixtureLastGood'),
    fixtureAction: $('fixtureAction'),
    fixtureLog: $('fixtureLog'),
    hashOutput: $('hashOutput'),
    previewDialog: $('previewDialog'),
    previewStage: $('previewStage'),
    previewValue: $('previewValue'),
    previewLevel: $('previewLevel'),
    previewSlider: $('previewSlider'),
    archiveList: $('archiveList'),
    archiveStage: $('archiveStage'),
    archiveDetails: $('archiveDetails'),
    archiveCount: $('archiveCount'),
    archiveStatus: $('archiveStatus'),
    monitorStatus: $('monitorStatus')
  };

  let visual = { activity: 0, frame: 0, status: 'standby' };
  const preview = { score: 65, open: false };
  let selectedEventId = null;
  let fetchingLive = false;
  let lastFetchAttempt = 0;

  function nowIso() { return new Date().toISOString(); }

  function seoulDate(iso) {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: STATION.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    return dtf.format(new Date(iso));
  }

  function fmtTime(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
  }

  function fmtNum(value, digits = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '--';
    return n.toFixed(digits).replace(/\.0$/, '');
  }

  function loadState(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || { records: {}, lastGood: null, status: { freshness: 'empty', error_code: 'none' } };
    } catch {
      return { records: {}, lastGood: null, status: { freshness: 'empty', error_code: 'none' } };
    }
  }

  function saveState(key, state) {
    localStorage.setItem(key, JSON.stringify(state));
  }

  function recordKey(reading) {
    return `${reading.signal_id}::${reading.record_date}`;
  }

  function sortedRecords(state, signalId) {
    return Object.values(state.records || {})
      .filter(r => !signalId || r.signal_id === signalId)
      .sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
  }

  function previousRecord(records, current) {
    const idx = records.findIndex(r => r.record_date === current.record_date && r.signal_id === current.signal_id);
    if (idx > 0) return records[idx - 1];
    return null;
  }

  function computeDelta(current, previous) {
    if (!current || !previous || current.unit !== previous.unit) return null;
    const delta = Number(current.normalized_value) - Number(previous.normalized_value);
    return Number.isFinite(delta) ? delta : null;
  }

  function upsertReading(storageKey, reading) {
    validateReading(reading);
    const state = loadState(storageKey);
    state.records[recordKey(reading)] = reading;
    state.lastGood = reading;
    state.status = { freshness: 'fresh', error_code: 'none', updated_at: reading.fetched_at };
    saveState(storageKey, state);
    const records = sortedRecords(state, reading.signal_id);
    const prev = previousRecord(records, reading);
    return { state, records, previous: prev, delta: computeDelta(reading, prev), rowCount: records.length };
  }

  function markFailure(storageKey, errorCode, detail) {
    const state = loadState(storageKey);
    state.status = { freshness: 'stale', error_code: errorCode, detail, updated_at: nowIso() };
    saveState(storageKey, state);
    return state;
  }

  function validateReading(reading) {
    const required = ['signal_id', 'normalized_value', 'unit', 'source_name', 'source_url', 'fetched_at', 'record_timezone', 'record_date'];
    for (const key of required) {
      if (reading[key] === undefined || reading[key] === null || reading[key] === '') throw new Error(`schema_error: missing ${key}`);
    }
    if (typeof reading.normalized_value !== 'number' || !Number.isFinite(reading.normalized_value)) {
      throw new Error('schema_error: normalized_value must be a number');
    }
  }

  function labelFor(score) {
    if (score >= 75) return 'STORM';
    if (score >= 50) return 'ACTIVE';
    if (score >= 25) return 'MODERATE';
    return 'LOW';
  }

  function styleBadge(freshness, errorCode) {
    els.liveBadge.classList.remove('standby', 'stale', 'error');
    if (freshness === 'fresh') {
      els.liveBadge.textContent = 'LIVE OBSERVATION';
    } else if (freshness === 'stale') {
      els.liveBadge.textContent = `STALE / ${errorCode}`;
      els.liveBadge.classList.add('stale');
    } else {
      els.liveBadge.textContent = 'STANDBY';
      els.liveBadge.classList.add('standby');
    }
  }

  function renderLive() {
    const state = loadState(LIVE_KEY);
    const records = sortedRecords(state, STATION.signalId);
    const last = state.lastGood || records[records.length - 1] || null;
    const prev = last ? previousRecord(records, last) : null;
    const delta = computeDelta(last, prev);

    styleBadge(state.status?.freshness, state.status?.error_code);
    if (!last) {
      setLiveEmpty();
      return;
    }

    const score = Math.max(0, Math.min(100, Number(last.normalized_value)));
    visual.activity = score;
    visual.status = state.status?.freshness === 'stale' ? 'stale' : 'fresh';
    els.activityValue.textContent = fmtNum(score, 0);
    els.activityUnit.textContent = last.unit;
    els.activityLabel.textContent = labelFor(score);
    els.activityBar.style.width = `${score}%`;
    els.yesterdayValue.textContent = prev ? `${fmtNum(prev.normalized_value, 0)} ${prev.unit}` : 'no previous day';
    els.deltaValue.textContent = delta === null ? '--' : `${delta >= 0 ? '▲ +' : '▼ '}${fmtNum(delta, 0)} ${last.unit}`;
    els.recordDate.textContent = last.record_date;
    els.sourceTime.textContent = fmtTime(last.source_time);
    els.fetchedAt.textContent = fmtTime(last.fetched_at);
    els.rawValue.textContent = `${fmtNum(last.raw_value ?? last.normalized_value, 0)} ${last.unit}`;
    els.storedValue.textContent = `${fmtNum(last.normalized_value, 0)} ${last.unit}`;
    els.screenValue.textContent = `${els.activityValue.textContent} ${last.unit}`;
    els.commandText.textContent = state.status?.freshness === 'stale'
      ? `last valid ${last.record_date} preserved; current ${state.status.error_code}`
      : `stored ${last.record_date} / ${fmtNum(last.normalized_value, 0)} ${last.unit}`;
    renderHistory(records, last);
    renderRecords(records);
  }

  function setLiveEmpty() {
    visual.activity = 0;
    visual.status = 'standby';
    els.activityValue.textContent = '--';
    els.activityUnit.textContent = 'pt';
    els.activityLabel.textContent = 'NO CURRENT DATA';
    els.activityBar.style.width = '0%';
    ['yesterdayValue','deltaValue','kpValue','recordDate','sourceTime','fetchedAt','rawValue','storedValue','screenValue'].forEach(id => $(id).textContent = '--');
    els.historyChart.innerHTML = '';
    els.recordsBody.innerHTML = '<tr><td colspan="4">No live records yet.</td></tr>';
    els.commandText.textContent = 'ready';
  }

  function renderHistory(records, last) {
    els.historyChart.innerHTML = '';
    const recent = records.slice(-14);
    if (!recent.length) return;
    for (const r of recent) {
      const bar = document.createElement('div');
      bar.className = 'history-bar' + (r.record_date === last.record_date ? ' latest' : '');
      const h = Math.max(3, Math.min(100, Number(r.normalized_value)));
      bar.style.height = `${h}%`;
      bar.title = `${r.record_date}: ${r.normalized_value} ${r.unit}`;
      const span = document.createElement('span');
      span.textContent = r.record_date.slice(5);
      bar.appendChild(span);
      els.historyChart.appendChild(bar);
    }
  }

  function renderRecords(records) {
    if (!records.length) {
      els.recordsBody.innerHTML = '<tr><td colspan="4">No live records yet.</td></tr>';
      return;
    }
    els.recordsBody.innerHTML = records.slice(-6).reverse().map(r => `
      <tr>
        <td>${escapeHtml(r.record_date)}</td>
        <td>${fmtNum(r.normalized_value, 0)} ${escapeHtml(r.unit)}</td>
        <td>${escapeHtml(fmtTime(r.source_time))}</td>
        <td>${escapeHtml(r.freshness || 'fresh')}</td>
      </tr>`).join('');
  }

  function extractRows(data) {
    if (Array.isArray(data) && Array.isArray(data[0]) && data[0].every(x => typeof x === 'string')) {
      const header = data[0];
      return data.slice(1).map(row => Object.fromEntries(header.map((h, i) => [h, row[i]])));
    }
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  async function fetchJson(url, timeoutMs = 12000) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal, cache: 'no-store' });
      if (!res.ok) {
        const code = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limit' : `http_${res.status}`;
        const err = new Error(code);
        err.code = code;
        throw err;
      }
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        err.code = 'timeout';
      } else if (!navigator.onLine) {
        err.code = 'offline';
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeOvation(raw, fetchedAt) {
    const coords = Array.isArray(raw) ? raw : (raw.coordinates || raw.Coordinates || raw.grid || raw.data);
    if (!Array.isArray(coords)) throw new Error('schema_error: OVATION coordinates not found');

    let best = null;
    let samples = 0;
    for (const item of coords) {
      let lon, lat, value;
      if (Array.isArray(item)) {
        [lon, lat, value] = item;
      } else if (item && typeof item === 'object') {
        lon = item.lon ?? item.longitude ?? item.Lon ?? item.Longitude;
        lat = item.lat ?? item.latitude ?? item.Lat ?? item.Latitude;
        value = item.aurora ?? item.value ?? item.probability ?? item.intensity ?? item.Aurora;
      }
      lon = Number(lon); lat = Number(lat); value = Number(value);
      if (![lon, lat, value].every(Number.isFinite)) continue;
      const dLat = Math.abs(lat - STATION.lat);
      const dLon = Math.min(Math.abs(lon - STATION.lon), 360 - Math.abs(lon - STATION.lon));
      if (dLat <= 6 && dLon <= 10) {
        samples++;
        const distance = dLat + dLon * 0.6;
        const candidateScore = value - distance * 0.25;
        if (!best || candidateScore > best.candidateScore) best = { lon, lat, value, distance, candidateScore };
      }
    }
    if (!best) throw new Error('schema_error: no valid OVATION sample near station');

    const score = Math.max(0, Math.min(100, Math.round(best.value)));
    const sourceTime = raw['Forecast Time'] || raw['Forecast time'] || raw.forecast_time || raw.forecastTime || raw['Observation Time'] || raw.observation_time || raw.time_tag || fetchedAt;
    return {
      signal_id: STATION.signalId,
      normalized_value: score,
      raw_value: best.value,
      unit: 'pt',
      source_name: 'NOAA SWPC OVATION Aurora Forecast',
      source_url: OVATION_URL,
      source_time: sourceTime,
      fetched_at: fetchedAt,
      record_timezone: STATION.timezone,
      record_date: seoulDate(fetchedAt),
      freshness: 'fresh',
      station_name: STATION.name,
      station_lat: STATION.lat,
      station_lon: STATION.lon,
      source_sample_lat: best.lat,
      source_sample_lon: best.lon,
      nearby_samples: samples,
      note: 'Local aurora activity score derived from NOAA OVATION grid values around Kilpisjärvi, Finland.'
    };
  }

  function normalizeKp(raw) {
    const rows = extractRows(raw).filter(Boolean);
    const usable = rows.map(r => {
      const value = Number(r.kp_index ?? r.Kp ?? r.kp ?? r.estimated_kp ?? r.estimated_Kp);
      const t = r.time_tag ?? r.Time_Tag ?? r.time ?? r.date;
      return { value, time: t };
    }).filter(r => Number.isFinite(r.value));
    return usable[usable.length - 1] || null;
  }

  function newEventState() {
    return { events: [], armed: true, belowCount: 0, lastSourceTime: null };
  }

  function loadEvents() {
    try {
      const data = JSON.parse(localStorage.getItem(EVENT_KEY));
      if (!data || !Array.isArray(data.events)) return newEventState();
      return { ...newEventState(), ...data };
    } catch { return newEventState(); }
  }

  function saveEvents(state) {
    // Keeping events separate preserves all existing daily rows and fixtures.
    localStorage.setItem(EVENT_KEY, JSON.stringify(state));
  }

  function eventStatusText(state) {
    return state.armed
      ? `Armed · ≥${EVENT_THRESHOLD} pt triggers capture`
      : `Event captured · re-arm after 2 distinct forecast updates below ${REARM_THRESHOLD} pt (${state.belowCount}/2)`;
  }

  function renderEventArchive() {
    const state = loadEvents();
    els.archiveCount.textContent = `${state.events.length} saved event${state.events.length === 1 ? '' : 's'}`;
    els.archiveStatus.textContent = eventStatusText(state);
    if (!state.events.length) {
      els.archiveList.innerHTML = '<div class="archive-empty">No captured NOAA events yet. Preview values and Card 3 fixtures never appear here.</div>';
      els.archiveStage.textContent = 'C:\\AURORA\\ARCHIVE> waiting for real activity ≥65 pt';
      els.archiveDetails.textContent = 'Select a real captured event to review its frozen ASCII frame.';
      return;
    }
    const list = [...state.events].reverse();
    if (!list.some(ev => ev.id === selectedEventId)) selectedEventId = list[0].id;
    els.archiveList.innerHTML = '';
    for (const ev of list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'archive-item' + (ev.id === selectedEventId ? ' selected' : '');
      button.dataset.eventId = ev.id;
      const stamp = document.createElement('strong');
      stamp.textContent = `${seoulDate(ev.capturedAt)}  ${new Date(ev.capturedAt).toLocaleTimeString('en-GB', { timeZone: STATION.timezone, hour12: false })} KST`;
      const score = document.createElement('span');
      score.textContent = `${ev.score} pt · ${labelFor(ev.score)}`;
      button.append(stamp, score);
      els.archiveList.appendChild(button);
    }
    const current = list.find(ev => ev.id === selectedEventId);
    if (current) {
      els.archiveStage.innerHTML = snapshotToHtml(current.snapshot);
      els.archiveDetails.textContent = `CAPTURED ${fmtTime(current.capturedAt)} · SOURCE ${fmtTime(current.sourceTime)} · ${current.score} pt · ${current.sourceUrl} · NOAA forecast score (not a camera photograph)`;
    }
  }

  // Only a successful REAL NOAA request reaches this function. A distinct
  // forecast timestamp is required to advance the re-arm counter.
  function processRealObservationForEvents(reading) {
    const state = loadEvents();
    const sourceTime = String(reading.source_time);
    if (sourceTime === state.lastSourceTime) return false;
    const score = Number(reading.normalized_value);
    let created = false;
    state.lastSourceTime = sourceTime;
    if (score >= EVENT_THRESHOLD && state.armed) {
      // Capture EXACTLY one frame from the same ASCII renderer as live mode,
      // rather than inventing an AI image or using the preview display.
      const frame = buildAuroraGrid(score, visual.frame, 'fresh', false);
      const event = {
        id: `${sourceTime}::${reading.fetched_at}::${score}`,
        score,
        unit: reading.unit,
        level: labelFor(score),
        sourceUrl: reading.source_url,
        sourceTime,
        capturedAt: reading.fetched_at,
        timezone: STATION.timezone,
        gridColumns: stageColumns,
        snapshot: gridToSnapshot(frame)
      };
      state.events.push(event);
      state.events = state.events.slice(-EVENT_LIMIT);
      state.armed = false;
      state.belowCount = 0;
      created = true;
    } else if (!state.armed) {
      if (score < REARM_THRESHOLD) {
        state.belowCount++;
        if (state.belowCount >= 2) {
          state.armed = true;
          state.belowCount = 0;
        }
      } else {
        state.belowCount = 0;
      }
    }
    // If storage quota is exhausted the caller treats the capture as failed,
    // never falsely announcing that the image was safely recorded.
    saveEvents(state);
    renderEventArchive();
    return created;
  }

  function updateMonitorStatus() {
    const at = lastFetchAttempt ? new Date(lastFetchAttempt).toLocaleTimeString('en-GB', { timeZone: STATION.timezone, hour12: false }) : '--';
    els.monitorStatus.textContent = `AUTO: 15 min · browser open only · last request ${at} KST`;
  }

  function setPreviewScore(value) {
    const n = Number(value);
    preview.score = Math.max(0, Math.min(100, Number.isFinite(n) ? n : 65));
    els.previewSlider.value = String(preview.score);
    els.previewValue.textContent = `${preview.score} pt`;
    els.previewLevel.textContent = labelFor(preview.score);
    els.previewLevel.className = 'preview-level ' + labelFor(preview.score).toLowerCase();
    if (preview.open) els.previewStage.innerHTML = gridToHtml(buildAuroraGrid(preview.score, visual.frame, 'fresh', true));
  }

  function openPreview() {
    preview.open = true;
    setPreviewScore(preview.score);
    if (!els.previewDialog.open) els.previewDialog.showModal();
  }

  function closePreview() {
    preview.open = false;
    if (els.previewDialog.open) els.previewDialog.close();
  }

  // On-demand PNG export rasterizes the already saved text/color snapshot.
  // No image generation, synthetic score, or network request is involved.
  function downloadEventPng() {
    const ev = loadEvents().events.find(item => item.id === selectedEventId);
    if (!ev) return;
    const fontPx = 14;
    const lineHeight = 17;
    const pad = 18;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = `${fontPx}px Consolas, "Courier New", monospace`;
    const charW = ctx.measureText('0').width;
    const cols = Number(ev.gridColumns) || Math.max(...ev.snapshot.map(row => row.reduce((n,seg) => n + seg[1].length, 0)));
    canvas.width = Math.ceil(cols * charW + pad * 2);
    canvas.height = ev.snapshot.length * lineHeight + pad * 2;
    ctx.fillStyle = '#020508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'top';
    ctx.font = `${fontPx}px Consolas, "Courier New", monospace`;
    const colors = {
      'tone-line':'#3cd7ff', 'tone-cyan':'#2de4ff', 'tone-green':'#39ffb6',
      'tone-violet':'#c58cff', 'tone-white':'#d8fbff', 'tone-dim':'#83aeb7',
      'tone-orange':'#ffad66', 'tone-red':'#ff6b6b'
    };
    ev.snapshot.forEach((row, y) => {
      let x = pad;
      row.forEach(([tone, chars]) => {
        ctx.fillStyle = colors[tone] || '#2de4ff';
        ctx.fillText(chars, x, pad + y * lineHeight);
        x += chars.length * charW;
      });
    });
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aurora-capture-${seoulDate(ev.capturedAt)}-${ev.score}pt.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  }

  function downloadEventFrame() {
    const ev = loadEvents().events.find(item => item.id === selectedEventId);
    if (!ev) return;
    const time = escapeHtml(fmtTime(ev.capturedAt));
    const archiveCss = `.snapshot{background:#020508;color:#2de4ff;font:11px/1.03 Consolas,'Courier New',monospace;white-space:pre;width:max-content;} .tone-line{color:#3cd7ff}.tone-cyan{color:#2de4ff}.tone-green{color:#39ffb6}.tone-violet{color:#c58cff}.tone-white{color:#d8fbff}.tone-dim{color:#83aeb7}.tone-orange{color:#ffad66}.tone-red{color:#ff6b6b}`;
    const page = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Aurora captured ${time}</title><style>body{background:#020508;color:#d8fbff;padding:16px} ${archiveCss}</style><h3>NOAA OVATION predicted activity · ${ev.score} pt · ${time}</h3><pre class="snapshot">${snapshotToHtml(ev.snapshot)}</pre><p>Forecast data, NOT a camera photograph. ${escapeHtml(ev.sourceUrl)}</p></html>`;
    const url = URL.createObjectURL(new Blob([page], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `aurora-frame-${seoulDate(ev.capturedAt)}-${ev.score}pt.html`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function fetchLive() {
    if (fetchingLive) return;
    fetchingLive = true;
    lastFetchAttempt = Date.now();
    updateMonitorStatus();
    els.commandText.textContent = 'fetching NOAA SWPC public JSON...';
    try {
      const fetchedAt = nowIso();
      const [ovationRaw, kpRaw] = await Promise.allSettled([fetchJson(OVATION_URL), fetchJson(KP_URL, 8000)]);
      if (ovationRaw.status !== 'fulfilled') throw ovationRaw.reason;
      const reading = normalizeOvation(ovationRaw.value, fetchedAt);
      const result = upsertReading(LIVE_KEY, reading);
      renderLive();
      if (kpRaw.status === 'fulfilled') {
        const kp = normalizeKp(kpRaw.value);
        els.kpValue.textContent = kp ? `${fmtNum(kp.value, 2)} / ${fmtTime(kp.time)}` : 'unparsed';
      } else {
        els.kpValue.textContent = 'not loaded';
      }
      let captureNote = '';
      try {
        const captured = processRealObservationForEvents(reading);
        if (captured) captureNote = ' · real event frame captured';
      } catch (storageError) {
        captureNote = ' · event archive save FAILED (check browser storage)';
        console.error('Event archive not saved:', storageError);
      }
      els.commandText.textContent = `fresh / ${reading.record_date} / rows ${result.rowCount}${captureNote}`;
    } catch (err) {
      const errorCode = err.code || (String(err.message || '').startsWith('schema_error') ? 'schema_error' : 'network_error');
      markFailure(LIVE_KEY, errorCode, err.message || String(err));
      renderLive();
      els.commandText.textContent = `current data unavailable; preserved last normal value; ${errorCode}`;
    } finally {
      fetchingLive = false;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function line(width, char = '─') { return char.repeat(width); }

  // Build one balanced ASCII field: sky / aurora / land / instrument.
  // The scene is drawn in one fixed-width coordinate system. The station uses
  // centerX as its anchor, the terrain spans the full width, and the aurora uses
  // smooth sin/cos phase motion instead of being randomly regenerated.
  // A character-column grid must fill the physical viewport, not a fixed
  // number of columns. Otherwise centerX only centers within a short line of
  // text and the entire scene remains anchored to the left of the panel.
  let stageColumns = 116;

  function measureStageColumns() {
    const viewport = els.auroraViewport;
    const stage = els.auroraStage;
    if (!viewport || !stage) return stageColumns;

    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(100);
    const font = getComputedStyle(stage);
    Object.assign(probe.style, {
      position: 'absolute',
      visibility: 'hidden',
      whiteSpace: 'pre',
      fontFamily: font.fontFamily,
      fontSize: font.fontSize,
      fontWeight: font.fontWeight,
      fontStyle: font.fontStyle,
      fontVariantLigatures: 'none',
      letterSpacing: font.letterSpacing
    });
    viewport.appendChild(probe);
    const charWidth = probe.getBoundingClientRect().width / 100;
    probe.remove();
    if (!Number.isFinite(charWidth) || charWidth <= 0) return stageColumns;

    // Leave two character cells of tolerance for fractional pixel rounding.
    const columns = Math.max(48, Math.floor(viewport.clientWidth / charWidth) - 2);
    stageColumns = columns;
    stage.dataset.columns = String(columns);
    return columns;
  }

  // Re-measure on panel width changes (including browser resizing). All
  // drawing functions use this same column count and its derived centerX.
  if (window.ResizeObserver && els.auroraViewport) {
    const stageObserver = new ResizeObserver(() => measureStageColumns());
    stageObserver.observe(els.auroraViewport);
  } else {
    window.addEventListener('resize', measureStageColumns);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measureStageColumns);
  }

  function blankGrid(width, height) {
    return Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: ' ', cls: '' })));
  }

  function put(grid, row, col, text, cls = '') {
    if (row < 0 || row >= grid.length) return;
    for (let i = 0; i < text.length; i++) {
      const x = col + i;
      if (x >= 0 && x < grid[row].length) grid[row][x] = { ch: text[i], cls };
    }
  }

  function setCell(grid, row, col, ch, cls = '') {
    if (row < 0 || row >= grid.length || col < 0 || col >= grid[row].length) return;
    grid[row][col] = { ch, cls };
  }

  function centeredPut(grid, row, text, cls = '') {
    put(grid, row, Math.max(0, Math.floor((grid[0].length - text.length) / 2)), text, cls);
  }

  // Group adjacent cells of the same color; the exact characters and trailing
  // spaces survive. Snapshots contain text/color segments, never executable HTML.
  function gridToSnapshot(grid) {
    return grid.map(row => {
      const groups = [];
      for (const cell of row) {
        const tone = cell.cls || '';
        const last = groups[groups.length - 1];
        if (last && last[0] === tone) last[1] += cell.ch;
        else groups.push([tone, cell.ch]);
      }
      return groups;
    });
  }

  function snapshotToHtml(rows) {
    const allowedTones = new Set(['tone-line', 'tone-cyan', 'tone-green', 'tone-violet', 'tone-white', 'tone-dim', 'tone-orange', 'tone-red']);
    return rows.map(row => row.map(([cls, chars]) => {
      const safeText = escapeHtml(chars);
      return allowedTones.has(cls) ? `<span class="${cls}">${safeText}</span>` : safeText;
    }).join('')).join('\n');
  }

  function gridToHtml(grid) {
    return snapshotToHtml(gridToSnapshot(grid));
  }

  function deterministicNoise(x, y, seed = 0) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
    return n - Math.floor(n);
  }

  function drawSky(grid, frame, score, status) {
    const width = grid[0].length;
    const centerX = Math.floor(width / 2);
    const skyTop = 2;
    const skyRows = 16;
    const starCount = status === 'stale' ? 30 : 42 + Math.round(score / 5);

    // Fixed star positions with slow twinkling only. This avoids the whole sky
    // jumping between frames.
    for (let i = 0; i < starCount; i++) {
      const x = 2 + ((i * 37 + 17) % (width - 4));
      const y = skyTop + ((i * 19 + 5) % skyRows);
      const twinkle = Math.sin(frame * 0.16 + i * 1.73);
      if (twinkle > -0.32) {
        const ch = twinkle > 0.86 ? '*' : twinkle > 0.45 ? '+' : i % 3 === 0 ? '.' : '·';
        setCell(grid, y, x, ch, i % 6 === 0 ? 'tone-white' : 'tone-cyan');
      }
    }

    if (width >= 100) {
      put(grid, 1, 2, 'ARCTIC SKY WINDOW / 69.03N 20.79E', 'tone-dim');
      centeredPut(grid, 1, 'KILPISJÄRVI 01', 'tone-dim');
      put(grid, 1, width - 18, 'WIDE FIELD SCAN', 'tone-dim');
    } else {
      centeredPut(grid, 1, 'KILPISJÄRVI 01', 'tone-dim');
    }
    setCell(grid, 2, centerX, '┆', 'tone-line');
  }

  function drawAuroraCurtain(grid, frame, score, status) {
    const width = grid[0].length;
    const centerX = Math.floor(width / 2);
    const intensity = Math.max(0, Math.min(1, score / 100));
    const top = 7;
    const bottom = 25;
    const phase = frame * (0.14 + intensity * 0.12);

    const widthSpan = Math.round(40 + intensity * 66);
    const left = Math.max(2, centerX - Math.floor(widthSpan / 2));
    const right = Math.min(width - 3, centerX + Math.floor(widthSpan / 2));
    const baseY = 15;
    const verticalAmp = 1.0 + intensity * 4.6;
    const thickness = status === 'stale' ? 1.2 : 1.6 + intensity * 5.3;
    const density = status === 'stale' ? 0.16 : 0.23 + intensity * 0.56;

    const chars = score >= 75
      ? ['█', '▓', '▒', '░', '│', '╱', '╲', ':']
      : score >= 50
        ? ['▓', '▒', '░', '│', '╱', '╲', '~', ':']
        : score >= 25
          ? ['▒', '░', '·', '~', '╱', '╲', ':']
          : ['·', ':', '~', '.', ' '];

    for (let x = left; x <= right; x++) {
      const dist = Math.abs(x - centerX) / Math.max(1, widthSpan / 2);
      const envelope = Math.max(0, 1 - Math.pow(dist, 2.2));
      const waveA = Math.sin((x - centerX) * 0.115 + phase);
      const waveB = Math.cos((x - centerX) * 0.058 - phase * 0.82);
      const center = baseY + waveA * verticalAmp + waveB * verticalAmp * 0.55;
      const tail = 2 + intensity * 6;

      for (let y = top; y <= bottom; y++) {
        const d = Math.abs(y - center);
        const lowerFall = y > center ? Math.min(tail, (y - center) * 0.68) : 0;
        const shape = (thickness + lowerFall * 0.22) * envelope - d;
        if (shape <= 0) continue;

        // Noise is mostly fixed by x/y. A tiny phase term changes brightness
        // gradually without regenerating the curtain from scratch.
        const baseNoise = deterministicNoise(x, y, 3);
        const shimmer = (Math.sin(phase * 1.15 + x * 0.21 + y * 0.53) + 1) / 2;
        const threshold = density * Math.max(0.18, shape / (thickness + tail * 0.25)) * (0.58 + shimmer * 0.52);
        if (baseNoise < threshold) {
          const charIndex = Math.abs(Math.floor(x * 0.19 + y * 0.77 + phase * 2.2)) % chars.length;
          const ch = chars[charIndex];
          if (ch !== ' ') {
            const band = (x + Math.floor(phase * 8)) % 42;
            const cls = status === 'stale'
              ? 'tone-dim'
              : band < 15 ? 'tone-green' : band < 29 ? 'tone-cyan' : 'tone-violet';
            setCell(grid, y, x, ch, cls);
          }
        }
      }
    }

    if (status === 'stale') {
      centeredPut(grid, 14, 'NO CURRENT OBSERVATION', 'tone-orange');
      centeredPut(grid, 16, 'last normal signal is preserved', 'tone-dim');
    }
  }

  function drawLatitudeGrid(grid, frame) {
    const width = grid[0].length;
    const centerX = Math.floor(width / 2);
    const horizonY = 27;
    for (let x = 0; x < width; x++) {
      if (x % 18 === 0) setCell(grid, horizonY, x, '+', 'tone-line');
      else if (x % 3 === 0) setCell(grid, horizonY, x, '─', 'tone-line');
    }
    put(grid, horizonY, 2, 'HORIZON  ─  LAPLAND FIELD SCAN', 'tone-dim');

    // A slow scan line, not an abrupt screen-wide rebuild.
    const sweep = 8 + Math.floor((Math.sin(frame * 0.055) + 1) * 0.5 * (width - 16));
    for (let y = 5; y < 38; y += 2) setCell(grid, y, sweep, y % 4 === 0 ? '│' : '┆', 'tone-line');
    setCell(grid, 27, centerX, '┼', 'tone-line');
  }

  function drawLandscape(grid, frame, score, status) {
    const width = grid[0].length;
    const base = 36;
    // Distant mountains fill the full stage width, but stay behind the station.
    for (let x = 0; x < width; x++) {
      const h = 2 + Math.round(Math.sin(x * 0.095) * 1.7 + Math.sin(x * 0.041 + 1.8) * 2.1 + Math.sin(x * 0.19) * 0.7);
      const peakY = base - Math.max(1, h);
      const peak = x % 7 === 0 ? '/' : x % 7 === 3 ? '\\' : '^';
      setCell(grid, peakY, x, peak, 'tone-cyan');
      for (let y = peakY + 1; y <= base; y++) {
        const texture = ((x * 3 + y * 5) % 8) < 5 ? '░' : '·';
        setCell(grid, y, x, y === base ? '─' : texture, 'tone-dim');
      }
    }

    // Flat snow field extends to both borders.
    for (let x = 0; x < width; x++) {
      setCell(grid, 39, x, x % 14 === 0 ? '+' : '─', 'tone-line');
      if ((x + Math.floor(frame / 4)) % 23 === 0) setCell(grid, 40, x, '·', 'tone-white');
    }
    put(grid, 41, 2, `AURORA FIELD AMPLITUDE ${Math.round(score).toString().padStart(3, '0')} PT`, 'tone-dim');
    centeredPut(grid, 41, `STATUS ${status.toUpperCase()}`, status === 'stale' ? 'tone-orange' : 'tone-green');
  }

  function drawStation(grid, frame, score) {
    const width = grid[0].length;
    const cx = Math.floor(width / 2);
    const blink = frame % 20 < 10 ? '●' : '○';
    const station = [
      '          │          ',
      '         /│\\         ',
      '        / │ \\        ',
      '       ┌──┴──┐       ',
      `       │ ${blink}  │       `,
      '    ┌──┴─────┴──┐    ',
      '    │  ALL SKY  │    ',
      '    │  CAMERA   │    ',
      '  ╱─┴───────────┴─╲  ',
      ' ╱   KILPISJÄRVI    ╲ ',
      '╱____SENSOR_01_______╲'
    ];
    const startRow = 28;
    // Every instrument row has a slightly different text width. Center each
    // row independently so neither the antenna nor the body drifts left.
    station.forEach((row, i) => {
      const startCol = cx - Math.floor(row.length / 2);
      put(grid, startRow + i, startCol, row, i < 5 ? 'tone-white' : 'tone-cyan');
    });
    put(grid, 32, cx + 17, '69.03N', 'tone-dim');
    put(grid, 33, cx + 17, '20.79E', 'tone-dim');

    // Beam is anchored to the station center, so it cannot drift left.
    const beamHeight = 6 + Math.round(score / 18);
    for (let y = startRow - 1; y > Math.max(8, startRow - 1 - beamHeight); y--) {
      const pulse = Math.sin(frame * 0.22 + y * 0.45);
      setCell(grid, y, cx, pulse > 0 ? '│' : '┆', score > 50 ? 'tone-green' : 'tone-line');
    }
  }

  function drawMiniReadouts(grid, score) {
    const width = grid[0].length;
    const label = labelFor(score);
    put(grid, 4, 2, `LEVEL ${label.padEnd(8)} VALUE ${Math.round(score).toString().padStart(3, ' ')} pt`, label === 'LOW' ? 'tone-orange' : 'tone-green');
    put(grid, 5, 2, 'motion: fixed stars + smooth sin/cos aurora curtain', 'tone-dim');
    put(grid, 43, 2, 'SOURCE NOAA SWPC OVATION   TZ Asia/Seoul   DAILY KEY KST', 'tone-dim');
  }

  // The SAME scene generator draws both live and simulated frames. The test
  // score cannot reach storage because the builder is pure (display only).
  function buildAuroraGrid(score, frame, status, simulated = false) {
    const width = stageColumns;
    const grid = blankGrid(width, 45);
    put(grid, 0, 0, line(width, '─'), 'tone-line');
    drawSky(grid, frame, score, status);
    drawAuroraCurtain(grid, frame, score, status);
    drawLatitudeGrid(grid, frame);
    drawLandscape(grid, frame, score, status);
    drawStation(grid, frame, score);
    drawMiniReadouts(grid, score);
    if (simulated) {
      put(grid, 43, 2, 'SIMULATED PREVIEW / NOT NOAA DATA / NO RECORD OR CAPTURE', 'tone-orange');
    }
    put(grid, 44, 0, line(width, '─'), 'tone-line');
    return grid;
  }

  function renderAuroraFrame() {
    const score = visual.status === 'stale' ? Math.max(4, visual.activity * .42) : visual.activity;
    const frame = visual.frame++;
    els.auroraStage.innerHTML = gridToHtml(buildAuroraGrid(score, frame, visual.status));
    if (preview.open) {
      els.previewStage.innerHTML = gridToHtml(buildAuroraGrid(preview.score, frame, 'fresh', true));
    }
    const delay = Math.max(90, 170 - score * 0.55);
    setTimeout(renderAuroraFrame, delay);
  }

  async function loadFixture(name) {
    const res = await fetch(`${ASSET_ROOT}/fixtures/${name}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`fixture load failed: ${name}`);
    return res.json();
  }

  function resetReplay() {
    localStorage.removeItem(REPLAY_KEY);
    renderFixtureState(loadState(REPLAY_KEY), 'reset complete');
  }

  function readingFromFixturePayload(payload) {
    return {
      signal_id: payload.signal_id,
      normalized_value: payload.normalized_value,
      unit: payload.unit,
      source_name: payload.source_name,
      source_url: payload.source_url,
      source_time: payload.source_time,
      fetched_at: payload.fetched_at,
      record_timezone: payload.record_timezone,
      record_date: payload.record_date,
      freshness: 'fresh'
    };
  }

  async function applyFixture(name) {
    const fx = await loadFixture(name);
    const t = fx.transport || {};
    if (t.mode === 'offline') {
      return markFailure(REPLAY_KEY, 'offline', fx.description_ko);
    }
    if (t.mode === 'timeout' || Number(t.delay_ms) > Number(t.deadline_ms)) {
      return markFailure(REPLAY_KEY, 'timeout', fx.description_ko);
    }
    if (t.status === 401 || t.status === 403) {
      return markFailure(REPLAY_KEY, 'auth', fx.description_ko);
    }
    if (t.status === 429) {
      return markFailure(REPLAY_KEY, 'rate_limit', fx.description_ko);
    }
    try {
      const reading = readingFromFixturePayload(fx.payload);
      const result = upsertReading(REPLAY_KEY, reading);
      return result.state;
    } catch (err) {
      if (String(err.message).includes('schema_error')) return markFailure(REPLAY_KEY, 'schema_error', fx.description_ko);
      return markFailure(REPLAY_KEY, 'unknown', err.message);
    }
  }

  async function runSuccessSequence() {
    resetReplay();
    for (const name of ['normal-d1-a', 'normal-d1-b', 'normal-d2']) await applyFixture(name);
    renderFixtureState(loadState(REPLAY_KEY), 'success sequence: D1-A → D1-B → D2');
  }

  async function runFailure(name) {
    resetReplay();
    await applyFixture('normal-d1-a');
    await applyFixture('normal-d1-b');
    await applyFixture(name);
    renderFixtureState(loadState(REPLAY_KEY), `baseline + ${name}`);
  }

  async function runRecover() {
    resetReplay();
    for (const name of ['normal-d1-a', 'normal-d1-b', 'timeout', 'recover-d2']) await applyFixture(name);
    renderFixtureState(loadState(REPLAY_KEY), 'timeout → recover-d2');
  }

  function renderFixtureState(state, label) {
    const records = sortedRecords(state);
    const last = state.lastGood;
    els.fixtureFreshness.textContent = state.status?.freshness || 'empty';
    els.fixtureError.textContent = state.status?.error_code || 'none';
    els.fixtureRows.textContent = String(records.length);
    els.fixtureLastGood.textContent = last ? `${last.normalized_value} ${last.unit}` : '--';
    els.fixtureAction.textContent = state.status?.freshness === 'stale' ? 'Retry available; last normal preserved' : 'No action needed';
    const delta = records.length >= 2 ? computeDelta(records[records.length - 1], records[records.length - 2]) : null;
    els.fixtureLog.textContent = [
      `C:\\AURORA\\FIXTURE> ${label}`,
      `freshness : ${state.status?.freshness || 'empty'}`,
      `error     : ${state.status?.error_code || 'none'}`,
      `rows      : ${records.length}`,
      `last good : ${last ? `${last.normalized_value} ${last.unit} / ${last.record_date}` : '--'}`,
      `delta     : ${delta === null ? '--' : delta}`,
      `records   :`,
      ...records.map(r => `  - ${r.record_date} ${r.normalized_value}${r.unit} ${r.source_url}`)
    ].join('\n');
  }

  async function sha256Text(text) {
    const bytes = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function checkHashes() {
    const lines = ['C:\\AURORA\\ASSETS> SHA-256 check'];
    for (const [path, expected] of Object.entries(EXPECTED_HASHES)) {
      try {
        const res = await fetch(`${ASSET_ROOT}/${path}`, { cache: 'no-store' });
        const text = await res.text();
        const actual = await sha256Text(text);
        lines.push(`${path}`);
        lines.push(`  expected ${expected}`);
        lines.push(`  actual   ${actual}`);
        lines.push(`  result   ${actual === expected ? 'OK' : 'MISMATCH'}`);
      } catch (err) {
        lines.push(`${path}: failed (${err.message})`);
      }
    }
    els.hashOutput.textContent = lines.join('\n');
  }

  function clearLiveRecords() {
    localStorage.removeItem(LIVE_KEY);
    renderLive();
  }

  function exportReviewJson() {
    const live = loadState(LIVE_KEY);
    const replay = loadState(REPLAY_KEY);
    const payload = {
      project: 'Aurora Observation Terminal',
      station: STATION,
      live_source: OVATION_URL,
      supplement_source: KP_URL,
      timezone: STATION.timezone,
      exported_at: nowIso(),
      live_records: sortedRecords(live, STATION.signalId),
      live_status: live.status,
      replay_records: sortedRecords(replay),
      replay_status: replay.status,
      real_event_archive: loadEvents().events,
      event_policy: { threshold_pt: EVENT_THRESHOLD, rearm_below_pt: REARM_THRESHOLD, rearm_distinct_forecasts: 2, poll_minutes: 15, source: 'real NOAA only', scope: 'this browser only' },
      asset_hashes_expected: EXPECTED_HASHES,
      note: 'Actual two-day evidence requires running the live fetch on two different Asia/Seoul dates. Synthetic fixtures do not replace live evidence.'
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'submission-review-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function bindEvents() {
    $('liveButton').addEventListener('click', fetchLive);
    $('previewButton').addEventListener('click', openPreview);
    $('previewClose').addEventListener('click', closePreview);
    els.previewDialog.addEventListener('close', () => { preview.open = false; });
    els.previewSlider.addEventListener('input', e => setPreviewScore(e.target.value));
    document.querySelectorAll('[data-preview-score]').forEach(button => {
      button.addEventListener('click', () => setPreviewScore(button.dataset.previewScore));
    });
    els.archiveList.addEventListener('click', event => {
      const item = event.target.closest('[data-event-id]');
      if (item) { selectedEventId = item.dataset.eventId; renderEventArchive(); }
    });
    $('downloadEventButton').addEventListener('click', downloadEventFrame);
    $('downloadPngButton').addEventListener('click', downloadEventPng);
    $('clearLiveButton').addEventListener('click', clearLiveRecords);
    $('exportButton').addEventListener('click', exportReviewJson);
    $('hashButton').addEventListener('click', checkHashes);
    document.querySelector('.failure-panel').addEventListener('click', async (event) => {
      const btn = event.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'resetReplay') resetReplay();
      if (action === 'successSequence') await runSuccessSequence();
      if (action === 'fail') await runFailure(btn.dataset.fixture);
      if (action === 'recover') await runRecover();
    });
  }

  function tickClock() {
    $('clockUtc').textContent = new Date().toISOString().slice(11, 19) + ' UTC';
    setTimeout(tickClock, 1000);
  }

  bindEvents();
  tickClock();
  renderLive();
  renderFixtureState(loadState(REPLAY_KEY), 'waiting');
  renderEventArchive();
  updateMonitorStatus();
  setPreviewScore(65);
  measureStageColumns();
  renderAuroraFrame();
  fetchLive();
  // Timers run only while the browser remains open, not as a 24/7 server.
  setInterval(fetchLive, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastFetchAttempt >= POLL_INTERVAL_MS) fetchLive();
  });
})();
