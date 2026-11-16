<script setup>
import { computed, onActivated, onDeactivated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { core } from '../composables/dayByDayCore.js'
import { authLoading, authUser, logoutAccount, updateAccount } from '../stores/auth'
import { saveAccountSettings, settingsReady } from '../stores/settings'
import { compressImage } from '../utils/image'
import { imageDisplayUrl, uploadImage } from '../services/images'

const {
  MAX_CYCLE_DAYS, COLORS, ICONS, $, dateKey, parseKey, shiftDays, today,
  isDateKey, daysBetween, shortDate, clampInt, data, persist: persistLocal, rebuildRests,
  dropPhotosBy, isCheckedIn, hasCycle, journeyDays, lastSettleableKey,
  cycleRecordDays, cycleRestDays, cyclePhase, isCycleLocked, dayNum, ensureViewDate,
  toast, openModal, closeModal, confirmAction, modal, revision,
} = core

const router = useRouter()
const route = useRoute()

function persist() {
  persistLocal()
  void saveAccountSettings().catch(error => toast(error instanceof Error ? error.message : '设置保存失败'))
}

const activeSetting = ref('')
const settingTitles = {
  habits: '我的打卡项',
  cycle: '目标周期',
  rest: '每月小憩',
  reminder: '打卡提醒',
}
const activeSettingTitle = computed(() => settingTitles[activeSetting.value] || '')

function openSetting(setting) {
  if (!authUser.value) { openAuthPage(); return }
  if (!settingsReady.value) { toast('正在读取线上设置，请稍候'); return }
  activeSetting.value = setting
  window.scrollTo({ top: 0 })
}

function backToSettings() {
  activeSetting.value = ''
  window.scrollTo({ top: 0 })
}

function settingSummary(setting) {
  switch (setting) {
    case 'habits': {
      const photoHabits = data.habits.filter(habit => habit.needPhoto).length
      return data.habits.length
        ? `${data.habits.length} 个打卡项${photoHabits ? ` · ${photoHabits} 项需照片` : ''}`
        : '还没有添加打卡项'
    }
    case 'cycle':
      return hasCycle() ? `${data.start} — ${data.end} · ${journeyDays()} 天` : '还没有设置周期'
    case 'rest':
      return `每月可小憩 ${data.restLimit} 次`
    case 'reminder':
      return data.reminder?.enabled ? `每天 ${data.reminder.time} 提醒` : '尚未开启提醒'
    default:
      return ''
  }
}

const cycleDraft = ref(null)
const restLimitInput = ref(null)

function openAuthPage() {
  router.push({ path: '/auth', query: { redirect: '/profile' } })
}

function handleProfileCardClick() {
  if (!authUser.value) openAuthPage()
}

function handleAvatarClick() {
  if (!authUser.value) openAuthPage()
  else if (!settingsReady.value) toast('正在读取线上设置，请稍候')
  else chooseAvatar()
}

async function handleLogout() {
  try {
    await logoutAccount()
    toast('已退出登录')
  } catch (error) {
    toast(error instanceof Error ? error.message : '退出登录失败，请重试')
  } finally {
    core.refreshAll()
  }
}

/* ======================================================================
   打卡提醒：纯本地，页面开着的时候到点弹一条浏览器通知，不经过任何服务
   ====================================================================== */

const REMIND_STAMP_KEY = 'daybyday-reminded';

const remindConf = () => data.reminder || (data.reminder = { enabled: false, time: '21:00' });

/** 通知 API 只在安全上下文可用：https 或 localhost，file:// 一律不行 */
const isSecureCtx = () => location.protocol === 'https:'
  || ['localhost', '127.0.0.1'].includes(location.hostname);

const canNotify = () => 'Notification' in window && isSecureCtx();

const reminderPermission = ref('')
function syncReminderPermission() {
  reminderPermission.value = canNotify() ? Notification.permission : ''
}

const reminder = computed(() => data.reminder)
const secure = isSecureCtx()
const notificationsAvailable = canNotify()
const reminderOn = computed(() => notificationsAvailable && reminderPermission.value !== 'denied' && reminder.value?.enabled)
const reminderSubtitle = computed(() => {
  if (!secure) return '需要 https 访问'
  if (!notificationsAvailable) return '浏览器不支持通知'
  if (reminderPermission.value === 'denied') return '通知权限已关闭'
  return reminder.value?.enabled
    ? `每天 ${reminder.value.time} · 页面打开时生效`
    : '开启后到点会收到一条通知'
})

async function enableReminder() {
  const conf = remindConf();
  if (!isSecureCtx()) { toast('提醒需要 https 访问'); return; }
  if (!canNotify()) { toast('这个浏览器不支持通知'); return; }

  let perm = Notification.permission;
  if (perm === 'default') {
    try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; }
  }
  syncReminderPermission();
  if (perm !== 'granted') {
    toast('没拿到通知权限，去设置里放开后再试');
    return;
  }

  conf.enabled = true;
  persist();
  toast(`已开启，页面开着时每天 ${conf.time} 提醒你`);
  maybeLocalRemind();
}

