/* =========================================================================
   UrbanShield AI — script.js
   Open-data city disaster vulnerability & simulation (educational demo).

   Data sources (all free, no keys):
     • Open-Meteo ............ live weather + forecast  (CORS enabled)
     • Open Topo Data ........ elevation (no CORS header in browser → the app
                               auto-falls back to Open-Meteo Elevation API)
     • OpenStreetMap ......... basemap tiles + Overpass land-use tags
     • Census of India 2011 .. official city population (embedded, cited)

   The weighted scoring formula is a TRANSPARENT HEURISTIC.
   It is NOT scientifically validated and is NOT an official warning system.
   ========================================================================= */
'use strict';

/* ============================== 1. CONFIG =============================== */

const WEIGHTS = { rain: 0.25, elev: 0.15, pop: 0.20, land: 0.15, drain: 0.15, flood: 0.10 };
const RAIN_NORM_MAX = 200;          // mm over 48 h that maps to a factor score of 100
const CLASS_COLORS  = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };

const LANDUSE_SCORE = { industrial: 80, 'dense-residential': 75, residential: 60, mixed: 55, 'peri-urban': 40, green: 20 };
const LANDUSE_LABEL = { industrial: 'Industrial / warehousing', 'dense-residential': 'Dense residential', residential: 'Residential', mixed: 'Mixed use', 'peri-urban': 'Peri-urban / low density', green: 'Green / open' };
const OSM_LANDUSE_LABEL = { residential: 'Residential', industrial: 'Industrial', commercial: 'Commercial', retail: 'Retail', farmland: 'Farmland', forest: 'Forest', grass: 'Grass', cemetery: 'Cemetery', construction: 'Construction', recreation_ground: 'Recreation', religious: 'Religious', allotments: 'Allotments', quarry: 'Quarry', military: 'Military' };

const WMO = { 0:'Clear sky', 1:'Mostly clear', 2:'Partly cloudy', 3:'Overcast', 45:'Fog', 48:'Rime fog',
  51:'Light drizzle', 53:'Drizzle', 55:'Dense drizzle', 61:'Light rain', 63:'Rain', 65:'Heavy rain',
  66:'Freezing rain', 67:'Freezing rain', 71:'Light snow', 73:'Snow', 75:'Heavy snow', 77:'Snow grains',
  80:'Light showers', 81:'Showers', 82:'Violent showers', 85:'Snow showers', 86:'Snow showers',
  95:'Thunderstorm', 96:'Thunderstorm, hail', 99:'Thunderstorm, hail' };

/* Cache lifetimes — static geographic data is cached, live weather is short */
const TTL = { weather: 10 * 60e3, elev: 7 * 24 * 3600e3, osm: 24 * 3600e3 };
const MIN_WEATHER_GAP = 3 * 60e3;   // avoid unnecessary Open-Meteo calls

const TILE_URL    = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';

/* Compact locality factory — all coordinates are REAL localities, shown at
   approximate publicly-known points (no invented neighbourhoods). */
function LOC(name, lat, lon, densityTier, landuse, drainTier, floodScore, floodNote) {
  return { name, lat, lon, densityTier, landuse, drainTier, floodScore, floodNote };
}

/* ============================ 2. CITY DATA ============================== */

const CITIES = {
  pune: {
    name: 'Pune', state: 'Maharashtra', center: [18.5204, 73.8567], zoom: 11,
    rivers: 'Mula · Mutha · Pavana',
    census: { label: 'Pune Municipal Corporation', pop: 3124458, areaKm2: 331.26 },
    floodEvents: [
      { year: 1961, text: 'Panshet dam breach (12 Jul) — catastrophic flooding of central Pune.' },
      { year: 2019, text: 'September — very heavy rain; Mula-Mutha overflow inundated riverside wards (Kharadi, Warje, Sinhagad Rd).' },
      { year: 2021, text: 'Monsoon — hill-slope runoff and waterlogging reported in western suburbs (Baner, Balewadi).' }
    ],
    locations: [
      LOC('Shivajinagar',   18.5308, 73.8478, 4, 'dense-residential', 3, 45, 'Old core ward; recurring monsoon waterlogging on arterial roads.'),
      LOC('Swargate',       18.5015, 73.8603, 5, 'dense-residential', 2, 50, 'Dense old core near the river confluence; waterlogging-prone junctions.'),
      LOC('Kothrud',        18.5074, 73.8077, 4, 'residential',       3, 30, 'Higher ground in the west; comparatively few flooding reports.'),
      LOC('Aundh',          18.5636, 73.8077, 4, 'residential',       3, 35, 'Elevated plateau; occasional nullah overflow at peak intensity.'),
      LOC('Baner',          18.5596, 73.7818, 3, 'mixed',             2, 55, 'Hill-slope runoff along the Baner stream; 2021 flooding reported.'),
      LOC('Warje',          18.4831, 73.8021, 4, 'residential',       2, 70, 'Low-lying along the Mutha; 2019 river overflow affected riverside pockets.'),
      LOC('Sinhagad Road',  18.4790, 73.8154, 3, 'residential',       2, 75, 'Riverside stretch along the Mutha; heavily affected in Sept 2019.'),
      LOC('Hadapsar',       18.5018, 73.9260, 4, 'residential',       2, 70, 'Near the Mula-Mutha confluence; low-lying agricultural transition pockets.'),
      LOC('Kharadi',        18.5515, 73.9476, 3, 'mixed',             2, 75, 'Mula-Mutha riverfront IT corridor; flooded in Sept 2019.'),
      LOC('Yerawada',       18.5511, 73.8868, 4, 'dense-residential', 2, 70, 'Along the Mula river; recurring riverine flooding in dense pockets.'),
      LOC('Kalyani Nagar',  18.5455, 73.9070, 4, 'residential',       3, 60, 'Riverfront locality; 2019 overflow reached riverside societies.'),
      LOC('Viman Nagar',    18.5679, 73.9143, 4, 'residential',       2, 45, 'Documented monsoon waterlogging hotspots around junctions.'),
      LOC('Hinjewadi',      18.5913, 73.7389, 3, 'mixed',             2, 50, 'IT zone on plateau; 2021 waterlogging reported in phase areas.')
    ]
  },

  mumbai: {
    name: 'Mumbai', state: 'Maharashtra', center: [19.0760, 72.8777], zoom: 11,
    rivers: 'Mithi · Dahisar · Oshiwara',
    census: { label: 'Greater Mumbai (Municipal Corporation)', pop: 12442373, areaKm2: 603.4 },
    floodEvents: [
      { year: 2005, text: '26 July — ~944 mm rain in 24 h at Santacruz; catastrophic city-wide flooding, Mithi overflow.' },
      { year: 2017, text: '29 August — severe urban flooding after an intense monsoon spell; rail and road paralysed.' },
      { year: 2021, text: 'September — heavy-rain waterlogging in Hindmata, Sion, Kurla and low-lying wards.' }
    ],
    locations: [
      LOC('Colaba',        18.9067, 72.8147, 4, 'mixed',             3, 55, 'Low-lying island edge; monsoon high-tide flooding of streets.'),
      LOC('Worli',         18.9977, 72.8188, 4, 'residential',       3, 45, 'Coastal strip; sea-water ingress during spring high tides.'),
      LOC('Dadar',         19.0178, 72.8478, 5, 'dense-residential', 2, 80, 'Hindmata zone — chronic waterlogging in nearly every monsoon.'),
      LOC('Sion',          19.0402, 72.8582, 5, 'dense-residential', 2, 75, 'Near the Mithi creek mouth; flood-prone junction and bus depot.'),
      LOC('Dharavi',       19.0410, 72.8550, 5, 'dense-residential', 1, 85, 'Mithi floodplain; extremely dense informal settlement.'),
      LOC('Kurla',         19.0726, 72.8873, 5, 'dense-residential', 1, 90, 'Mithi floodplain; catastrophic 2005 flooding, repeated since.'),
      LOC('Ghatkopar',     19.0869, 72.9049, 5, 'residential',       2, 60, 'Low pockets and chronic waterlogging spots around the station.'),
      LOC('Chembur',       19.0522, 72.9005, 5, 'residential',       2, 70, 'Low-lying basin; affected in 2005 and again in later events.'),
      LOC('Andheri East',  19.1136, 72.8697, 5, 'mixed',             2, 65, 'Airport-adjacent low pockets; chronic waterlogging on the highway.'),
      LOC('Andheri West',  19.1364, 72.8296, 5, 'mixed',             2, 60, 'Coastal lowlands; flooded in 2005 and 2017 events.'),
      LOC('Malad',         19.1863, 72.8487, 4, 'mixed',             2, 65, 'Creek-adjacent; repeated monsoon flooding of underpasses.'),
      LOC('Borivali',      19.2307, 72.8567, 3, 'residential',       3, 45, 'Adjoins Sanjay Gandhi National Park; relatively better drainage.'),
      LOC('Powai',         19.1176, 72.9060, 3, 'mixed',             3, 45, 'Lake vicinity; regulated outflow, localised waterlogging only.')
    ]
  },

  delhi: {
    name: 'Delhi', state: 'NCT of Delhi', center: [28.6139, 77.2090], zoom: 11,
    rivers: 'Yamuna · Najafgarh Drain',
    census: { label: 'National Capital Territory of Delhi', pop: 16787941, areaKm2: 1483.0 },
    floodEvents: [
      { year: 1978, text: 'Yamuna at 207.49 m at Old Railway Bridge — then a record; floodplain colonies inundated.' },
      { year: 2010, text: 'Yamuna at 207.11 m — floodplain settlements evacuated, water reached ring-road edges.' },
      { year: 2023, text: '13 July — record 208.66 m; Yamuna Bazar, ITO and floodplain colonies submerged.' }
    ],
    locations: [
      LOC('Yamuna Bazar',   28.6667, 77.2280, 4, 'dense-residential', 2, 95, 'Active Yamuna floodplain; submerged in the July 2023 flood.'),
      LOC('Civil Lines',    28.6750, 77.2240, 3, 'residential',       3, 75, 'Near the Yamuna; 2023 floodwater reached outer margins.'),
      LOC('ITO',            28.6285, 77.2416, 4, 'dense-residential', 2, 80, 'Riverside node; 2023 floodwater flowed over the road section.'),
      LOC('Okhla',          28.5370, 77.2740, 4, 'mixed',             2, 70, 'Yamuna floodplain edge near the barrage; backflow-prone.'),
      LOC('Mayur Vihar I',  28.6090, 77.2890, 4, 'residential',       3, 65, 'Across the river from the active floodplain; embankment-protected.'),
      LOC('Anand Vihar',    28.6486, 77.3155, 4, 'mixed',             2, 55, 'Dense east Delhi hub; waterlogging in cloudbursts.'),
      LOC('Connaught Place',28.6315, 77.2167, 4, 'mixed',             3, 35, 'Planned core with graded drains; localised puddling only.'),
      LOC('Karol Bagh',     28.6512, 77.1907, 5, 'dense-residential', 3, 40, 'Very dense commercial-residential; waterlogging in intense rain.'),
      LOC('Chandni Chowk',  28.6507, 77.2334, 5, 'dense-residential', 2, 45, 'Old city; narrow drains, frequent waterlogging.'),
      LOC('Rohini',         28.7495, 77.0565, 4, 'residential',       3, 30, 'Planned sub-city away from the river; occasional local ponding.'),
      LOC('Dwarka',         28.5921, 77.0460, 3, 'residential',       3, 30, 'Planned sub-city on relatively higher ground.'),
      LOC('Vasant Kunj',    28.5204, 77.1585, 3, 'residential',       3, 25, 'Ridge-adjacent, higher elevation; limited flood exposure.'),
      LOC('Saket',          28.5245, 77.2066, 4, 'residential',       3, 30, 'Elevated planned area; minor waterlogging spots.'),
      LOC('Narela',         28.8227, 77.0929, 2, 'peri-urban',        2, 35, 'Northern agricultural fringe; limited drainage infrastructure.')
    ]
  }
};

