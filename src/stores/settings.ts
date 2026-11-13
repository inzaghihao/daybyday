import { ref } from 'vue'
import { core } from '../composables/dayByDayCore.js'
import { getSettings, saveSettings, type AccountSettings } from '../services/settings'
import { authUser } from './auth'

export const settingsReady = ref(false)
export const settingsLoadError = ref('')
export const settingsRevision = ref(0)
let generation = 0
let saves: Promise<unknown> = Promise.resolve()

function defaults(): AccountSettings {
  const state = core.defaultState()
  return { habits: state.habits, start: state.start, end: state.end,
    restLimit: state.restLimit, reminder: state.reminder, avatar: state.avatar }
}

export function currentSettings(): AccountSettings {
  const data = core.data
  return { habits: data.habits.map((habit: AccountSettings['habits'][number]) => ({ ...habit })), start: data.start,
    end: data.end, restLimit: data.restLimit, reminder: { ...data.reminder }, avatar: data.avatar }
}

function apply(settings: AccountSettings) {
  Object.assign(core.data, settings)
  core.refreshAll()
}

export async function loadAccountSettings() {
  const current = ++generation
  const userId = authUser.value?.id
  settingsReady.value = false
  settingsLoadError.value = ''
  apply(defaults())
  if (!userId) return
  try {
    const settings = await getSettings()
    if (current !== generation || authUser.value?.id !== userId) return
    apply(settings ?? defaults())
    settingsReady.value = true
    settingsRevision.value++
  } catch (error) {
    if (current !== generation || authUser.value?.id !== userId) return
    settingsLoadError.value = error instanceof Error ? error.message : '读取设置失败'
    core.toast(settingsLoadError.value)
  }
}

export async function refreshAccountSettings() {
  const userId = authUser.value?.id
  settingsReady.value = false
  await saves.catch(() => {})
  if (authUser.value?.id !== userId) return
  await loadAccountSettings()
}

export function saveAccountSettings(): Promise<void> {
  const userId = authUser.value?.id
  if (!userId || !settingsReady.value) return Promise.reject(new Error('请先登录并等待设置加载'))
  const snapshot = currentSettings()
  saves = saves.catch(() => {}).then(async () => {
    if (authUser.value?.id !== userId) throw new Error('账号已切换')
    await saveSettings(snapshot)
    settingsRevision.value++
  })
  return saves.then(() => {}, async error => {
    await loadAccountSettings()
    throw error
  })
}
