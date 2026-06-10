/**
 * Weather Feature — NOAA (api.weather.gov)
 *
 * Free, no API key required. Provides a /weather command with the forecast for
 * the Flood Doctor service area (Vienna, VA HQ by default).
 *
 * Value: cause-of-loss documentation for claim packages (storms, freezes,
 * heavy rain), supervisor-hour / labor-condition defense, and crew planning.
 *
 * Plugin contract: export register(gateway). Zero coupling — delete to disable.
 */

// Service area default: Vienna, VA (HQ 8466D Tyco Rd, Vienna VA 22182)
const DEFAULT_COORDS = { lat: 38.9012, lon: -77.2653, label: 'Vienna, VA' }
const UA = 'FloodDoctor-Atlas/1.0 (frank@flood.doctor)'

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/geo+json' }
  })
  if (!res.ok) throw new Error(`NOAA ${res.status} for ${url}`)
  return res.json()
}

/**
 * Get the NOAA forecast for given coordinates.
 * @returns {Promise<{label:string, periods:Array}>}
 */
export async function getForecast(coords = DEFAULT_COORDS, periodsWanted = 4) {
  const points = await fetchJson(`https://api.weather.gov/points/${coords.lat},${coords.lon}`)
  const forecastUrl = points?.properties?.forecast
  if (!forecastUrl) throw new Error('No forecast URL from NOAA points endpoint')
  const fc = await fetchJson(forecastUrl)
  const periods = (fc?.properties?.periods || []).slice(0, periodsWanted)
  return { label: coords.label, periods }
}

function formatForecast({ label, periods }) {
  if (!periods || !periods.length) return `No forecast available for ${label}.`
  const lines = [`🌦️ Weather — ${label}`]
  for (const p of periods) {
    const wind = p.windSpeed ? ` (wind ${p.windSpeed}${p.windDirection ? ' ' + p.windDirection : ''})` : ''
    lines.push(`${p.name}: ${p.temperature}°${p.temperatureUnit}, ${p.shortForecast}${wind}`)
  }
  return lines.join('\n')
}

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const trimmed = (text || '').trim().toLowerCase()
    if (trimmed === '/weather' || trimmed.startsWith('/weather ')) {
      try {
        const data = await getForecast()
        return { handled: true, response: `🔱 *Atlas*\n\n${formatForecast(data)}` }
      } catch (err) {
        return { handled: true, response: `Weather lookup failed: ${err.message}` }
      }
    }
    return originalExecute(text, sessionKey, adapter, chatId)
  }

  console.log('[Weather] Feature loaded — /weather command enabled (NOAA, no key)')
}