function disableReminder() {
  const conf = remindConf();
  conf.enabled = false;
  persist();
  toast('已关闭提醒');
}

/** 页面开着、到点了、该补的那天还没记录，就弹一条本地通知 */
function maybeLocalRemind() {
  const conf = remindConf();
  if (!conf.enabled || !canNotify() || Notification.permission !== 'granted') return;

  const [hh, mm] = conf.time.split(':').map(Number);
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  if (now < due) return;

  const stamp = today();
  try {
    if (localStorage.getItem(REMIND_STAMP_KEY) === stamp) return;   // 一天只打扰一次
  } catch {}

  const target = lastSettleableKey();
  if (target && isCheckedIn(target)) return;   // 该记的已经记过了，不再提醒

  try { localStorage.setItem(REMIND_STAMP_KEY, stamp); } catch {}

  const body = target && !isCheckedIn(target)
    ? `${shortDate(target)} 还没打卡，现在补上还来得及。`
    : '今天的小事做完了吗？明天来记一笔。';

  try { new Notification('DAY BY DAY', { body }); } catch {}
}


/** 草稿：始终以已保存的周期为起点，改了就存在这里，点保存才落盘 */
const cycle = computed(hasCycle)
const locked = computed(() => { revision.value; return isCycleLocked() })
const currentDay = computed(() => { revision.value; return dayNum() })
const phase = computed(() => { revision.value; return cyclePhase() })
const savedCycle = computed(() => ({ start: data.start, end: data.end }))
const draft = computed(() => locked.value ? savedCycle.value : cycleDraft.value ?? savedCycle.value)
const draftDirty = computed(() => draft.value.start !== data.start || draft.value.end !== data.end)
const draftHasStart = computed(() => isDateKey(draft.value.start))
const draftHasEnd = computed(() => isDateKey(draft.value.end))
const draftSpan = computed(() => draftHasStart.value && draftHasEnd.value
  ? daysBetween(draft.value.start, draft.value.end) + 1
  : 0)
const draftValid = computed(() => draftSpan.value >= 1 && draftSpan.value <= MAX_CYCLE_DAYS)
const draftStartsInPast = computed(() => { revision.value; return draft.value.start < today() })
const cycleHeading = computed(() => {
  if (locked.value) return phase.value === 'ended' ? '本轮已结束' : '进行中 · 已锁定'
  if (!cycle.value) return '还没设置'
  if (draftDirty.value) return '有未保存的修改'
  return phase.value === 'pending' ? '开始前可调整' : '今天内可调整'
})
watch(locked, value => { if (value) cycleDraft.value = null })

const habitForm = ref(null)
function openHabitModal(id) {
  const habit = data.habits.find(item => item.id === id)
  habitForm.value = {
    id,
    name: habit?.name ?? '',
    detail: habit?.detail ?? '',
    icon: habit?.icon ?? ICONS[0],
    needPhoto: !!habit?.needPhoto,
  }
  openModal({ kind: 'habit' })
}

function saveHabit() {
  const { id, name: rawName, detail: rawDetail, icon, needPhoto } = habitForm.value
  const name = rawName.trim()
  if (!name) { toast('先给习惯起个名字吧'); return }
  const detail = rawDetail.trim()
  const habit = data.habits.find(item => item.id === id)
  if (id && !habit) { closeModal(); return }

  if (habit) {
    Object.assign(habit, { name, detail, icon, needPhoto })
  } else {
    data.habits.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name,
      detail,
      icon,
      color: data.habits.length % COLORS.length,
      needPhoto,
    })
  }
  persist()
  closeModal()
  core.refreshAll()
  toast(habit ? '已更新' : (needPhoto ? '已添加 · 打卡时要上传照片' : '新的打卡项已添加'))
}