/* ============================== 3. STATE ================================ */

const state = {
  cityId: 'pune',
  view: 'dashboard',
  riskFilter: 'all',
  weather: null,                 // parsed Open-Meteo payload for current city
  elevations: {},                // locality name -> elevation (m)
  elevMeta: { source: null, at: null },
  osm: null,                     // { per: {name:{counts,water}}, at }
  results: {},                   // locality name -> { parts, score, cls }
  sim: { rain: 0, drain: 0, green: 0 },
  status: {},                    // weather/elev/osm -> {state, at, msg}
  lastWxFetch: {},               // cityId -> timestamp (per-city anti-spam guard)
  inflight: {},
  charts: {},
  map: null, markerLayer: null,
  modalChart: null
};

/* ============================== 4. UTILS ================================ */

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const nfIN = new Intl.NumberFormat('en-IN');
const fmt0  = v => Number.isFinite(v) ? nfIN.format(Math.round(v)) : '—';
const fmt1  = v => Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
const fmtInt = fmt0;
const cap   = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const esc   = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtWhen(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchJSON(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status + (res.status === 429 ? ' (rate limited)' : ''));
    return await res.json();
  } finally { clearTimeout(t); }
}

/* localStorage cache — safe on file:// and private mode */
function cacheGet(key, ttl) {
  try {
    const o = JSON.parse(localStorage.getItem(key));
    if (o && (Date.now() - o.at) < ttl) return o;
  } catch (e) { /* ignore */ }
  return null;
}
function cacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch (e) { /* ignore */ }
}
function clearCache() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith('us_')).forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

let toastTimer = null;
function showToast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (kind === 'err' ? ' err' : kind === 'warn' ? ' warn' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

function classify(score) {
  if (score == null || !Number.isFinite(score)) return null;
  if (score <= 30) return 'low';
  if (score <= 60) return 'medium';
  return 'high';
}

/* ========================= 5. DATA ACCESS LAYER ========================= */

/* Prevent duplicate parallel calls to the same endpoint */
function once(key, fn) {
  if (state.inflight[key]) return state.inflight[key];
  state.inflight[key] = fn().finally(() => { delete state.inflight[key]; });
  return state.inflight[key];
}

function setStatus(key, st, msg) {
  state.status[key] = { state: st, at: Date.now(), msg: msg || '' };
}

function weatherURL(lat, lon) {
  return 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m'
    + '&hourly=precipitation'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max'
    + '&past_days=1&forecast_days=3&timezone=auto';
}

/* String-based time handling (no Date parsing pitfalls across timezones) */
function parseWeather(json) {
  const c = json.current, h = json.hourly, d = json.daily;
  const idx = h.time.indexOf(c.time.slice(0, 13) + ':00');
  const i = idx >= 0 ? idx : 24;
  const vals = h.precipitation || [];
  const sum = arr => arr.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);

  const past24 = sum(vals.slice(Math.max(0, i - 23), i + 1));
  const next24 = sum(vals.slice(i + 1, i + 25));
  const from = Math.max(0, i - 23), to = Math.min(vals.length, i + 25);

  const series = {
    labels: h.time.slice(from, to).map(t => t.slice(11, 16)),
    vals: vals.slice(from, to),
    nowIdx: i - from
  };
  const daily = (d.time || []).map((t, k) => ({
    date: t,
    desc: WMO[d.weather_code[k]] || '—',
    tmax: d.temperature_2m_max[k], tmin: d.temperature_2m_min[k],
    prmm: d.precipitation_sum[k],
    prob: Array.isArray(d.precipitation_probability_max) ? d.precipitation_probability_max[k] : null
  }));

  return {
    temp: c.temperature_2m, humidity: c.relative_humidity_2m, precipNow: c.precipitation,
    code: c.weather_code, desc: WMO[c.weather_code] || '—', wind: c.wind_speed_10m,
    rain24Past: past24, rain24Next: next24, rain48: past24 + next24,
    series, daily, fetchedAt: Date.now()
  };
}

async function loadWeather(force = false) {
  const city = CITIES[state.cityId];
  const cached = cacheGet('us_wx_' + state.cityId, TTL.weather);
  if (!force && cached) {
    state.weather = cached.data;
    setStatus('weather', 'cached', 'from local cache');
    return;
  }
  if (!force && Date.now() - (state.lastWxFetch[state.cityId] || 0) < MIN_WEATHER_GAP) return;

  return once('wx_' + state.cityId, async () => {
    try {
      const json = await fetchJSON(weatherURL(city.center[0], city.center[1]));
      state.weather = parseWeather(json);
      state.lastWxFetch[state.cityId] = Date.now();
      cacheSet('us_wx_' + state.cityId, state.weather);
      setStatus('weather', 'ok', 'Open-Meteo live');
    } catch (err) {
      const stale = cacheGet('us_wx_' + state.cityId, Infinity); // any age
      if (stale) { state.weather = stale.data; }
      setStatus('weather', state.weather ? 'stale' : 'fail', err.message);
      showToast('Weather API unavailable — ' + err.message + (state.weather ? '. Showing cached values.' : '. Rainfall factor disabled.'), 'warn');
    }
  });
}

/* Elevation: Open Topo Data first (as requested), Open-Meteo Elevation as
   automatic fallback — Open Topo Data does not send CORS headers to browsers. */
let otdBlocked = false;

