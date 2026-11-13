import { ref } from 'vue'
import { core } from '../composables/dayByDayCore.js'
import { getJournal, saveJournal, type Journal } from '../services/journal'
import { authUser } from './auth'
import { loadAccountSettings, refreshAccountSettings, settingsReady } from './settings'

export const journalReady = ref(false)
export const journalLoadError = ref('')
export const journalRevision = ref(0)
export const accountDataLoading = ref(false)
let generation = 0
let saves: Promise<unknown> = Promise.resolve()
let accountRefresh: { userId: string; promise: Promise<void> } | undefined

function snapshot(): Journal {
  return { records: { ...core.data.records }, checkins: { ...core.data.checkins },
    restDays: { ...core.data.restDays }, photos: { ...core.photos } }
}

function apply(journal: Journal) {
  core.data.records = journal.records
  core.data.checkins = journal.checkins
  core.data.restDays = journal.restDays
  core.rebuildRests()
  core.replacePhotos(journal.photos)
  core.ensureViewDate()
  core.refreshAll()
  journalRevision.value++
}

export async function loadAccountJournal() {
  const current = ++generation
  const userId = authUser.value?.id
  journalReady.value = false
  journalLoadError.value = ''
  core.resetJournal()
  if (!userId) return
  try {
    const remote = await getJournal()
    if (current !== generation || authUser.value?.id !== userId) return
    apply(remote)
    core.setJournalOnline()
    journalReady.value = true
  } catch (error) {
    if (current !== generation || authUser.value?.id !== userId) return
    journalLoadError.value = error instanceof Error ? error.message : '读取打卡记录失败'
    core.toast(journalLoadError.value)
  }
}

async function refreshAccountJournal() {
  const userId = authUser.value?.id
  journalReady.value = false
  await saves.catch(() => {})
  if (authUser.value?.id !== userId) return
  await loadAccountJournal()
}

export function refreshAccountData() {
  const userId = authUser.value?.id
  if (!userId) {
    accountRefresh = undefined
    accountDataLoading.value = false
    void loadAccountSettings()
    void loadAccountJournal()
    return
  }
  if (accountRefresh?.userId === userId) return accountRefresh.promise

  accountDataLoading.value = true
  const promise = refreshAccountSettings()
    .then(async () => {
      if (authUser.value?.id === userId && settingsReady.value) await refreshAccountJournal()
    })
    .finally(() => {
      if (accountRefresh?.promise !== promise) return
      accountRefresh = undefined
      accountDataLoading.value = false
    })
  accountRefresh = { userId, promise }
  return promise
}

export function saveAccountJournal(): Promise<void> {
  const userId = authUser.value?.id
  if (!userId || !journalReady.value) return Promise.reject(new Error('请先登录并等待打卡记录加载'))
  const journal = snapshot()
  saves = saves.catch(() => {}).then(async () => {
    if (authUser.value?.id !== userId) throw new Error('账号已切换')
    await saveJournal(journal)
    journalRevision.value++
  })
  return saves.then(() => {}, async error => {
    await loadAccountJournal()
    throw error
  })
}

core.actions.syncJournal = () => {
  void saveAccountJournal().catch(error => core.toast(error instanceof Error ? error.message : '打卡记录保存失败'))
}
