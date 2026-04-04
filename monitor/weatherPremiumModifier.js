/**
 * weatherPremiumModifier.js
 * ─────────────────────────
 * Fetches 5-day weather forecasts for every pincode (zone) where
 * GigGuard workers operate.  When bad weather is forecasted (heavy
 * rain, hailstorm, heatwave), the worker's premiumModifier is
 * nudged upward so the next policy renewal reflects higher risk.
 *
 * Called at the end of runWeeklyPayout() in monitor_index.js.
 *
 * Weather modifier increments (per pincode, cumulative, capped +0.15):
 *   Heavy rain   → +0.05
 *   Heatwave     → +0.05
 *   Hailstorm    → +0.10
 *
 * Global cap: MODIFIER_MAX (1.5) from monitor_index.js is respected.
 */

const fetch = require('node-fetch');

const OPENWEATHER_API_KEY =
  process.env.OPENWEATHER_API_KEY ||
  process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY ||
  '69fb4fdfcd9a514a85570ce51ec1f3d9';

const MODIFIER_MAX       = 1.5;
const PER_PINCODE_CAP    = 0.15;
const HEAVY_RAIN_BUMP    = 0.05;
const HEATWAVE_BUMP      = 0.05;
const HAILSTORM_BUMP     = 0.10;