async function loadElevation() {
  const city = CITIES[state.cityId];
  const key = 'us_elev_' + state.cityId;
  const cached = cacheGet(key, TTL.elev);
  if (cached) {
    state.elevations = cached.data.map;
    state.elevMeta = { source: cached.data.source, at: cached.at };
    setStatus('elev', 'cached', cached.data.source);
    return;
  }
  return once('elev_' + state.cityId, async () => {
    const names = city.locations.map(l => l.name);
    // 1) Open Topo Data (ASTER 30 m)
    if (!otdBlocked) {
      try {
        const q = city.locations.map(l => `${l.lat.toFixed(4)},${l.lon.toFixed(4)}`).join('|');
        const j = await fetchJSON(`https://api.opentopodata.org/v1/aster30m?locations=${encodeURIComponent(q)}&interpolation=nearest`);
        const map = {};
        names.forEach((n, i) => { map[n] = j.results[i] ? j.results[i].elevation : null; });
        state.elevations = map;
        state.elevMeta = { source: 'Open Topo Data — ASTER 30 m', at: Date.now() };
        cacheSet(key, { map, source: state.elevMeta.source });
        setStatus('elev', 'ok', state.elevMeta.source);
        return;
      } catch (err) {
        otdBlocked = true; // browser CORS/network block — remember for this session
      }
    }
    // 2) Fallback: Open-Meteo Elevation (Copernicus DEM GLO-90)
    try {
      const lats = city.locations.map(l => l.lat).join(',');
      const lons = city.locations.map(l => l.lon).join(',');
      const j = await fetchJSON(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`);
      const map = {};
      names.forEach((n, i) => { map[n] = Array.isArray(j.elevation) ? j.elevation[i] : null; });
      state.elevations = map;
      state.elevMeta = { source: 'Open-Meteo Elevation — Copernicus DEM 90 m (fallback)', at: Date.now() };
      cacheSet(key, { map, source: state.elevMeta.source });
      setStatus('elev', 'ok', state.elevMeta.source);
    } catch (err) {
      state.elevations = {};
      state.elevMeta = { source: null, at: null };
      setStatus('elev', 'fail', err.message);
      showToast('Elevation API unavailable — elevation factor disabled (weight redistributed).', 'warn');
    }
  });
}

/* OSM land-use context via Overpass — one query covers every locality.
   Purely informational: shown in the location details, never fabricated. */
const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function loadOsm() {
  const city = CITIES[state.cityId];
  const key = 'us_osm_' + state.cityId;
  const cached = cacheGet(key, TTL.osm);
  if (cached) {
    state.osm = cached.data;
    setStatus('osm', 'cached', 'Overpass (OSM), cached');
    return;
  }
  return once('osm_' + state.cityId, async () => {
    const pts = city.locations.map(l => `${l.lat},${l.lon}`).join(',');
    const query = `[out:json][timeout:25];(way["landuse"](around:1200,${pts});relation["landuse"](around:1200,${pts});way["natural"="water"](around:1200,${pts}););out body center 600;`;
    const body = 'data=' + encodeURIComponent(query);
    let lastErr = null;
    for (const ep of OVERPASS_ENDPOINTS) {
      try {
        const j = await fetchJSON(ep, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 20000);
        const per = {};
        city.locations.forEach(l => per[l.name] = { counts: {}, water: null });
        (j.elements || []).forEach(el => {
          const tags = el.tags || {};
          const c = el.center; if (!c) return;
          city.locations.forEach(l => {
            if (haversine(l.lat, l.lon, c.lat, c.lon) > 1200) return;
            if (tags.landuse) {
              const k = OSM_LANDUSE_LABEL[tags.landuse] || tags.landuse;
              per[l.name].counts[k] = (per[l.name].counts[k] || 0) + 1;
            } else if (tags.natural === 'water') {
              const d = haversine(l.lat, l.lon, c.lat, c.lon);
              if (per[l.name].water == null || d < per[l.name].water) per[l.name].water = d;
            }
          });
        });
        state.osm = { per, at: Date.now() };
        cacheSet(key, state.osm);
        setStatus('osm', 'ok', 'Overpass (OSM) live');
        return;
      } catch (err) { lastErr = err; }
    }
    state.osm = null;
    setStatus('osm', 'fail', lastErr ? lastErr.message : 'unreachable');
  });
}

/* ------------------------- refresh orchestration ------------------------- */

async function refreshData(force = false) {
  const btn = $('#btnRefresh');
  const label = btn.querySelector('span');
  btn.disabled = true;
  label.textContent = 'Refreshing…';
  try {
    await Promise.all([loadWeather(force), loadElevation(), loadOsm()]);
  } finally {
    renderAll();
    btn.disabled = false;
    label.textContent = 'Refresh Data';   // deterministic restore (no stale capture)
  }
}

/* ========================== 6. SCORING ENGINE =========================== */

function elevRange() {
  const vals = Object.values(state.elevations).filter(Number.isFinite);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

/* Build the six factor parts for one locality. Every part carries a badge so
   the UI can distinguish measurement / model / estimate / unavailable. */
function factorParts(loc) {
  const rng = elevRange();
  const parts = [];

  /* 1 · Rainfall — live weather (model mixes observed + forecast hours) */
  if (state.weather && Number.isFinite(state.weather.rain48)) {
    const w = state.weather;
    parts.push({ key: 'rain', label: 'Rainfall (48 h exposure)', weight: WEIGHTS.rain, available: true,
      norm: Math.min(100, (w.rain48 / RAIN_NORM_MAX) * 100), badge: 'MODEL', badgeCls: 'b-model',
      value: `${fmt1(w.rain48)} mm`,
      note: `${fmt1(w.rain24Past)} mm last 24 h (observed) + ${fmt1(w.rain24Next)} mm next 24 h (forecast), city centre` });
  } else {
    parts.push({ key: 'rain', label: 'Rainfall (48 h exposure)', weight: WEIGHTS.rain, available: false,
      norm: 0, badge: 'UNAVAILABLE', badgeCls: 'b-na', value: '—', note: 'Weather API unreachable' });
  }

  /* 2 · Elevation — real DEM measurement, normalised city-relative */
  const e = state.elevations[loc.name];
  if (Number.isFinite(e) && rng) {
    const rel = (rng.max - rng.min) < 1 ? 0.5 : (e - rng.min) / (rng.max - rng.min);
    parts.push({ key: 'elev', label: 'Elevation', weight: WEIGHTS.elev, available: true,
      norm: 100 - rel * 100, badge: 'MEASURED', badgeCls: 'b-measured',
      value: `${fmt0(e)} m`,
      note: `City-relative — lowest analysed point ${fmt0(rng.min)} m, highest ${fmt0(rng.max)} m` });
  } else {
    parts.push({ key: 'elev', label: 'Elevation', weight: WEIGHTS.elev, available: false,
      norm: 0, badge: 'UNAVAILABLE', badgeCls: 'b-na', value: '—', note: 'Elevation API unreachable' });
  }

  /* 3 · Population density — official city value + relative locality tier */
  parts.push({ key: 'pop', label: 'Population density', weight: WEIGHTS.pop, available: true,
    norm: (loc.densityTier / 5) * 100, badge: 'ESTIMATE', badgeCls: 'b-estimate',
    value: `Tier ${loc.densityTier}/5`,
    note: 'Relative tier vs Census 2011 city density — not a ward-level measurement' });

  /* 4 · Land use — assigned class, cross-checked against live OSM tags */
  parts.push({ key: 'land', label: 'Land use', weight: WEIGHTS.land, available: true,
    norm: LANDUSE_SCORE[loc.landuse] || 50, badge: 'ESTIMATE', badgeCls: 'b-estimate',
    value: LANDUSE_LABEL[loc.landuse] || loc.landuse,
    note: 'Assigned dominant class; OSM land-use tags shown for cross-checking' });

  /* 5 · Drainage — no open network data; documented qualitative tier */
  parts.push({ key: 'drain', label: 'Drainage capacity', weight: WEIGHTS.drain, available: true,
    norm: ((6 - loc.drainTier) / 5) * 100, badge: 'ESTIMATE', badgeCls: 'b-estimate',
    value: `Tier ${loc.drainTier}/5 (1 = poor, 5 = good)`,
    note: 'No free drainage-network API exists — analyst tier, clearly an estimate' });

  /* 6 · Flood history — documented events + floodplain proximity tier */
  parts.push({ key: 'flood', label: 'Flood history', weight: WEIGHTS.flood, available: true,
    norm: loc.floodScore, badge: 'ESTIMATE', badgeCls: 'b-estimate',
    value: `${loc.floodScore}/100`,
    note: loc.floodNote });

  return parts;
}

function scoreFrom(parts) {
  let num = 0, wsum = 0;
  parts.forEach(p => { if (p.available) { num += p.norm * p.weight; wsum += p.weight; } });
  const score = wsum > 0 ? num / wsum : null;
  return { score, cls: classify(score) };
}

/* What-If adjustments — only the three slider factors change */
function simulateParts(parts) {
  const s = state.sim;
  return parts.map(p => {
    const q = { ...p };
    if (!q.available) return q;
    if (q.key === 'rain')  q.norm = Math.min(100, p.norm * (1 + s.rain / 100));
    if (q.key === 'drain') q.norm = p.norm * (1 - s.drain / 100);
    if (q.key === 'land')  q.norm = p.norm * (1 - s.green / 100);
    return q;
  });
}

/* Compute live + simulated results for every locality of the active city */
function computeAll() {
  const city = CITIES[state.cityId];
  state.results = {};
  city.locations.forEach(loc => {
    const parts = factorParts(loc);
    const { score, cls } = scoreFrom(parts);
    const simParts = simulateParts(parts);
    const sim = scoreFrom(simParts);
    state.results[loc.name] = { parts, score, cls, simScore: sim.score, simCls: sim.cls };
  });
}

/* ===== PART 2 — UI RENDERING =========================================== */

/* ===================== 7. NAV, TOPBAR & VIEW SWITCH ===================== */

const VIEW_TITLES = { dashboard: 'Dashboard', map: 'City Risk Map', engine: 'Vulnerability Engine', simulator: 'What-If Simulator', ml: 'ML Flood Prediction', sources: 'Data Sources & Methodology' };

function switchView(id) {
  state.view = id;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + id));
  $('#viewTitle').textContent = VIEW_TITLES[id];
  $('#sidebar').classList.remove('open');
  $('#scrim').hidden = true;

  if (id === 'map') {
    if (!state.map) initMap();
    setTimeout(() => { state.map && state.map.invalidateSize(); }, 80);
    rebuildMarkers();
  }
  renderCurrentView();
}

function renderCurrentView() {
  computeAll();
  renderTopbar();
  if (state.view === 'dashboard') renderDashboard();
  if (state.view === 'map')       { updateFilterCounts(); updateMapStatus(); }
  if (state.view === 'engine')    renderEngine();
  if (state.view === 'simulator') renderSimulator();
  if (state.view === 'ml')        renderML();
  if (state.view === 'sources')   renderSources();
  if (state.map) { rebuildMarkers(); }
}

function renderAll() {
  computeAll();
  renderTopbar();
  renderDashboard();
  renderEngine();
  renderSimulator();
  renderSources();
  if (state.map) rebuildMarkers();
}

function setCity(id) {
  state.cityId = id;
  $('#citySelect').value = id;
  const city = CITIES[id];
  $('#citySub').textContent = `${city.name} · ${city.state}`;
  if (state.map) state.map.flyTo(city.center, city.zoom, { duration: 0.8 });
  renderAll();
  refreshData(false);   // cache-first loads, then network
  /* Keep the ML prediction panel in step with the global city selector */
  if (ML.selInited) {
    $('#mlCity').value = id;
    fillMLLocalities();
    renderMLRuleCompare();
  }
}

function renderTopbar() {
  const wx = state.status.weather || {};
  const st = wx.state === 'ok' ? 'ok' : wx.state === 'cached' ? 'ok' : wx.state === 'stale' ? 'warn' : wx.state === 'fail' ? 'bad' : '';
  const dot = $('#statusDot');
  dot.className = 'dot' + (st ? ' ' + st : '');
  $('#lastUpdated').textContent = state.weather ? 'Updated ' + fmtWhen(state.weather.fetchedAt) : 'Awaiting weather…';
}

/* ===================== 8. CHART HELPERS (Chart.js) ====================== */

function chartTheme() {
  Chart.defaults.color = '#8fa3c4';
  Chart.defaults.borderColor = 'rgba(148,163,184,.12)';
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.tooltip.backgroundColor = '#0b1220';
  Chart.defaults.plugins.tooltip.borderColor = '#24365f';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.titleColor = '#e6eefc';
  Chart.defaults.plugins.tooltip.bodyColor = '#b9c8e4';
}

/* Create a chart once; afterwards just update its data in place */
function upsertChart(key, canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (state.charts[key]) {
    const ch = state.charts[key];
    ch.data = config.data;
    if (config.options) ch.options = config.options;
    ch.update('none');
    return ch;
  }
  if (canvas.clientWidth === 0) return null;   // hidden view — create on first activation
  state.charts[key] = new Chart(canvas.getContext('2d'), config);
  return state.charts[key];
}

/* =========================== 9. DASHBOARD =============================== */

function renderDashboard() {
  const city = CITIES[state.cityId];
  const list = city.locations;
  const res = state.results;

  let high = 0, med = 0, low = 0;
  list.forEach(l => { const r = res[l.name]; if (r && r.cls === 'high') high++; else if (r && r.cls === 'medium') med++; else if (r && r.cls === 'low') low++; });

  $('#kpiLocs').textContent = list.length;
  $('#kpiLocsSub').textContent = `${city.name} · analysed this session`;
  $('#kpiHigh').textContent = high;
  $('#kpiMed').textContent = med;
  $('#kpiLow').textContent = low;
  $('#riskCityChip').textContent = city.name;

  const wx = state.weather;
  $('#kpiRain').textContent = wx ? fmt1(wx.precipNow) + ' mm' : '—';
  $('#kpiTemp').textContent = wx ? fmt1(wx.temp) + ' °C' : '—';
  $('#kpiTempSub').textContent = wx ? wx.desc : 'weather API unavailable';
  $('#kpiHum').textContent = wx ? fmt0(wx.humidity) + ' %' : '—';
  $('#kpiUpdated').textContent = wx ? fmtWhen(wx.fetchedAt) : '—';

  /* Forecast cards */
  const fc = $('#forecastCards');
  if (wx && wx.daily.length) {
    fc.innerHTML = wx.daily.slice(0, 3).map((d, k) => `
      <div class="fc-day">
        <div class="fc-name">${k === 0 ? 'Today' : new Date(d.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}</div>
        <div class="fc-desc">${esc(d.desc)}</div>
        <div class="fc-temp">${fmt0(d.tmax)}° / ${fmt0(d.tmin)}°</div>
        <div class="fc-rain">${fmt1(d.prmm)} mm${d.prob != null ? ' · ' + fmt0(d.prob) + '%' : ''}</div>
      </div>`).join('');
  } else {
    fc.innerHTML = '<div class="foot-note">Forecast unavailable — weather API unreachable.</div>';
  }

  /* City profile (Census 2011 = official; density computed in-app) */
  const c = city.census;
  const dens = c.pop / c.areaKm2;
  $('#cityProfile').innerHTML = `
    <div class="prof-row"><span>Population (Census 2011)</span><b>${fmtInt(c.pop)}</b></div>
    <div class="prof-row"><span>Area (civic limits)</span><b>${fmt1(c.areaKm2)} km²</b></div>
    <div class="prof-row"><span>Density (computed)</span><b>${fmt0(dens)} /km²</b></div>
    <div class="prof-row"><span>Major waterways</span><b>${city.rivers}</b></div>`;

  /* Chart 1 — risk distribution doughnut */
  upsertChart('risk', 'riskDoughnut', {
    type: 'doughnut',
    data: {
      labels: ['High risk', 'Medium risk', 'Low risk'],
      datasets: [{ data: [high, med, low], backgroundColor: [CLASS_COLORS.high, CLASS_COLORS.medium, CLASS_COLORS.low], borderColor: '#0c1428', borderWidth: 3, hoverOffset: 6 }]
    },
    options: { maintainAspectRatio: false, cutout: '66%', plugins: { legend: { position: 'bottom' } } }
  });

  /* Chart 2 — 48 h rainfall timeline */
  if (wx) {
    const grad = canvas => {
      const g = canvas.getContext('2d').createLinearGradient(0, 0, 0, 240);
      g.addColorStop(0, 'rgba(34,211,238,.35)'); g.addColorStop(1, 'rgba(34,211,238,0)');
      return g;
    };
    upsertChart('rain', 'rainLine', {
      type: 'line',
      data: {
        labels: wx.series.labels,
        datasets: [{ label: 'mm/h', data: wx.series.vals, borderColor: '#22d3ee', borderWidth: 2,
          backgroundColor: grad(document.getElementById('rainLine')), fill: true, tension: .35,
          pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#22d3ee' }]
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 8, maxRotation: 0, callback(v, i) { return i % 6 === 0 ? this.getLabelForValue(v) : ''; } }, grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: 'mm / h' }, ticks: { maxTicksLimit: 6 } }
        }
      }
    });
  }

  /* Chart 3 — highest-risk locations */
  const top = list.map(l => ({ n: l.name, s: res[l.name].score })).filter(x => x.s != null)
    .sort((a, b) => b.s - a.s).slice(0, 8).reverse();
  upsertChart('top', 'topBar', {
    type: 'bar',
    data: {
      labels: top.map(x => x.n),
      datasets: [{ data: top.map(x => x.s), backgroundColor: top.map(x => CLASS_COLORS[classify(x.s)]), borderRadius: 5, barThickness: 16 }]
    },
    options: {
      maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { min: 0, max: 100, ticks: { maxTicksLimit: 6 } }, y: { grid: { display: false } } }
    }
  });
}

/* ============================== 10. MAP ================================= */

function initMap() {
  if (typeof L === 'undefined') return;   // Leaflet CDN blocked — banner already shown
  const city = CITIES[state.cityId];
  state.map = L.map('map', { zoomControl: true, attributionControl: true }).setView(city.center, city.zoom);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIB }).addTo(state.map);
  L.control.scale({ imperial: false }).addTo(state.map);

  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const d = L.DomUtil.create('div', 'map-legend');
    d.innerHTML = '<span><i style="background:#ef4444"></i>High 61–100</span><span><i style="background:#f59e0b"></i>Medium 31–60</span><span><i style="background:#22c55e"></i>Low 0–30</span>';
    return d;
  };
  legend.addTo(state.map);

  state.markerLayer = L.layerGroup().addTo(state.map);
  rebuildMarkers();
  updateMapStatus();
}

function rebuildMarkers() {
  if (!state.map || !state.markerLayer) return;
  state.markerLayer.clearLayers();
  const list = CITIES[state.cityId].locations;
  list.forEach(loc => {
    const r = state.results[loc.name];
    if (!r || r.score == null) return;                       // insufficient data
    if (state.riskFilter !== 'all' && r.cls !== state.riskFilter) return;
    const m = L.circleMarker([loc.lat, loc.lon], {
      radius: r.cls === 'high' ? 11 : 9,
      color: 'rgba(255,255,255,.85)', weight: 1.5,
      fillColor: CLASS_COLORS[r.cls], fillOpacity: .88
    });
    m.bindTooltip(`<b>${esc(loc.name)}</b> · ${fmt1(r.score)} (${cap(r.cls)} risk)`, { direction: 'top', offset: [0, -6] });
    m.on('click', () => openLocation(loc.name));
    state.markerLayer.addLayer(m);
  });
}

function updateFilterCounts() {
  let high = 0, med = 0, low = 0;
  CITIES[state.cityId].locations.forEach(l => {
    const r = state.results[l.name];
    if (r && r.cls === 'high') high++; else if (r && r.cls === 'medium') med++; else if (r && r.cls === 'low') low++;
  });
  $('#cntAll').textContent = high + med + low;
  $('#cntHigh').textContent = high;
  $('#cntMed').textContent = med;
  $('#cntLow').textContent = low;
}

function statusLabel(k) {
  const s = (state.status[k] || {}).state;
  return s === 'ok' ? ['ok', 'live'] : s === 'cached' ? ['ok', 'cached'] : s === 'stale' ? ['warn', 'stale'] : s === 'fail' ? ['bad', 'unavailable'] : ['', 'waiting'];
}

function updateMapStatus() {
  const wx = statusLabel('weather'), el = statusLabel('elev'), os = statusLabel('osm');
  $('#mapStatus').innerHTML =
    `<span><i class="dot ${wx[0]}"></i>Weather ${wx[1]}</span>` +
    `<span><i class="dot ${el[0]}"></i>Elevation ${el[1]}</span>` +
    `<span><i class="dot ${os[0]}"></i>OSM land-use ${os[1]}</span>`;
}

/* ============================== 11. MODAL =============================== */

function badgeEl(p) { return `<span class="badge ${p.badgeCls}">${p.badge}</span>`; }

function openLocation(name) {
  const city = CITIES[state.cityId];
  const loc = city.locations.find(l => l.name === name);
  const r = state.results[name];
  if (!loc || !r) return;

  $('#modalTitle').textContent = loc.name;
  $('#modalSub').textContent =
    (r.score != null ? `${fmt1(r.score)} / 100 · ${cap(r.cls)} risk · ` : '') +
    `${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)} · ${city.name}`;

  /* Factor rows with contribution maths */
  $('#modalBody').innerHTML = r.parts.map(p => {
    const pct = (p.available && r.score > 0) ? (p.norm * p.weight / r.score * 100) : 0;
    return `
      <div class="frow ${p.available ? '' : 'na'}">
        <div class="frow-top"><b>${esc(p.label)}</b>${badgeEl(p)}</div>
        <div class="frow-val">${esc(p.value)} <small>· ${esc(p.note)}</small></div>
        <div class="fbar"><i style="width:${Math.min(100, p.norm).toFixed(1)}%; background:${p.available ? 'linear-gradient(90deg,#22d3ee,#3b82f6)' : '#2a3a63'}"></i></div>
        <div class="frow-sub">${p.available
          ? `factor score ${fmt1(p.norm)}/100 × weight ${Math.round(p.weight * 100)}% → ${(p.norm * p.weight).toFixed(1)} pts (${fmt1(pct)}% of total)`
          : 'weight redistributed across available factors — no value invented'}</div>
      </div>`;
  }).join('');

  /* OSM land-use cross-check (live data, informational only) */
  const osmBlock = state.osm && state.osm.per[name]
    ? (() => {
        const o = state.osm.per[name];
        const entries = Object.entries(o.counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const mix = entries.length ? entries.map(([k, v]) => `${esc(k)} ×${v}`).join(' · ') : 'no land-use polygons tagged nearby';
        const water = o.water != null ? `nearest water polygon centre ≈ ${fmt0(o.water)} m` : 'no water polygon centre within 1.2 km';
        return `<div class="modal-osm"><b>OpenStreetMap cross-check (live Overpass query, ≈1.2 km radius):</b><br>Land-use tags — ${mix}.<br>${water}. Feature counts are context, not area shares.</div>`;
      })()
    : `<div class="modal-osm"><b>OSM land-use query unavailable</b> (Overpass service busy or unreachable). The assigned land-use class above is used for scoring; no replacement data was fabricated.</div>`;

  const floodRow = `<div class="modal-osm" style="border-color:rgba(245,158,11,.4)"><b>Flood history (documented estimate):</b> ${esc(loc.floodNote)} See <b>Data Sources</b> for the event records behind this tier.</div>`;

  $('#modalBody').insertAdjacentHTML('beforeend', osmBlock + floodRow +
    `<p class="modal-formula">Vulnerability score = Σ (normalised factor × weight) ÷ Σ (weights of available factors) · 0–30 Low · 31–60 Medium · 61–100 High. Heuristic demonstration — not scientifically validated, not an official warning.</p>`);

  /* Contribution chart */
  const canvas = document.getElementById('modalChart');
  if (state.modalChart) { state.modalChart.destroy(); state.modalChart = null; }
  if (canvas && typeof Chart !== 'undefined' && r.score != null) {
    const pts = r.parts.map(p => p.available ? p.norm * p.weight : 0);
    state.modalChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: r.parts.map(p => p.label),
        datasets: [{ label: 'Points contributed', data: pts,
          backgroundColor: r.parts.map(p => p.available ? 'rgba(34,211,238,.75)' : 'rgba(148,163,184,.25)'),
          borderRadius: 5, barThickness: 14 }]
      },
      options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, suggestedMax: 25, title: { display: true, text: 'score points (norm × weight)' } }, y: { grid: { display: false } } } }
    });
  }

  $('#modal').hidden = false;
}

function closeModal() {
  $('#modal').hidden = true;
  if (state.modalChart) { state.modalChart.destroy(); state.modalChart = null; }
}

/* ========================= 12. ENGINE VIEW ============================== */

function factorMeta() {
  return [
    { key: 'rain',  label: 'Rainfall (48 h exposure)', w: WEIGHTS.rain,  badge: 'MODEL',    badgeCls: 'b-model',
      src: 'Open-Meteo — 24 h observed + 24 h forecast precipitation, city centre',
      norm: '0 mm → 0 · ≥200 mm → 100 · linear in between' },
    { key: 'elev',  label: 'Elevation',                w: WEIGHTS.elev,  badge: 'MEASURED', badgeCls: 'b-measured',
      src: 'ASTER 30 m DEM via Open Topo Data (browser fallback: Copernicus 90 m)',
      norm: 'lowest analysed point → 100 · highest → 0 (city-relative)' },
    { key: 'pop',   label: 'Population density',       w: WEIGHTS.pop,   badge: 'ESTIMATE', badgeCls: 'b-estimate',
      src: 'Census of India 2011 city density + relative locality tier (1–5)',
      norm: 'tier ÷ 5 × 100' },
    { key: 'land',  label: 'Land use',                 w: WEIGHTS.land,  badge: 'ESTIMATE', badgeCls: 'b-estimate',
      src: 'Assigned dominant class, cross-checked against live OSM land-use tags',
      norm: 'industrial 80 · dense residential 75 · residential 60 · mixed 55 · peri-urban 40 · green 20' },
    { key: 'drain', label: 'Drainage capacity',        w: WEIGHTS.drain, badge: 'ESTIMATE', badgeCls: 'b-estimate',
      src: 'No open drainage-network API — qualitative tier (1 = poor … 5 = good)',
      norm: '(6 − tier) ÷ 5 × 100' },
    { key: 'flood', label: 'Flood history',            w: WEIGHTS.flood, badge: 'ESTIMATE', badgeCls: 'b-estimate',
      src: 'Documented events (Data Sources page) + floodplain proximity tier',
      norm: 'analyst tier 0–100' }
  ];
}

function renderEngine() {
  const city = CITIES[state.cityId];

  /* Weights table */
  $('#weightsBody').innerHTML = factorMeta().map(f => `
    <tr>
      <td class="loc-name">${esc(f.label)}</td>
      <td><b>${Math.round(f.w * 100)}%</b></td>
      <td><span class="badge ${f.badgeCls}">${f.badge}</span></td>
      <td class="td-muted">${esc(f.src)}<br><span style="color:var(--faint)">Normalisation: ${esc(f.norm)}</span></td>
    </tr>`).join('');
  $('#factorCityChip').textContent = city.name;

  /* Average contribution share doughnut */
  const palette = ['#22d3ee', '#3b82f6', '#a78bfa', '#34d399', '#f59e0b', '#f472b6'];
  const totals = {}; let totAll = 0;
  city.locations.forEach(l => {
    const r = state.results[l.name]; if (!r || r.score == null || r.score <= 0) return;
    r.parts.forEach(p => { if (p.available) { const pts = p.norm * p.weight; totals[p.key] = (totals[p.key] || 0) + pts; totAll += pts; } });
  });
  const keys = factorMeta().map(f => f.key);
  upsertChart('factor', 'factorChart', {
    type: 'doughnut',
    data: {
      labels: factorMeta().map(f => f.label),
      datasets: [{ data: keys.map(k => totAll > 0 ? (totals[k] || 0) / totAll * 100 : 0),
        backgroundColor: palette, borderColor: '#0c1428', borderWidth: 3, hoverOffset: 6 }]
    },
    options: { maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right' },
      tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt1(ctx.parsed)}% of total contribution` } } } }
  });

  /* Locations table */
  $('#locTableBody').innerHTML = city.locations.map(loc => {
    const r = state.results[loc.name];
    const e = state.elevations[loc.name];
    const color = r.cls ? CLASS_COLORS[r.cls] : '#5b6f93';
    return `
      <tr>
        <td class="loc-name">${esc(loc.name)}</td>
        <td>${Number.isFinite(e) ? fmt0(e) + ' m' : '—'} <span class="badge ${Number.isFinite(e) ? 'b-measured' : 'b-na'}">${Number.isFinite(e) ? 'measured' : 'n/a'}</span></td>
        <td class="td-muted">${loc.densityTier}/5 · ${esc(LANDUSE_LABEL[loc.landuse])}</td>
        <td class="td-muted">${loc.drainTier}/5</td>
        <td class="td-muted">${loc.floodScore}/100</td>
        <td><span class="scorebar"><i style="width:${r.score != null ? Math.min(100, r.score) : 0}%; background:${color}"></i></span><b>${r.score != null ? fmt1(r.score) : '—'}</b></td>
        <td>${r.cls ? `<span class="chip-class ${'c-' + r.cls}">${cap(r.cls)}</span>` : '<span class="badge b-na">n/a</span>'}</td>
        <td><button class="row-btn" data-loc="${esc(loc.name)}">Details</button></td>
      </tr>`;
  }).join('');
}