function deleteHabit(id) {
  const habit = data.habits.find(h => h.id === id);
  if (!habit) return;

  confirmAction(
    '删除打卡项',
    `「${habit.name}」的全部历史记录会一起清除，且无法恢复。`,
    () => {
      data.habits = data.habits.filter(h => h.id !== id);
      Object.keys(data.records).forEach(key => {
        const next = data.records[key].filter(x => x !== id);
        if (next.length) data.records[key] = next;
        else delete data.records[key];
      });
      dropPhotosBy(photoId => photoId.split('|')[1] === id);
      persist();
      core.refreshAll();
      toast('已删除');
    },
  );
}

function shiftHabit(id, delta) {
  const from = data.habits.findIndex(h => h.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= data.habits.length) return;

  [data.habits[from], data.habits[to]] = [data.habits[to], data.habits[from]];
  persist();
  core.refreshAll();
}

/** 桌面端保留原生拖拽；移动端用 ↑ ↓ 按钮 */
const draggingId = ref(null)

function handleSettingDrop(id) {
  const from = data.habits.findIndex(habit => habit.id === draggingId.value)
  const to = data.habits.findIndex(habit => habit.id === id)
  draggingId.value = null
  if (from === to) return
  if (from < 0 || to < 0) return;

  const [moved] = data.habits.splice(from, 1);
  data.habits.splice(to, 0, moved);
  persist();
  core.refreshAll();
}

/* ======================================================================
   8. 交互 · 资料 / 设置
   ====================================================================== */
const usernameDraft = ref('')
function openNameEditor() {
  if (!authUser.value) {
    openAuthPage()
    return
  }
  usernameDraft.value = authUser.value.username
  openModal({ kind: 'name' })
}

async function saveName() {
  const username = usernameDraft.value.trim()
  if (!username) { toast('请输入用户名'); return }
  const currentModal = modal.value
  try {
    await updateAccount(username)
    if (modal.value === currentModal) closeModal()
    core.refreshAll()
    toast('个人资料已更新')
  } catch (error) {
    toast(error instanceof Error ? error.message : '更新失败，请稍后重试')
  }
}

/**
 * 保存周期：只接受草稿里的合法区间，落盘前再校验一次。
 * 周期已开始（锁定）时不走这条路，转成「重新设置」确认。
 */
function saveCycle() {
  if (isCycleLocked()) { confirmResetCycle(); return; }

  const current = draft.value;

  // 第一次设置：开始和结束都要用户自己选，缺一个都不落盘
  if (!isDateKey(current.start) || !isDateKey(current.end)) {
    toast(!isDateKey(current.start) ? '先选一个开始日期' : '再选一个结束日期');
    return;
  }

  const span = draftSpan.value;
  if (span < 1) {
    toast('结束日期不能早于开始日期');
    return;
  }
  if (!draftDirty.value) {
    toast(hasCycle() ? '周期还没有改动' : '先设置一个周期');
    return;
  }

  commitCycle(current.start, current.end);
}

/**
 * 周期变更统一收口：先收敛成合法区间再落盘。
 * 调用方只有「保存周期」，锁定状态由 saveCycle 先行拦截。
 */
function commitCycle(startKey, endKey, { moveSpan = false } = {}) {
  // 已开始且有记录：任何调整都要先走重置确认
  if (isCycleLocked()) {
    confirmResetCycle();
    return;
  }

  const start = isDateKey(startKey) ? startKey : data.start;
  let end = isDateKey(endKey) ? endKey : data.end;

  if (!isDateKey(start) || !isDateKey(end)) {
    toast('请先选好开始和结束日期');
    return;
  }

  const span = journeyDays() || 1;

  if (end < start) {
    if (!moveSpan) {
      toast('结束日期不能早于开始日期');
      return;
    }
    end = dateKey(shiftDays(parseKey(start), span - 1));
  }

  const maxEnd = dateKey(shiftDays(parseKey(start), MAX_CYCLE_DAYS - 1));
  if (end > maxEnd) end = maxEnd;

  if (start === data.start && end === data.end) {
    cycleDraft.value = null;
    return;
  }

  data.start = start;
  data.end = end;
  cycleDraft.value = null;   // 草稿已写入，清掉
  core.viewDate = null;   // 周期变了，直接跳回最新的可结算日
  ensureViewDate();
  persist();
  core.refreshAll();

  const outside = Object.keys(data.records).filter(k => k < start || k > end).length;
  toast(
    outside
      ? `周期已保存 · 共 ${journeyDays()} 天，另有 ${outside} 天记录在周期外`
      : `周期已保存 · 共 ${journeyDays()} 天`,
  );
}

