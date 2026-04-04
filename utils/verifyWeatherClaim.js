/**
 * verifyWeatherClaim.js
 * ──────────────────────
 * Verifies a weather-based claim by fetching live weather
 * at the user's actual GPS coordinates and checking whether
 * it matches what the user reported (heavy rain, heatwave, hailstorm).
 *
 * Used in ClaimScreen.js after location is captured.
 *
 * Returns:
 * {
 *   verified:     true/false       — does weather match the claim?
 *   confidence:   0–100            — how confident we are
 *   actualWeather: { ... }         — raw weather data at location
 *   matchReason:  string           — human-readable explanation
 *   scoreBoost:   number           — added to AI score if verified
 *   scorePenalty: number           — subtracted if mismatch
 * }
 */

const OPENWEATHER_API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY || '69fb4fdfcd9a514a85570ce51ec1f3d9';

// ─── Fetch weather by lat/lng (NOT pincode) ───────────────────────────────────
export async function fetchWeatherByLocation(latitude, longitude) {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const res  = await fetch(url);
    const data = await res.json();

    if (data.cod !== 200) {
      console.warn('Weather API error:', data.message);
      return null;
    }

    const weatherCode = data.weather[0].id;
    const description = data.weather[0].description;
    const temp        = data.main?.temp;
    const feelsLike   = data.main?.feels_like;
    const humidity    = data.main?.humidity;
    const rain        = data.rain?.['1h'] || data.rain?.['3h'] || 0;
    const windSpeed   = data.wind?.speed || 0;
    const cityName    = data.name || 'your location';

    return {
      weatherCode,
      description,
      temp,
      feelsLike,
      humidity,
      rain,
      windSpeed,
      cityName,
    };
  } catch (err) {
    console.error('fetchWeatherByLocation failed:', err);
    return null;
  }
}

// ─── Verify claim against actual weather ─────────────────────────────────────
export async function verifyWeatherClaim(weatherSubtype, latitude, longitude) {
  // Can't verify without location
  if (!latitude || !longitude) {
    return {
      verified:     false,
      confidence:   0,
      actualWeather: null,
      matchReason:  'Location not available — could not verify weather',
      scoreBoost:   0,
      scorePenalty: 10,
    };
  }

  const weather = await fetchWeatherByLocation(latitude, longitude);

  // API failed
  if (!weather) {
    return {
      verified:     false,
      confidence:   0,
      actualWeather: null,
      matchReason:  'Weather API unavailable — could not verify',
      scoreBoost:   0,
      scorePenalty: 5,
    };
  }

  const code = weather.weatherCode;
  const result = checkSubtypeMatch(weatherSubtype, weather);

  return {
    ...result,
    actualWeather: weather,
  };
}

// ─── Subtype matching logic ───────────────────────────────────────────────────
function checkSubtypeMatch(weatherSubtype, weather) {
  const { weatherCode, temp, feelsLike, rain, description, cityName } = weather;

  switch (weatherSubtype) {

    case 'heavy_rain': {
      // Rain codes: 500–531, Thunderstorm: 200–232, Drizzle: 300–321
      const isRaining   = weatherCode >= 200 && weatherCode < 600;
      const isHeavyRain = (weatherCode >= 502 && weatherCode <= 531) || rain > 7.6; // >7.6mm/hr = heavy rain

      if (isHeavyRain) {
        return {
          verified:     true,
          confidence:   95,
          matchReason:  `✅ Heavy rain confirmed at ${cityName}: ${description} (${rain}mm/hr)`,
          scoreBoost:   40,
          scorePenalty: 0,
        };
      } else if (isRaining) {
        return {
          verified:     true,
          confidence:   65,
          matchReason:  `⚠️ Light rain detected at ${cityName}: ${description}. Claim may be borderline.`,
          scoreBoost:   20,
          scorePenalty: 0,
        };
      } else {
        return {
          verified:     false,
          confidence:   10,
          matchReason:  `❌ No rain detected at ${cityName}: ${description}. Heavy rain claim not supported.`,
          scoreBoost:   0,
          scorePenalty: 30,
        };
      }
    }

    case 'extreme_heatwave': {
      // Heatwave: feels_like > 42°C or temp > 40°C
      const isHeatwave       = feelsLike > 42 || temp > 40;
      const isMildHeat       = feelsLike > 38 || temp > 36;
      const isClearOrPartial = weatherCode === 800 || weatherCode === 801;

      if (isHeatwave && isClearOrPartial) {
        return {
          verified:     true,
          confidence:   95,
          matchReason:  `✅ Extreme heat confirmed at ${cityName}: ${temp}°C (feels like ${feelsLike}°C)`,
          scoreBoost:   40,
          scorePenalty: 0,
        };
      } else if (isMildHeat) {
        return {
          verified:     true,
          confidence:   60,
          matchReason:  `⚠️ High temperature at ${cityName}: ${temp}°C — borderline heatwave conditions`,
          scoreBoost:   15,
          scorePenalty: 0,
        };
      } else {
        return {
          verified:     false,
          confidence:   5,
          matchReason:  `❌ No heatwave at ${cityName}: ${temp}°C (feels like ${feelsLike}°C). Claim not supported.`,
          scoreBoost:   0,
          scorePenalty: 30,
        };
      }
    }

    case 'hailstorm': {
      // Hail codes: 906 (hail) — also check thunderstorm codes 200–232
      const isHail        = weatherCode === 906;
      const isThunderstorm = weatherCode >= 200 && weatherCode < 300;

      if (isHail) {
        return {
          verified:     true,
          confidence:   98,
          matchReason:  `✅ Hailstorm confirmed at ${cityName}: ${description}`,
          scoreBoost:   45,
          scorePenalty: 0,
        };
      } else if (isThunderstorm) {
        return {
          verified:     true,
          confidence:   55,
          matchReason:  `⚠️ Thunderstorm at ${cityName} — hail possible but not confirmed: ${description}`,
          scoreBoost:   20,
          scorePenalty: 0,
        };
      } else {
        return {
          verified:     false,
          confidence:   5,
          matchReason:  `❌ No hailstorm at ${cityName}: ${description}. Claim not supported.`,
          scoreBoost:   0,
          scorePenalty: 35,
        };
      }
    }

    default:
      return {
        verified:     false,
        confidence:   0,
        matchReason:  'Unknown weather subtype',
        scoreBoost:   0,
        scorePenalty: 0,
      };
  }
}