/* ========================== 13. SIMULATOR =============================== */

function renderSimulator() {
  const city = CITIES[state.cityId];
  const list = city.locations;
  const res = state.results;

  $('#simRainOut').textContent = '+' + state.sim.rain + '%';
  $('#simDrainOut').textContent = '+' + state.sim.drain + '%';
  $('#simGreenOut').textContent = '+' + state.sim.green + '%';

  let origSum = 0, simSum = 0, oN = 0, sN = 0, highBefore = 0, highAfter = 0;
  const rows = [];
  list.forEach(loc => {
    const r = res[loc.name];
    if (r && r.score != null) { origSum += r.score; oN++; if (r.cls === 'high') highBefore++; }
    if (r && r.simScore != null) { simSum += r.simScore; sN++; if (r.simCls === 'high') highAfter++; }
    rows.push({ name: loc.name, o: r.score, s: r.simScore, oCls: r.cls, sCls: r.simCls });
  });

  const origAvg = oN ? origSum / oN : null;
  const simAvg = sN ? simSum / sN : null;
  const delta = (origAvg != null && simAvg != null) ? simAvg - origAvg : null;

  $('#simOrig').textContent = origAvg != null ? fmt1(origAvg) : '—';
  $('#simNew').textContent = simAvg != null ? fmt1(simAvg) : '—';
  if (delta != null) {
    const el = $('#simDelta');
    el.textContent = (delta > 0 ? '+' : '') + fmt1(delta);
    el.className = 'kpi-value ' + (delta > 0.05 ? 'c-high' : delta < -0.05 ? 'c-low' : '');
    $('#simDeltaSub').textContent = delta < -0.05 ? 'risk reduction' : delta > 0.05 ? 'risk increase' : 'no meaningful change';
  } else {
    $('#simDelta').textContent = '—'; $('#simDeltaSub').textContent = '—';
  }
  $('#simHigh').textContent = `${highBefore} → ${highAfter}`;

  const clsBefore = classify(origAvg), clsAfter = classify(simAvg);
  $('#simClassChip').textContent = clsBefore && clsAfter && clsBefore !== clsAfter
    ? `City class: ${cap(clsBefore)} → ${cap(clsAfter)}`
    : clsBefore ? `City class: ${cap(clsBefore)} (unchanged)` : '—';

  /* Before/after chart */
  const names = rows.map(r => r.name);
  upsertChart('sim', 'simChart', {
    type: 'bar',
    data: {
      labels: names,
      datasets: [
        { label: 'Original', data: rows.map(r => r.o), backgroundColor: 'rgba(96,165,250,.55)', borderRadius: 3, barPercentage: .9, categoryPercentage: .62 },
        { label: 'Simulated', data: rows.map(r => r.s), backgroundColor: rows.map(r => r.s != null ? CLASS_COLORS[classify(r.s)] : '#33456f'), borderRadius: 3, barPercentage: .9, categoryPercentage: .62 }
      ]
    },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } },
      scales: { x: { ticks: { maxRotation: 60, minRotation: 35, font: { size: 10 } }, grid: { display: false } },
                y: { min: 0, max: 100, title: { display: true, text: 'vulnerability score' } } } }
  });

  /* Table */
  $('#simTableBody').innerHTML = rows.map(r => {
    if (r.o == null || r.s == null) {
      return `<tr><td class="loc-name">${esc(r.name)}</td><td colspan="4" class="td-muted">insufficient data (API unavailable)</td></tr>`;
    }
    const d = r.s - r.o;
    const changed = r.oCls !== r.sCls;
    return `
      <tr>
        <td class="loc-name">${esc(r.name)}</td>
        <td>${fmt1(r.o)} <span class="chip-class ${'c-' + r.oCls}" style="font-size:10px">${cap(r.oCls)}</span></td>
        <td>${fmt1(r.s)} <span class="chip-class ${'c-' + r.sCls}" style="font-size:10px">${cap(r.sCls)}</span></td>
        <td style="color:${d < -0.05 ? 'var(--green)' : d > 0.05 ? 'var(--red)' : 'var(--muted)'}"><b>${(d > 0 ? '+' : '') + fmt1(d)}</b></td>
        <td class="td-muted">${changed ? `${cap(r.oCls)} → <b style="color:var(--text)">${cap(r.sCls)}</b>` : 'unchanged'}</td>
      </tr>`;
  }).join('');
}