/**
 * 周期已开始后的唯一出口：确认后作废当前周期，从今天起重新开一个同长度的周期。
 */
function confirmResetCycle() {
  const phase = cyclePhase();
  const recorded = cycleRecordDays();
  const rested = cycleRestDays();
  const days = journeyDays();
  const cleared = recorded || rested
    ? `（已有 ${recorded} 天记录${rested ? `、${rested} 天小憩` : ''}，会一并清除）`
    : '（目前还没有记录）';

  if (phase === 'ended') {
    confirmAction(
      '开启新的周期',
      `本轮周期已在 ${shortDate(data.end)} 结束。重新设置会作废本轮${cleared}，并从今天开始一个 ${days} 天的新周期。此操作无法撤销。`,
      resetCycle,
      '开启新周期',
    );
    return;
  }

  confirmAction(
    '当前周期将会废弃',
    `目标周期正在进行中（第 ${dayNum()} / ${days} 天）。重新设置会废弃当前正在进行中的周期${cleared}，并从今天开始一个 ${days} 天的新周期。此操作无法撤销。`,
    resetCycle,
    '废弃并重设',
  );
}

function resetCycle() {
  const span = journeyDays();
  const inCycle = key => key >= data.start && key <= data.end;

  Object.keys(data.records).forEach(key => {
    if (inCycle(key)) delete data.records[key];
  });
  Object.keys(data.checkins).forEach(key => {
    if (inCycle(key)) delete data.checkins[key];
  });
  Object.keys(data.restDays).forEach(key => {
    if (inCycle(key)) delete data.restDays[key];
  });
  rebuildRests();
  dropPhotosBy(photoId => inCycle(photoId.split('|')[0]));

  data.start = today();
  data.end = dateKey(shiftDays(parseKey(data.start), span - 1));
  cycleDraft.value = null;
  core.viewDate = null;
  ensureViewDate();
  persist();
  core.refreshAll();
  toast(`原周期已废弃 · 新的 ${journeyDays()} 天周期从今天开始`);
}

function handleCycleStartChange(event) {
  const start = event.target.value
  if (!isDateKey(start)) {
    cycleDraft.value = { start: null, end: null }
    return
  }
  let end = draft.value.end
  if (!isDateKey(end) || end < start) {
    end = draftSpan.value >= 1 ? dateKey(shiftDays(parseKey(start), draftSpan.value - 1)) : null
  }
  cycleDraft.value = { start, end }
}

function handleCycleEndChange(event) {
  const end = event.target.value
  cycleDraft.value = { ...draft.value, end: isDateKey(end) ? end : null }
}

function setCyclePreset(days) {
  if (locked.value || !draftHasStart.value) return
  const start = draft.value.start
  cycleDraft.value = { start, end: dateKey(shiftDays(parseKey(start), days - 1)) }
}

function revertCycleDraft() {
  cycleDraft.value = null
  toast(hasCycle() ? '已还原为当前周期' : '已清空填写的内容')
}

function commitRestLimit() {
  const input = restLimitInput.value;
  const next = clampInt(input.value, data.restLimit, 0, 99);
  input.value = next;
  if (next === data.restLimit) return;

  data.restLimit = next;
  persist();
  core.refreshAll();
  toast('设置已保存');
}

function adjustRestLimit(delta) {
  const input = restLimitInput.value;
  input.value = clampInt(Number(input.value) + delta, data.restLimit, 0, 99);
  commitRestLimit();
}

