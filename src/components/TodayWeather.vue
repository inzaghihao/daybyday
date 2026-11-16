<script setup>
import { onActivated, ref, watch } from 'vue'

const props = defineProps({ date: { type: String, required: true } })
const SHANGHAI = { latitude: 31.2304, longitude: 121.4737, name: '上海' }

const weather = ref(null)
const locationName = ref('当前位置')
const loading = ref(false)
const message = ref('')
let coordinates = null
let lastLoaded = 0
let requestId = 0

function description(code) {
  if (code === 0) return ['晴', '☀️']
  if ([1, 2].includes(code)) return ['多云', '⛅']
  if (code === 3) return ['阴', '☁️']
  if ([45, 48].includes(code)) return ['有雾', '🌫️']
  if ([51, 53, 55, 56, 57].includes(code)) return ['毛毛雨', '🌦️']
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ['雨', '🌧️']
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ['雪', '❄️']
  if ([95, 96, 99].includes(code)) return ['雷雨', '⛈️']
  return ['天气变化', '🌤️']
}

async function loadWeather(latitude, longitude, name) {
  const id = ++requestId
  loading.value = true
  message.value = ''
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.search = new URLSearchParams({
      latitude: String(latitude), longitude: String(longitude),
      current: 'temperature_2m,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min',
      timezone: 'auto', forecast_days: '1',
    }).toString()
    const response = await fetch(url)
    if (!response.ok) throw new Error('天气服务暂时不可用')
    const result = await response.json()
    const temperature = result.current?.temperature_2m
    const high = result.daily?.temperature_2m_max?.[0]
    const low = result.daily?.temperature_2m_min?.[0]
    if (![temperature, high, low].every(Number.isFinite)) throw new Error('天气数据暂时不可用')
    if (id !== requestId) return
    const [condition, icon] = description(result.current.weather_code)
    weather.value = { temperature: Math.round(temperature), high: Math.round(high), low: Math.round(low), condition, icon }
    coordinates = { latitude, longitude }
    locationName.value = name
    lastLoaded = Date.now()
  } catch (error) {
    if (id === requestId) message.value = error instanceof Error ? error.message : '天气数据暂时不可用'
  } finally {
    if (id === requestId) loading.value = false
  }
}

function locate() {
  const id = ++requestId
  if (!navigator.geolocation) {
    void loadWeather(SHANGHAI.latitude, SHANGHAI.longitude, SHANGHAI.name)
    return
  }
  loading.value = true
  message.value = ''
  navigator.geolocation.getCurrentPosition(
    position => {
      if (id === requestId) void loadWeather(position.coords.latitude, position.coords.longitude, '当前位置')
    },
    () => {
      if (id !== requestId) return
      void loadWeather(SHANGHAI.latitude, SHANGHAI.longitude, SHANGHAI.name)
    },
    { timeout: 10000, maximumAge: 30 * 60 * 1000 },
  )
}

onActivated(() => {
  if (coordinates) {
    if (Date.now() - lastLoaded > 30 * 60 * 1000) void loadWeather(coordinates.latitude, coordinates.longitude, locationName.value)
  } else if (!message.value) locate()
})
watch(() => props.date, () => {
  if (coordinates) void loadWeather(coordinates.latitude, coordinates.longitude, locationName.value)
})
</script>

<template>
  <section class="today-weather" aria-label="当天天气">
    <div class="weather-top">
      <span class="weather-heading">今天天气 · {{ locationName }}</span>
      <button type="button" class="weather-locate" :disabled="loading" @click="locate">重新定位</button>
    </div>
    <div v-if="weather" class="weather-main" aria-live="polite">
      <span class="weather-icon" aria-hidden="true">{{ weather.icon }}</span>
      <strong>{{ weather.temperature }}°</strong>
      <span>{{ weather.condition }}</span>
      <small>最高 {{ weather.high }}° · 最低 {{ weather.low }}°</small>
    </div>
    <p v-if="message" class="weather-message" role="status">{{ message }}</p>
    <p v-else-if="loading && !weather" class="weather-message" role="status">正在获取天气…</p>
  </section>
</template>

<style scoped>
.today-weather {
  margin: 0 2px 16px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--paper);
}
.weather-top, .weather-main { display: flex; align-items: center; gap: 8px; }
.weather-top { justify-content: space-between; }
.weather-heading { color: var(--muted); font-size: var(--font-label); }
.weather-locate { color: var(--green); background: transparent; font-size: var(--font-label); }
.weather-main { flex-wrap: wrap; margin-top: 8px; }
.weather-icon { font-size: 22px; }
.weather-main strong { font-size: 26px; line-height: 1; }
.weather-main small { margin-left: auto; color: var(--muted); }
.weather-message { margin: 9px 0 0; color: var(--muted); font-size: var(--font-label); }
.weather-locate:disabled { opacity: .5; cursor: default; }
.weather-source { display: inline-block; margin-top: 8px; color: var(--muted); font-size: var(--font-caption); }
</style>