/* =========================== 14. SOURCES ================================ */

function renderSources() {
  const city = CITIES[state.cityId];

  const srcDefs = [
    { id: 'weather', title: 'Open-Meteo — weather & forecast', url: 'https://open-meteo.com/en/docs',
      note: 'Current temperature, precipitation, humidity, wind, hourly rainfall (24 h observed + 24 h forecast) and 3-day daily forecast. Free, key-less.', extra: 'Auto-refresh: 15 min · manual: Refresh Data button' },
    { id: 'elev', title: 'Elevation — Open Topo Data (ASTER 30 m)', url: 'https://www.opentopodata.org/',
      note: () => state.elevMeta.source
        ? `Active source this session: <b>${esc(state.elevMeta.source)}</b>. Open Topo Data is queried first; if the browser cannot read it (no CORS header is sent), the app falls back to the Open-Meteo Elevation API (Copernicus DEM GLO-90) automatically — clearly labelled, never fabricated.`
        : 'Elevation API unreachable this session — the elevation factor is disabled and its weight redistributed across the remaining factors.',
      extra: 'Rate limits respected · cached 7 days (static data)' },
    { id: 'osm', title: 'OpenStreetMap — tiles & land-use (Overpass)', url: 'https://www.openstreetmap.org/',
      note: () => (state.status.osm || {}).state === 'fail'
        ? 'Overpass land-use query unreachable this session. The map still uses OSM raster tiles; land-use cross-checks show an explicit unavailable message.'
        : 'Leaflet renders standard OpenStreetMap tiles with a CSS dark-mode display filter (data © OpenStreetMap contributors). A single Overpass query collects land-use tags and water bodies within ≈1.2 km of every locality for the details panel.',
      extra: 'Cached 24 h · two public Overpass mirrors tried in turn' }
  ];

  $('#srcList').innerHTML = srcDefs.map(s => {
    const [dotCls, txt] = statusLabel(s.id);
    const when = (state.status[s.id] || {}).at;
    return `
      <div class="src-item">
        <div class="src-info">
          <h4><a href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a></h4>
          <p>${typeof s.note === 'function' ? s.note() : s.note}</p>
          <p style="color:var(--faint)">${esc(s.extra)}</p>
        </div>
        <div class="src-status">
          <span class="badge ${dotCls === 'ok' ? 'b-obs' : dotCls === 'warn' ? 'b-estimate' : dotCls === 'bad' ? 'b-na' : 'b-model'}">${txt.toUpperCase()}</span>
          <span class="when">${fmtWhen(when)}</span>
        </div>
      </div>`;
  }).join('');

  /* Census table — official figures, density computed in-app */
  $('#censusBody').innerHTML = Object.values(CITIES).map(c => {
    const dens = c.census.pop / c.census.areaKm2;
    const active = c.name === city.name ? ' style="background:rgba(34,211,238,.06)"' : '';
    return `<tr${active}>
      <td class="loc-name">${c.name}${c.name === city.name ? ' ←' : ''}</td>
      <td>${fmtInt(c.census.pop)}</td>
      <td>${fmt1(c.census.areaKm2)} km²</td>
      <td><b>${fmt0(dens)}</b> /km²</td>
    </tr>`;
  }).join('');

  /* Flood events — public records */
  $('#floodLists').innerHTML = Object.values(CITIES).map(c => `
    <div class="flood-col">
      <h4>${c.name}</h4>
      <ul>${c.floodEvents.map(ev => `<li><b>${ev.year}</b> — ${esc(ev.text)}</li>`).join('')}</ul>
    </div>`).join('');
}