// ─── Geocode an Indian pincode to { lat, lon } ──────────────────────────────
async function geocodePincode(pincode) {
  try {
    const url =
      `http://api.openweathermap.org/geo/1.0/zip?zip=${pincode},IN&appid=${OPENWEATHER_API_KEY}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.lat !== undefined && data.lon !== undefined) {
      return { lat: data.lat, lon: data.lon, name: data.name || pincode };
    }
    console.warn(`  ⚠ Geocode failed for pincode ${pincode}:`, data.message || data);
    return null;
  } catch (err) {
    console.error(`  ✗ Geocode error for ${pincode}:`, err.message);
    return null;
  }
}

// ─── Fetch 5-day / 3-hour forecast for a lat/lon ────────────────────────────
async function fetchForecast(lat, lon) {
  try {
    const url =
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.cod !== '200') {
      console.warn('  ⚠ Forecast API error:', data.message || data);
      return [];
    }
    return data.list || [];
  } catch (err) {
    console.error('  ✗ Forecast fetch error:', err.message);
    return [];
  }
}

// ─── Analyse a forecast list and return a modifier increment for the pincode ─
function analyseForBadWeather(forecastList) {
  let heavyRain = false;
  let heatwave  = false;
  let hailstorm = false;

  for (const entry of forecastList) {
    const code      = entry.weather?.[0]?.id || 0;
    const temp      = entry.main?.temp ?? 0;
    const feelsLike = entry.main?.feels_like ?? 0;
    const rain3h    = entry.rain?.['3h'] ?? 0;

    if (!heavyRain) {
      heavyRain = (code >= 502 && code <= 531) || rain3h > 7.6;
    }
    if (!hailstorm) {
      hailstorm = code === 906 || (code >= 200 && code < 300);
    }
    if (!heatwave) {
      heatwave = temp > 40 || feelsLike > 42;
    }

    if (heavyRain && heatwave && hailstorm) break;
  }

  let increment = 0;
  const reasons = [];

  if (heavyRain) {
    increment += HEAVY_RAIN_BUMP;
    reasons.push('Heavy rain forecasted');
  }
  if (heatwave) {
    increment += HEATWAVE_BUMP;
    reasons.push('Heatwave forecasted');
  }
  if (hailstorm) {
    increment += HAILSTORM_BUMP;
    reasons.push('Hailstorm / severe thunderstorm forecasted');
  }

  increment = Math.min(increment, PER_PINCODE_CAP);

  return { increment, reasons, heavyRain, heatwave, hailstorm };
}

// ─── Check if a single forecast entry triggers any bad-weather condition ─────
function entryTriggers(entry) {
  const code      = entry.weather?.[0]?.id || 0;
  const temp      = entry.main?.temp ?? 0;
  const feelsLike = entry.main?.feels_like ?? 0;
  const rain3h    = entry.rain?.['3h'] ?? 0;
  const flags = [];
  if ((code >= 502 && code <= 531) || rain3h > 7.6) flags.push('heavy_rain');
  if (code === 906 || (code >= 200 && code < 300))  flags.push('hailstorm');
  if (temp > 40 || feelsLike > 42)                  flags.push('heatwave');
  return flags;
}

// ─── Print a compact forecast table for a pincode ────────────────────────────
function logForecastSummary(pincode, locationName, forecastList, analysis) {
  const PREVIEW_COUNT = 8;
  console.log(`\n  ── Pincode ${pincode} (${locationName}) ──────────────────────`);
  console.log(`  Forecast (showing first ${Math.min(PREVIEW_COUNT, forecastList.length)} of ${forecastList.length} entries):`);

  let badHits = 0;
  for (let i = 0; i < forecastList.length; i++) {
    const e       = forecastList[i];
    const dt      = e.dt_txt || new Date(e.dt * 1000).toISOString();
    const temp    = (e.main?.temp ?? 0).toFixed(1);
    const desc    = e.weather?.[0]?.description || '?';
    const code    = e.weather?.[0]?.id || 0;
    const rain3h  = e.rain?.['3h'] ?? 0;
    const flags   = entryTriggers(e);
    if (flags.length > 0) badHits++;

    if (i < PREVIEW_COUNT) {
      const marker = flags.length > 0 ? `  ← ${flags.join(', ')}` : '';
      const rainStr = rain3h > 0 ? `, rain: ${rain3h}mm/3h` : '';
      console.log(`    ${dt} → ${temp}°C, ${desc} (${code})${rainStr}${marker}`);
    }
  }

  if (forecastList.length > PREVIEW_COUNT) {
    console.log(`    ... (${forecastList.length - PREVIEW_COUNT} more entries, ${badHits} bad-weather hit(s) total)`);
  }

  if (analysis.increment > 0) {
    console.log(`  Result: +${analysis.increment.toFixed(2)} — ${analysis.reasons.join(', ')}`);
  } else {
    console.log(`  Result: +0.00 — no bad weather detected`);
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────
async function runWeatherPremiumUpdate(db, admin) {
  console.log(`\n[${new Date().toISOString()}] Running weather-based premium modifier update...`);

  // 1. Fetch all workers and collect unique pincodes
  const workersSnap = await db.collection('workers').get();
  if (workersSnap.empty) {
    console.log('  No workers found. Skipping weather modifier update.');
    return;
  }

  const pincodeSet = new Set();
  const workers = [];

  for (const doc of workersSnap.docs) {
    const w = { id: doc.id, ...doc.data() };
    workers.push(w);
    if (Array.isArray(w.zones)) {
      w.zones.forEach(z => pincodeSet.add(z));
    }
  }

  const pincodes = [...pincodeSet];
  console.log(`  Found ${workers.length} workers across ${pincodes.length} unique pincode(s)`);

  if (pincodes.length === 0) {
    console.log('  No pincodes to check. Skipping.');
    return;
  }

  // 2. For each pincode: geocode → forecast → analyse → log details
  const pincodeModifiers = {};

  for (const pin of pincodes) {
    const geo = await geocodePincode(pin);
    if (!geo) {
      pincodeModifiers[pin] = { increment: 0, reasons: ['Geocode failed'], name: pin };
      console.log(`\n  ── Pincode ${pin} ──────────────────────`);
      console.log(`  ✗ Geocode failed — skipping forecast`);
      continue;
    }

    const forecastList = await fetchForecast(geo.lat, geo.lon);
    if (forecastList.length === 0) {
      pincodeModifiers[pin] = { increment: 0, reasons: ['Forecast unavailable'], name: geo.name };
      console.log(`\n  ── Pincode ${pin} (${geo.name}) ──────────────────────`);
      console.log(`  ✗ Forecast unavailable`);
      continue;
    }

    const analysis = analyseForBadWeather(forecastList);
    pincodeModifiers[pin] = { ...analysis, name: geo.name };

    logForecastSummary(pin, geo.name, forecastList, analysis);
  }

  // 3. For each worker, take max modifier across their zones and update
  console.log(`\n  ── Worker modifier decisions ──────────────────────`);
  const batch = db.batch();
  let updated = 0;
  const weekNum = getWeekNumber(new Date());

  for (const worker of workers) {
    const zones = Array.isArray(worker.zones) ? worker.zones : [];
    if (zones.length === 0) continue;

    let maxIncrement = 0;
    let worstReasons = [];
    let worstPincode = '';

    for (const z of zones) {
      const pm = pincodeModifiers[z];
      if (pm && pm.increment > maxIncrement) {
        maxIncrement = pm.increment;
        worstReasons = pm.reasons;
        worstPincode = `${pm.name} (${z})`;
      }
    }

    const currentMod = worker.premiumModifier || 1.0;
    const zoneList = zones.join(', ');

    if (maxIncrement <= 0) {
      console.log(`  Worker ${worker.name} (zones: ${zoneList}):`);
      console.log(`    No bad weather in any zone`);
      console.log(`    Modifier: ${currentMod.toFixed(2)} → unchanged`);
      continue;
    }

    const newMod = Math.round(Math.min(currentMod + maxIncrement, MODIFIER_MAX) * 100) / 100;

    console.log(`  Worker ${worker.name} (zones: ${zoneList}):`);
    console.log(`    Worst zone: ${worstPincode} → +${maxIncrement.toFixed(2)} (${worstReasons.join(', ')})`);

    if (newMod === currentMod) {
      console.log(`    Modifier: ${currentMod.toFixed(2)} → already at cap (${MODIFIER_MAX.toFixed(2)})`);
      continue;
    }

    console.log(`    Modifier: ${currentMod.toFixed(2)} → ${newMod.toFixed(2)}`);
    batch.update(db.collection('workers').doc(worker.id), {
      premiumModifier: newMod,
      updatedAt:       admin.firestore.Timestamp.now(),
    });
    updated++;
  }

  if (updated > 0) {
    await batch.commit();
  }
  console.log(`\n  ✓ Weather modifier applied to ${updated} worker(s).`);

  // 4. Log summary to weather_forecast_logs
  const logRef = db.collection('weather_forecast_logs').doc(`week${weekNum}_${Date.now()}`);
  await logRef.set({
    weekNumber:      weekNum,
    pincodeCount:    pincodes.length,
    workersUpdated:  updated,
    pincodeResults:  Object.fromEntries(
      Object.entries(pincodeModifiers).map(([pin, data]) => [
        pin,
        {
          name:      data.name,
          increment: data.increment,
          reasons:   data.reasons,
        },
      ])
    ),
    createdAt: admin.firestore.Timestamp.now(),
  });
  console.log('  ✓ Weather forecast log saved.');
}

// ─── Inline week-number helper (same algorithm as monitor_index.js) ─────────
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

module.exports = { runWeatherPremiumUpdate };