/** 头像压缩后先上传，设置接口只保存返回的图片路径。 */
async function handleAvatar(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const compressed = await compressImage(file, 256, .85)
    const blob = await (await fetch(compressed)).blob()
    const path = await uploadImage(blob)
    data.avatar = path
    await saveAccountSettings()
    toast('头像已更新')
  } catch (error) {
    toast(error instanceof Error ? error.message : '头像上传失败，请重试')
  }
}

/* ======================================================================
   9. 通用 UI：弹层 / 提示 / 页签
   ====================================================================== */

function chooseAvatar() {
  $('avatarFile').click();
}

function handleAvatarFileChange(event) {
  const input = event.target;
  handleAvatar(input.files[0]);
  input.value = '';
}

function handleReminderTimeChange(event) {
  const conf = remindConf();
  conf.time = event.target.value || '21:00';
  persist();
  toast(`提醒时间改成 ${conf.time}`);
}

function toggleReminder() {
  if (remindConf().enabled) disableReminder();
  else enableReminder();
}

function syncRequestedSetting() {
  if (route.path === '/profile' && route.query.setting === 'cycle' && settingsReady.value) {
    openSetting('cycle')
    router.replace('/profile')
  }
}

function activatePage() {
  core.initialize()
  ensureViewDate()
  core.refreshAll()
  syncReminderPermission()
  syncRequestedSetting()
  core.actions.avatarFileChange = handleAvatarFileChange
  core.actions.maybeLocalRemind = () => {
    syncReminderPermission()
    maybeLocalRemind()
  }
  setTimeout(maybeLocalRemind, 2000)
}

function deactivatePage() {
  if (['habit', 'name'].includes(modal.value?.kind)) closeModal()
  core.actions.avatarFileChange = null
}