/* ============ 14b. ML FLOOD PREDICTION (genuine trained models) ========== */
/* Real scikit-learn classifiers (Random Forest, Decision Tree, Logistic
   Regression) are trained by backend/train_ml.py on the IMD Kerala rainfall
   dataset (1901–2018, published flood labels) and served by backend/app.py.
   NOTHING here is hardcoded: metrics, dataset facts, limitations and every
   prediction come from the training report / live API — if the backend is
   offline the panel says so instead of inventing numbers. The rule-based
   six-factor engine above is a heuristic, NOT machine learning, and both
   engines are displayed side by side so they can be compared. */

const ML = { info: null, loading: false, failed: false, api: null, exIdx: 0, selInited: false };

async function mlResolveApi() {
  /* Same origin when served by Flask; fall back to http://127.0.0.1:5000/ when
     the site is opened via Live Server or file:// (Flask sends CORS headers).
     The trailing slash matters: code below concatenates base + 'api/…'. */
  if (ML.api !== null) return ML.api;
  try {
    const r = await fetch('api/ml/info', { cache: 'no-store' });
    ML.api = (r.ok || r.status === 503) ? '' : 'http://127.0.0.1:5000/';
  } catch (e) { ML.api = 'http://127.0.0.1:5000/'; }
  return ML.api;
}

function mlFmt(v, d = 3) { return v == null ? '—' : Number(v).toFixed(d); }

function mlOffline(msg) {
  $('#mlOffline').hidden = false;
  $('#mlOfflineMsg').textContent = msg;
  $('#btnMlPredict').disabled = true;
  $('#mlAlgoBadge').textContent = 'OFFLINE';
}

function renderML() {
  ensureMLSelectors();
  renderMLRuleCompare();
  if (ML.info) { renderMLReport(); return; }
  if (ML.failed || ML.loading) return;
  ML.loading = true;
  (async () => {
    try {
      const base = await mlResolveApi();
      const r = await fetch(base + 'api/ml/info', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) { ML.failed = true; mlOffline(j.error || 'Backend reachable but the model is not trained yet.'); return; }
      ML.info = j.report;
      renderMLReport();
    } catch (e) {
      ML.failed = true;
      mlOffline('Could not reach the ML backend (start it with `python app.py` inside the backend folder, or run `python train_ml.py` first if the model is missing). Predictions and metrics are NOT faked in the meantime — the panel stays empty.');
    } finally { ML.loading = false; }
  })();
}

function ensureMLSelectors() {
  if (ML.selInited) return;
  ML.selInited = true;
  const citySel = $('#mlCity');
  citySel.innerHTML = Object.keys(CITIES).map(id => `<option value="${id}">${CITIES[id].name}</option>`).join('');
  citySel.value = state.cityId;

  const yearSel = $('#mlYear');
  const lastComplete = new Date().getFullYear() - 1;   // ERA5 archive lags the current year
  let years = '';
  for (let y = lastComplete; y >= 1950; y--) years += `<option value="${y}"${y === lastComplete ? ' selected' : ''}>${y}</option>`;
  yearSel.innerHTML = years;

  fillMLLocalities();
  citySel.addEventListener('change', () => { fillMLLocalities(); renderMLRuleCompare(); });
  $('#mlLoc').addEventListener('change', renderMLRuleCompare);
  $('#btnMlFetch').addEventListener('click', fetchMLRainfall);
  $('#btnMlExample').addEventListener('click', loadMLExample);
  $('#btnMlPredict').addEventListener('click', runMLPredict);
}

function fillMLLocalities() {
  const city = CITIES[$('#mlCity').value] || CITIES[state.cityId];
  $('#mlLoc').innerHTML = city.locations.map(l => `<option value="${esc(l.name)}">${esc(l.name)}</option>`).join('');
}

function renderMLRuleCompare() {
  const el = $('#mlRuleCompare');
  if (!el) return;
  const cityName = $('#mlCity').value || state.cityId;
  const city = CITIES[cityName];
  const name = $('#mlLoc').value;
  const loc = city.locations.find(l => l.name === name);
  const r = state.results[name];
  if (!loc || !r || r.score == null) {
    el.innerHTML = '<p class="card-note">Rule-based score unavailable for this locality yet (live data still loading).</p>';
    return;
  }
  const color = CLASS_COLORS[r.cls] || '#5b6f93';
  el.innerHTML = `
    <div class="prof-row" style="margin-bottom:8px"><span>Locality</span><b>${esc(name)} · ${esc(city.name)}</b></div>
    <div class="prof-row" style="margin-bottom:8px"><span>Weighted score (0–100)</span><b>${fmt1(r.score)}</b></div>
    <div class="scorebar" style="width:100%; margin-bottom:12px"><i style="width:${Math.min(100, r.score)}%; background:${color}"></i></div>
    <div class="prof-row"><span>Class</span><span class="chip-class ${'c-' + r.cls}">${cap(r.cls)} risk</span></div>`;
}

function renderMLReport() {
  const rep = ML.info;
  const best = rep.comparison.find(c => c.model === rep.selected_model) || rep.comparison[0];

  $('#mlAlgoBadge').textContent = rep.selected_model.toUpperCase();
  $('#mlPredAlgo').textContent = rep.selected_model.toUpperCase();
  $('#mlSelChip').textContent = `Selected: ${rep.selected_model} (${rep.selection_rule})`;

  const d = rep.dataset, s = rep.split;
  $('#mlModelInfo').innerHTML = `
    <div class="mi-row"><span class="mi-k">Dataset</span><span class="mi-v">${esc(d.file)} — ${d.rows} annual rows, ${d.year_min}–${d.year_max}, IMD subdivision KERALA</span></div>
    <div class="mi-row"><span class="mi-k">Label source</span><span class="mi-v">“FLOODS” yes/no column used exactly as published — <a href="${esc(d.source_url)}" target="_blank" rel="noopener">dataset mirror</a>. ${esc(d.label_note)}</span></div>
    <div class="mi-row"><span class="mi-k">Class balance</span><span class="mi-v">${d.class_balance.flood_yes} flood years · ${d.class_balance.flood_no} non-flood years</span></div>
    <div class="mi-row"><span class="mi-k">Split (no leakage)</span><span class="mi-v">Temporal: train ≤ ${s.train_max_year} (${s.train_rows} rows, ${s.train_flood_years} flood) · held-out test ${s.test_years} (${s.test_rows} rows, ${s.test_flood_years} flood)</span></div>
    <div class="mi-row"><span class="mi-k">Cross-validation</span><span class="mi-v">${esc(s.cv)}</span></div>
    <div class="mi-row"><span class="mi-k">Leakage controls</span><span class="mi-v">${s.leakage_controls.map(esc).join(' · ')}</span></div>
    <div class="mi-row"><span class="mi-k">Provenance</span><span class="mi-v">Rainfall cross-checked against an independent IMD subdivisional mirror (max monthly diff &lt; 5%). SHA-256 ${esc(d.sha256.slice(0, 16))}… · trained ${esc(rep.generated_at)} · sklearn ${esc(rep.versions['scikit-learn'])}</span></div>
    <div class="mi-row"><span class="mi-k">Features</span><span class="mi-v">${rep.features.map(f => esc(f.label)).join(' · ')}</span></div>`;

  const t = best.test;
  const metric = (label, v, sub) => `<div class="metric"><div class="m-label">${label}</div><div class="m-value">${mlFmt(v)}</div><div class="m-sub">${sub}</div></div>`;
  $('#mlMetrics').innerHTML =
    metric('Accuracy', t.accuracy, 'held-out test years') +
    metric('Precision', t.precision, 'of predicted floods correct') +
    metric('Recall', t.recall, 'of real floods caught') +
    metric('F1-score', t.f1, 'precision/recall balance') +
    metric('ROC-AUC', t.roc_auc, 'ranking skill') +
    metric('Brier score', t.brier, 'probability error · lower = better');

  const c = t.confusion;
  $('#mlConfusion').innerHTML = `
    <p class="card-note" style="margin:12px 0 8px">Confusion matrix — held-out test years (${s.test_years}):</p>
    <div class="cm-grid">
      <div class="cm-cell cm-corner"></div>
      <div class="cm-cell cm-head">Predicted Flood</div>
      <div class="cm-cell cm-head">Predicted No Flood</div>
      <div class="cm-cell cm-head">Actual Flood</div>
      <div class="cm-cell tp"><b>${c.tp}</b><small>correct</small></div>
      <div class="cm-cell fn"><b>${c.fn}</b><small>missed</small></div>
      <div class="cm-cell cm-head">Actual No Flood</div>
      <div class="cm-cell fp"><b>${c.fp}</b><small>false alarm</small></div>
      <div class="cm-cell tn"><b>${c.tn}</b><small>correct</small></div>
    </div>`;

  $('#mlCompareBody').innerHTML = rep.comparison.map(row => {
    const sel = row.model === rep.selected_model;
    const td = (v) => `<td>${v == null ? '—' : mlFmt(v)}</td>`;
    return `<tr class="${sel ? 'row-selected' : ''}">
      <td class="loc-name">${esc(row.model)}</td>
      <td>${mlFmt(row.cv.f1[0])} ± ${mlFmt(row.cv.f1[1])}</td>
      <td>${mlFmt(row.cv.roc_auc[0])} ± ${mlFmt(row.cv.roc_auc[1])}</td>
      ${td(row.test.f1)}${td(row.test.accuracy)}${td(row.test.precision)}${td(row.test.recall)}${td(row.test.roc_auc)}
      <td>${sel ? '<span class="chip-class c-low">✓ best</span>' : '<span class="td-muted">—</span>'}</td>
    </tr>`;
  }).join('');

  const impKeys = rep.features.map(f => f.key);
  const impLabels = rep.features.map(f => f.label.replace(' rainfall (mm)', ''));
  const impVals = impKeys.map(k => Math.abs(rep.importance.values[k] || 0));
  upsertChart('mlimp', 'mlImportance', {
    type: 'bar',
    data: { labels: impLabels, datasets: [{ data: impVals, backgroundColor: 'rgba(34,211,238,.75)', borderRadius: 5, barThickness: 18 }] },
    options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { maxTicksLimit: 6 } }, y: { grid: { display: false } } } }
  });
  $('#mlImpNote').textContent = rep.importance.note + ' — bar length shows magnitude (sign ignored).';

  const prof = rep.class_profile_mm;
  const pMax = Math.max(...impKeys.flatMap(k => [prof.flood[k], prof.no_flood[k]]));
  $('#mlProfile').innerHTML = impKeys.map(k => `
    <div class="ml-profile-row">
      <div class="pr-head"><b>${esc(rep.features.find(f => f.key === k).label)}</b></div>
      <div class="pr-head"><span>Flood years · <b>${prof.flood[k]} mm</b></span><span>No-flood years · <b>${prof.no_flood[k]} mm</b></span></div>
      <div class="pbar"><i style="width:${(prof.flood[k] / pMax * 100).toFixed(1)}%; background:var(--red)"></i></div>
      <div class="pbar"><i style="width:${(prof.no_flood[k] / pMax * 100).toFixed(1)}%; background:var(--green)"></i></div>
    </div>`).join('');

  $('#mlLimits').innerHTML = rep.limitations.map(l => `<li>${esc(l)}</li>`).join('');
}