onActivated(activatePage)
onDeactivated(deactivatePage)
watch([() => route.query.setting, settingsReady], syncRequestedSetting)
watch(() => authUser.value?.id, () => {
  activeSetting.value = ''
  cycleDraft.value = null
  if (['habit', 'name'].includes(modal.value?.kind)) closeModal()
})
</script>
<template>
  <section class="page active px-5 pt-3 pb-6" id="profile">
    <div v-show="!activeSetting">
      <h1 class="profile-title my-1 text-[length:var(--font-title)] font-bold">我的地盘</h1>
      <div class="subline mb-[19px] text-[length:var(--font-body)] text-[var(--muted)]">
        为自己设定节奏，慢慢成为想成为的人。
      </div>

      <div
        class="profile-card my-[18px] flex flex-wrap items-center gap-[12px]"
        :class="{ 'cursor-pointer': !authUser }"
        @click="handleProfileCardClick"
      >
        <div class="avatar" id="avatarView" :title="authUser ? '点击更换头像' : '点击登录或注册'" @click.stop="handleAvatarClick">
          <img v-if="data.avatar" :src="imageDisplayUrl(data.avatar)" alt="头像">
          <template v-else>🌱</template>
        </div>
        <div class="min-w-[8rem] flex-1">
          <div class="profile-name" id="profileName">{{ authUser?.username || (authLoading ? '正在读取账号…' : '登录 / 注册') }}</div>
          <div class="profile-meta" id="profileMeta">{{ authUser?.email || (authUser ? '已登录' : '登录后可在这里管理账号资料') }}</div>
        </div>
        <div v-if="authUser" class="ml-auto flex shrink-0 gap-2">
          <button class="edit-name" id="editName" @click.stop="openNameEditor">编辑资料</button>
          <button class="edit-name" type="button" @click.stop="handleLogout">退出</button>
        </div>
        <span v-else class="ml-auto text-lg opacity-70">›</span>
      </div>

      <div class="section-head mx-[2px] mt-[25px] mb-3 flex items-center justify-between">
        <h2 class="m-0 text-[length:var(--font-section)]">设置</h2>
        <span class="text-[length:var(--font-label)] text-[var(--muted)]">按需调整</span>
      </div>
      <div class="flex flex-col gap-2">
        <button class="settings-box !mb-0 flex w-full items-center gap-3 text-left" @click="openSetting('habits')">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#263a2d] text-lg">🌱</span>
          <span class="min-w-0 flex-1">
            <strong class="block text-[length:var(--font-action)]">我的打卡项</strong>
            <small class="mt-1 block truncate text-[length:var(--font-label)] text-[var(--muted)]">{{ settingSummary('habits') }}</small>
          </span>
          <span class="text-lg text-[var(--muted)]">›</span>
        </button>
        <button class="settings-box !mb-0 flex w-full items-center gap-3 text-left" @click="openSetting('cycle')">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#263a2d] text-lg">🎯</span>
          <span class="min-w-0 flex-1">
            <strong class="block text-[length:var(--font-action)]">目标周期</strong>
            <small class="mt-1 block truncate text-[length:var(--font-label)] text-[var(--muted)]">{{ settingSummary('cycle') }}</small>
          </span>
          <span class="text-lg text-[var(--muted)]">›</span>
        </button>
        <button class="settings-box !mb-0 flex w-full items-center gap-3 text-left" @click="openSetting('rest')">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#263a2d] text-lg">☕</span>
          <span class="min-w-0 flex-1">
            <strong class="block text-[length:var(--font-action)]">每月小憩</strong>
            <small class="mt-1 block truncate text-[length:var(--font-label)] text-[var(--muted)]">{{ settingSummary('rest') }}</small>
          </span>
          <span class="text-lg text-[var(--muted)]">›</span>
        </button>
        <button class="settings-box !mb-0 flex w-full items-center gap-3 text-left" @click="openSetting('reminder')">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#263a2d] text-lg">🔔</span>
          <span class="min-w-0 flex-1">
            <strong class="block text-[length:var(--font-action)]">打卡提醒</strong>
            <small class="mt-1 block truncate text-[length:var(--font-label)] text-[var(--muted)]">{{ settingSummary('reminder') }}</small>
          </span>
          <span class="text-lg text-[var(--muted)]">›</span>
        </button>
      </div>
      <div class="note my-[18px] text-center text-[length:var(--font-label)] text-[var(--muted)]">
        账号设置与打卡记录保存在云端
      </div>
    </div>

    <div v-show="activeSetting">
      <div class="mb-5 flex items-center gap-3">
        <button class="rounded-full bg-[var(--paper)] px-3 py-2 text-[length:var(--font-label)] text-[var(--text)]" @click="backToSettings">‹ 我的</button>
        <h1 class="m-0 text-[length:var(--font-dialog)] font-bold">{{ activeSettingTitle }}</h1>
      </div>

      <div v-show="activeSetting === 'habits'">
        <div class="section-head mx-[2px] mb-3 flex items-center justify-between">
          <h2 class="m-0 text-[length:var(--font-section)]">我的打卡项</h2>
          <span class="text-[length:var(--font-label)] text-[var(--muted)]">↑ ↓ 调整顺序</span>
        </div>
        <div class="list-card" id="settingsList">
          <div v-if="!data.habits.length" class="empty">添加第一个习惯，开启旅程</div>
          <div
            v-for="habit in data.habits" :key="habit.id" class="setting-row" draggable="true"
            :class="{ 'is-dragging': draggingId === habit.id }"
            @dragstart="draggingId = habit.id" @dragend="draggingId = null"
            @dragover.prevent @drop.prevent="handleSettingDrop(habit.id)"
          >
            <div class="habit-icon" :style="{ background: COLORS[habit.color % COLORS.length] }">{{ habit.icon }}</div>
            <div class="setting-copy">
              <strong>{{ habit.name }}</strong>
              <small>{{ habit.needPhoto ? '📷 需照片 · ' : '' }}{{ habit.detail || '为自己做一件好事' }}</small>
            </div>
            <button type="button" class="row-btn" aria-label="上移" @click="shiftHabit(habit.id, -1)">↑</button>
            <button type="button" class="row-btn" aria-label="下移" @click="shiftHabit(habit.id, 1)">↓</button>
            <button type="button" class="row-btn" aria-label="编辑" @click="openHabitModal(habit.id)">✎</button>
            <button type="button" class="row-btn del" aria-label="删除" @click="deleteHabit(habit.id)">✕</button>
          </div>
        </div>
        <button class="add-btn" id="addHabit" @click="openHabitModal()">＋ 新建一个打卡项</button>
      </div>

      <div v-show="activeSetting === 'cycle'">
        <div class="section-head mx-[2px] mb-3 flex items-center justify-between">
          <h2 class="m-0 text-[length:var(--font-section)]">目标周期设置</h2>
          <span class="text-[length:var(--font-label)] text-[var(--muted)]" id="cycleHead">{{ cycleHeading }}</span>
        </div>
        <div class="settings-box">
          <div class="setting-label">目标周期</div>
          <div class="setting-hint" id="cycleHint">
            <template v-if="locked && phase === 'ended'">
              本轮周期已在 <b>{{ shortDate(data.end) }}</b> 结束，期间记录 <b>{{ cycleRecordDays() }}</b> 天。要开启新的周期请点下方按钮。
            </template>
            <template v-else-if="locked">
              目标周期已经开始（共 <b>{{ journeyDays() }}</b> 天，已走过 <b>{{ currentDay }}</b> 天），不能再直接调整。要改只能重新设置，当前正在进行中的周期会作废。
            </template>
            <template v-else-if="!cycle">第一次需要你自己定：先选开始的日期，再选结束的日期（也可以用下面的快捷天数一次填好结束日）。保存后周期从开始那天起算。</template>
            <template v-else>先选开始日期，再选结束日期，确认无误后点「保存周期」。周期一旦开始就会锁定，之后只能重新设置。</template>
          </div>
          <div class="date-row mt-3 flex items-end gap-2">
            <label class="date-field min-w-0 flex-1">
              <span class="mb-[5px] block text-[length:var(--font-label)] text-[var(--muted)]">开始</span>
              <input id="cycleStart" type="date" :value="draft.start || ''" :disabled="locked" @change="handleCycleStartChange">
            </label>
            <span class="date-sep pb-[10px] text-xs text-[var(--muted)]">→</span>
            <label class="date-field min-w-0 flex-1">
              <span class="mb-[5px] block text-[length:var(--font-label)] text-[var(--muted)]">结束</span>
              <input id="cycleEnd" type="date" :value="draft.end || ''" :disabled="locked" @change="handleCycleEndChange">
            </label>
          </div>
          <div class="preset-row mt-[10px] flex flex-wrap gap-[7px]" id="cyclePresets">
            <button v-for="days in [7, 21, 30, 100]" :key="days" type="button" :disabled="locked || !draftHasStart" @click="setCyclePreset(days)">{{ days }} 天</button>
          </div>
          <div v-if="!locked" class="cycle-preview" id="cyclePreview" :class="{ error: draftHasStart && draftHasEnd && !draftValid }">
            <template v-if="!draftHasStart">第一步：选择开始的日期</template>
            <template v-else-if="!draftHasEnd">第二步：选择结束的日期，或点上面的快捷天数</template>
            <template v-else-if="draftSpan < 1">结束日期不能早于开始日期，请重新选择结束日期</template>
            <template v-else-if="draftSpan > MAX_CYCLE_DAYS">一个周期最长 {{ MAX_CYCLE_DAYS }} 天，请把结束日期往前调</template>
            <template v-else>
              {{ draftDirty ? '新的周期共' : '共' }} <b>{{ draftSpan }}</b> 天{{ draftDirty ? '，确认后点保存' : '' }}
              <span v-if="draftDirty && draftStartsInPast" class="cycle-note">开始日期已在过去，保存后会立即锁定，之后只能重新设置</span>
            </template>
          </div>
          <div v-if="!locked" class="cycle-actions mt-[10px] flex gap-2" id="cycleActions">
            <button v-if="draftDirty" type="button" class="cycle-revert" id="cycleRevert" @click="revertCycleDraft">还原</button>
            <button type="button" class="cycle-save" id="saveCycle" :disabled="!draftDirty || !draftValid" @click="saveCycle">保存周期</button>
          </div>
          <button v-if="locked" type="button" class="reset-cycle" id="resetCycle" @click="confirmResetCycle">{{ phase === 'ended' ? '开启新的周期' : '重新设置周期' }}</button>
        </div>
      </div>

      <div v-show="activeSetting === 'rest'">
        <div class="settings-box">
          <div class="setting-label">每月小憩次数</div>
          <div class="setting-hint">本月未完成习惯时可使用，按自然月重置。小憩当天不算断签，也不计入完成次数。</div>
          <div class="number-control mt-[10px] flex items-center gap-[10px]">
            <button id="restMinus" aria-label="减少小憩次数" @click="adjustRestLimit(-1)">−</button>
            <input
              id="restLimit"
              ref="restLimitInput"
              :value="data.restLimit"
              type="number"
              min="0"
              max="99"
              inputmode="numeric"
              @change="commitRestLimit"
              @blur="commitRestLimit"
              @keydown.enter.prevent="$event.target.blur()"
            >
            <button id="restPlus" aria-label="增加小憩次数" @click="adjustRestLimit(1)">＋</button>
          </div>
        </div>
      </div>

      <div v-show="activeSetting === 'reminder'">
        <div class="settings-box">
          <div class="setting-label">打卡提醒</div>
          <div class="setting-hint" id="remindHint">
            <template v-if="!secure">浏览器要求通过 <b>https</b> 或本机 localhost 访问才能发送通知。</template>
            <template v-else-if="!notificationsAvailable">这个浏览器还不支持网页通知。桌面版 Chrome / Edge 可以，手机浏览器大多不行。</template>
            <template v-else-if="reminderPermission === 'denied'">通知权限被拒绝了。到系统或浏览器的通知设置里把这个网页放开，再回来打开开关。</template>
            <template v-else-if="reminderOn">到点提醒你记录当天的小事。需要页面开着，关掉页面就不会响。</template>
            <template v-else>到点提醒你记录当天的小事。只在这台设备上触发，数据不上传。</template>
          </div>
          <div class="remind-row mt-3 flex items-center justify-between gap-3 rounded-[14px] px-[13px] py-[11px]">
            <span>提醒时间</span>
            <input type="time" id="remindTime" :value="reminder?.time || '21:00'" :disabled="!notificationsAvailable" step="60" @change="handleReminderTimeChange">
          </div>
          <button type="button" class="switch-row" id="remindSwitch" :class="{ on: reminderOn }" :aria-pressed="!!reminderOn" :disabled="!notificationsAvailable" @click="toggleReminder">
            <span class="switch-copy">
              <b>每天提醒我</b>
              <small id="remindSub">{{ reminderSubtitle }}</small>
            </span>
            <span class="switch"><i></i></span>
          </button>
        </div>
      </div>
    </div>
  </section>

  <Teleport v-if="modal?.kind === 'habit' || modal?.kind === 'name'" to="#modal">
    <form v-if="modal.kind === 'habit'" @submit.prevent="saveHabit">
      <h3>{{ habitForm.id ? '编辑打卡项' : '新建打卡项' }}</h3>
      <label class="field" for="habitName">给这个习惯起个名字</label>
      <input v-model="habitForm.name" class="input" id="habitName" maxlength="18" placeholder="例如：阅读 20 分钟">
      <label class="field" for="habitDetail">一句小提示</label>
      <input v-model="habitForm.detail" class="input" id="habitDetail" maxlength="28" placeholder="例如：让好内容住进脑海">
      <div class="field">选择一个图标</div>
      <div class="emoji-row">
        <button
          v-for="icon in ICONS" :key="icon" type="button" class="emoji"
          :class="{ selected: icon === habitForm.icon }" :aria-pressed="icon === habitForm.icon"
          @click="habitForm.icon = icon"
        >{{ icon }}</button>
      </div>
      <button type="button" class="switch-row" id="needPhotoRow" :class="{ on: habitForm.needPhoto }" :aria-pressed="habitForm.needPhoto" @click="habitForm.needPhoto = !habitForm.needPhoto">
        <span class="switch-copy">
          <b>需要上传照片</b>
          <small>打卡这项时要拍照或选一张图，才算完成</small>
        </span>
        <span class="switch"><i></i></span>
      </button>
      <div class="modal-actions">
        <button type="button" @click="closeModal">取消</button>
        <button type="submit" class="save">保存</button>
      </div>
    </form>

    <form v-else @submit.prevent="saveName">
      <h3>编辑个人资料</h3>
      <label class="field" for="nameInput">用户名</label>
      <input v-model="usernameDraft" class="input" id="nameInput" maxlength="24">
      <div class="modal-actions">
        <button type="button" @click="closeModal">取消</button>
        <button type="submit" class="save">保存</button>
      </div>
    </form>
  </Teleport>
</template>