async function fetchMLRainfall() {
  const year = Number($('#mlYear').value);
  const city = CITIES[$('#mlCity').value];
  const locName = $('#mlLoc').value;
  const loc = city.locations.find(l => l.name === locName);
  if (!loc) return showToast('Select a locality first.', 'warn');
  const btn = $('#btnMlFetch');
  btn.disabled = true;
  try {
    const url = 'https://archive-api.open-meteo.com/v1/archive'
      + `?latitude=${loc.lat}&longitude=${loc.lon}`
      + `&start_date=${year}-01-01&end_date=${year}-12-31`
      + '&daily=precipitation_sum&timezone=Asia%2FKolkata';
    const j = await fetchJSON(url, {}, 20000);
    const days = (j.daily && j.daily.time) || [];
    const vals = (j.daily && j.daily.precipitation_sum) || [];
    const keys = { '06': 'JUN', '07': 'JUL', '08': 'AUG', '09': 'SEP' };
    const sums = { JUN: 0, JUL: 0, AUG: 0, SEP: 0 };
    let missing = 0;
    days.forEach((t, k) => {
      const key = keys[t.slice(5, 7)];
      if (!key) return;
      const v = vals[k];
      if (Number.isFinite(v)) sums[key] += v; else missing++;
    });
    const ids = { JUN: '#mlJun', JUL: '#mlJul', AUG: '#mlAug', SEP: '#mlSep' };
    Object.keys(ids).forEach(k => { $(ids[k]).value = Math.round(sums[k] * 10) / 10; });
    $('#mlFetchBadge').hidden = false;
    ML.era5 = { city: city.name, locality: locName, year };
    showToast(`ERA5 archive aggregated for ${locName} ${year}: ` +
      Object.keys(sums).map(k => `${k[0]}${k.slice(1).toLowerCase()} ${sums[k].toFixed(0)}mm`).join(' · ') +
      (missing ? ` (${missing} days missing)` : ''));
  } catch (e) {
    showToast('ERA5 archive fetch failed — ' + e.message + '. Enter the monthly values manually.', 'err');
  } finally { btn.disabled = false; }
}

function loadMLExample() {
  if (!ML.info) return showToast('Model report not loaded yet.', 'warn');
  const ex = ML.info.examples[ML.exIdx % ML.info.examples.length];
  ML.exIdx++;
  const ids = { JUN: '#mlJun', JUL: '#mlJul', AUG: '#mlAug', SEP: '#mlSep' };
  Object.keys(ids).forEach(k => { $(ids[k]).value = ex.values[k]; });
  $('#mlFetchBadge').hidden = true;
  showToast(`Filled with a genuine training row: Kerala ${ex.year} (${ex.label}).`);
}

async function runMLPredict() {
  const ids = { JUN: '#mlJun', JUL: '#mlJul', AUG: '#mlAug', SEP: '#mlSep' };
  const vals = {};
  for (const k of Object.keys(ids)) {
    const v = parseFloat($(ids[k]).value);
    if (!Number.isFinite(v) || v < 0 || v > 5000) {
      return showToast('Enter all four monthly rainfall totals in mm (0–5000) — fetch them from ERA5 or type values.', 'warn');
    }
    vals[k] = v;
  }
  const base = await mlResolveApi();
  const btn = $('#btnMlPredict');
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = 'Predicting…';
  try {
    const r = await fetch(base + 'api/ml/predict', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...vals,
        city: CITIES[$('#mlCity').value].name,
        locality: $('#mlLoc').value,
        year: Number($('#mlYear').value)
      })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'prediction failed');
    renderMLPrediction(j);
  } catch (e) {
    showToast('ML prediction failed — ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function renderMLPrediction(j) {
  $('#mlPredMeta').innerHTML =
    `<b>${esc(j.context.locality || '—')}</b> · ${esc(j.context.city || '')} · year ${esc(String(j.context.year ?? '—'))}` +
    ` — model trained on Kerala data, so this is an <b>unvalidated extrapolation</b>.`;
  const v = $('#mlVerdict');
  v.textContent = j.prediction.toUpperCase();
  v.className = 'ml-verdict ' + (j.prediction === 'Flood' ? 'flood' : 'noflood');

  const pct = j.probability_flood * 100;
  $('#mlProbWrap').hidden = false;
  $('#mlProbLabel').textContent = pct.toFixed(1) + '%';
  $('#mlProbFill').style.width = pct.toFixed(1) + '%';
  $('#mlProbNote').textContent =
    `Decision threshold 0.5 (light marker on the bar) · Brier score on held-out years: ${mlFmt(j.brier)} (lower = better) · model output, not a calibrated forecast.`;

  const scaleMax = Math.max(...j.factors.map(f => Math.max(f.value_mm, f.flood_year_mean_mm, f.no_flood_year_mean_mm))) * 1.12;
  $('#mlFactors').innerHTML = j.factors.map(f => {
    const pos = mm => Math.min(100, mm / scaleMax * 100);
    return `
      <div class="mf-row">
        <div class="mf-top"><b>${esc(f.label)}</b><span class="mf-val">${fmt1(f.value_mm)} mm</span></div>
        <div class="mf-bar">
          <i style="left:0; width:${pos(f.value_mm)}%; background:linear-gradient(90deg,#22d3ee,#3b82f6)"></i>
          <i style="left:${pos(f.no_flood_year_mean_mm)}%; width:2px; background:var(--green)" title="no-flood years mean"></i>
          <i style="left:${pos(f.flood_year_mean_mm)}%; width:2px; background:var(--red)" title="flood years mean"></i>
        </div>
        <div class="mf-sub">training reference — no-flood years avg ${f.no_flood_year_mean_mm} mm · flood years avg ${f.flood_year_mean_mm} mm${f.importance != null ? ` · model weight ${mlFmt(Math.abs(f.importance), 2)}` : ''}</div>
      </div>`;
  }).join('') +
  `<p class="foot-note">Green / red markers show where your input sits relative to the average non-flood and flood year of the training data. Factor ranking is a transparent input-vs-reference comparison, not a SHAP analysis.</p>`;
}

/* ============================== 15. INIT ================================ */

function initNav() {
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('#citySelect').addEventListener('change', e => setCity(e.target.value));
  $('#btnRefresh').addEventListener('click', () => refreshData(true));
  $('#btnMenu').addEventListener('click', () => {
    const sb = $('#sidebar'), sc = $('#scrim');
    const open = sb.classList.toggle('open');
    sc.hidden = !open;
  });
  $('#scrim').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; });

  /* Risk filters */
  $$('#riskFilters .chip').forEach(ch => ch.addEventListener('click', () => {
    $$('#riskFilters .chip').forEach(c => c.classList.remove('active'));
    ch.classList.add('active');
    state.riskFilter = ch.dataset.filter;
    rebuildMarkers();
  }));

  /* Modal */
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  /* Table "Details" buttons (event delegation — table re-renders) */
  $('#locTableBody').addEventListener('click', e => {
    const btn = e.target.closest('.row-btn');
    if (btn) openLocation(btn.dataset.loc);
  });

  /* Simulator sliders */
  const bind = (id, key) => {
    $(id).addEventListener('input', e => {
      state.sim[key] = Number(e.target.value);
      computeAll();          // recompute sim scores only
      renderSimulator();
      $('#simRainOut').textContent = '+' + state.sim.rain + '%';
      $('#simDrainOut').textContent = '+' + state.sim.drain + '%';
      $('#simGreenOut').textContent = '+' + state.sim.green + '%';
    });
  };
  bind('#simRain', 'rain'); bind('#simDrain', 'drain'); bind('#simGreen', 'green');
  $('#btnSimReset').addEventListener('click', () => {
    state.sim = { rain: 0, drain: 0, green: 0 };
    $('#simRain').value = 0; $('#simDrain').value = 0; $('#simGreen').value = 0;
    computeAll(); renderSimulator();
    showToast('Sliders reset to real observed conditions.');
  });

  $('#btnClearCache').addEventListener('click', () => { clearCache(); location.reload(); });
}

function init() {
  /* CDN check — Leaflet/Chart.js load with defer; if missing, warn clearly */
  if (typeof L === 'undefined' || typeof Chart === 'undefined') {
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="banner banner-warn" style="margin:10px"><b>Library loading problem.</b> Chart.js / Leaflet could not load from the CDN — check your internet connection and reload. Map and charts will be unavailable, but data panels still work.</div>');
  }

  chartTheme();
  /* Render Lucide icons (static markup only — safe no-op if the CDN is blocked) */
  if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  initNav();
  switchView('dashboard');
  setCity('pune');

  /* Auto-refresh weather every 15 minutes (skipped while tab is hidden) */
  setInterval(() => { if (!document.hidden) { loadWeather(true).then(renderAll); } }, 15 * 60e3);
}

document.addEventListener('DOMContentLoaded', init);


