<script setup>
import { computed, onActivated, onDeactivated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { core } from '../composables/dayByDayCore.js'
import { authLoading, authUser } from '../stores/auth'
import { accountDataLoading, journalLoadError, journalReady, refreshAccountData, saveAccountJournal } from '../stores/journal'
import { settingsLoadError, settingsReady } from '../stores/settings'
import { compressImage } from '../utils/image'
import { imageDisplayUrl, uploadImage } from '../services/images'
import CheckinCelebration from './CheckinCelebration.vue'
import TodayWeather from './TodayWeather.vue'

const router = useRouter()
const route = useRoute()
let homeActive = false
const homeLoadError = computed(() => authUser.value
  ? (settingsReady.value ? journalLoadError.value : settingsLoadError.value)
  : '')
const homeLoading = computed(() => authLoading.value || !!authUser.value && (
  accountDataLoading.value || (!homeLoadError.value && (!settingsReady.value || !journalReady.value))
))

const {
  PHOTO_MAX_EDGE, PHOTO_QUALITY, COLORS, WEEK, $, pad2, dateKey, parseKey, shiftDays,
  today, yesterdayKey, fmtDate, shortDate, isDateKey, data, persist, photoKey, photoOf,
  putPhoto, dropPhoto, dropPhotosBy, recordsOf, isCheckedIn, isRestDay,
  hasCycle, journeyDays, lastSettleableKey, cycleRecordDays, dayNum, ensureViewDate,
  streakDays, toast, openModal, closeModal, confirmAction, modal, revision,
} = core

let pendingPhoto = null
function shiftViewDate(delta) {
  if (!journalReady.value || !settingsReady.value) return;
  if (!core.viewDate) return;
  const latest = lastSettleableKey();
  if (!latest) return;

  const next = dateKey(shiftDays(parseKey(core.viewDate), delta));
  if (next < data.start || next > latest) return;

  core.viewDate = next;
  core.refreshAll();
}

const clock = ref(new Date())
const todayDate = computed(() => dateKey(clock.value))
const viewDate = computed(() => core.viewDate)
const cycle = computed(hasCycle)
const pending = computed(() => cycle.value && data.start > todayDate.value)
const days = computed(journeyDays)
const currentDay = computed(() => { revision.value; return dayNum() })
const latest = computed(() => { revision.value; return lastSettleableKey() })
const ended = computed(() => data.end < todayDate.value)
const liveDays = computed(() => {
  todayDate.value
  return ended.value ? cycleRecordDays() : streakDays()
})
const done = computed(() => viewDate.value ? recordsOf(viewDate.value) : [])
const total = computed(() => data.habits.length)
const isYesterday = computed(() => { todayDate.value; return viewDate.value === yesterdayKey() })
const pendingDayHabits = computed(() => viewDate.value
  ? data.habits.filter(habit => !done.value.includes(habit.id)) : [])
const bubble = ref(null)
let bubbleTimer
const selectedPhoto = ref(null)
const selectedPhotoUrl = ref('')
const photoSaving = ref(false)

function clearSelectedPhoto() {
  if (selectedPhotoUrl.value) URL.revokeObjectURL(selectedPhotoUrl.value)
  selectedPhotoUrl.value = ''
  selectedPhoto.value = null
}

function showBubble(habit, rect) {
  clearTimeout(bubbleTimer)
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const particles = Array.from({ length: 48 }, (_, index) => {
    const angle = index * 2 * Math.PI / 48
    const dx = Math.sin(angle)
    const dy = -Math.cos(angle)
    const horizontal = dx > 0 ? (window.innerWidth - x) / dx : dx < 0 ? -x / dx : Infinity
    const vertical = dy > 0 ? (window.innerHeight - y) / dy : dy < 0 ? -y / dy : Infinity
    const edge = Math.min(horizontal, vertical)
    return {
      '--angle': `${index * 360 / 48}deg`,
      '--distance': `${Math.max(110, edge * (.83 + index % 4 * .07))}px`,
      '--delay': `${index % 5 * 20}ms`,
      '--size': `${index % 6 === 0 ? 21 : 8 + index % 5 * 3}px`,
    }
  })
  bubble.value = { id: Date.now(), name: habit.name, x, y, particles }
  bubbleTimer = setTimeout(() => { bubble.value = null }, 1650)
}

async function onHabitCard(habit, event) {
  const key = viewDate.value
  if (!key || done.value.includes(habit.id)) return
  const rect = event.currentTarget.getBoundingClientRect()
  if (habit.needPhoto) {
    clearSelectedPhoto()
    openModal({ kind: 'habit-photo', key, habitId: habit.id, name: habit.name })
    return
  }
  if (await toggleHabit(key, habit.id, false)) showBubble(habit, rect)
}

function pickCardPhoto() {
  pendingPhoto = { key: modalKey.value, habitId: modal.value.habitId, preview: true }
  const input = $('photoFile')
  input.value = ''
  input.click()
}

async function completePhotoCard() {
  if (!selectedPhoto.value || photoSaving.value) return
  photoSaving.value = true
  const key = modalKey.value
  const habitId = modal.value.habitId
  const saved = await handleHabitPhoto(selectedPhoto.value, key, habitId)
  photoSaving.value = false
  if (saved) {
    clearSelectedPhoto()
    closeModal()
  }
}

const checkEntry = computed(() => {
  const key = viewDate.value
  if (!key || !total.value) return null
  const remaining = total.value - done.value.length
  if (remaining <= 0) return { title: '这一天全部完成 ✨', pill: '查看', className: 'is-done' }
  if (isCheckedIn(key)) {
    const status = remaining === total.value ? '一项都没完成' : `还差 ${remaining} 个`
    return { title: `✓ 已打卡 · ${status}`, pill: '查看', className: 'is-checked' }
  }
  return { title: isYesterday.value ? '给昨天打卡' : `补记 ${shortDate(key)}`, pill: '打卡' }
})

function greetingByHour() {
  const hour = clock.value.getHours();
  if (hour < 6) return '夜深了，记得早点休息';
  if (hour < 11) return '早上好，今天也为自己留一点时间';
  if (hour < 14) return '中午好，别忘了照顾一下自己';
  if (hour < 19) return '下午好，还有时间完成一点点';
  return '晚上好，今天辛苦了';
}

/* ---- 首页实时条：距今天结束的倒计时 + 连续坚持天数 ---- */
let tickTimer = null;
const syncTickerOnVisibility = () => {
  if (document.visibilityState === 'visible') tickLiveStrip();
};
const countdown = computed(() => {
  const now = clock.value
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return fmtCountdown(midnight - now)
})

function fmtCountdown(ms) {
  // 夹到 24 小时内，避免零点瞬间闪出 24:00:00
  const total = Math.min(86399, Math.max(0, Math.floor(ms / 1000)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${pad2(h)}小时${pad2(m)}分钟${pad2(total % 60)}秒`;
}

function tickLiveStrip() {
  const previousDay = todayDate.value
  clock.value = new Date()
  if (todayDate.value !== previousDay) {
    ensureViewDate()
    core.refreshAll()
  }
}

function startTicker() {
  if (tickTimer) return;
  tickLiveStrip()
  tickTimer = setInterval(tickLiveStrip, 1000);
  document.addEventListener('visibilitychange', syncTickerOnVisibility);
}

const modalKey = computed(() => modal.value?.key)
const modalDone = computed(() => modalKey.value ? recordsOf(modalKey.value) : [])
const modalChecked = computed(() => modalKey.value && isCheckedIn(modalKey.value))
const modalHabits = computed(() => data.habits.map(habit => ({
  ...habit,
  finished: modalDone.value.includes(habit.id),
  shot: photoOf(modalKey.value, habit.id),
})))
const photoLeft = computed(() => modalHabits.value.filter(habit => habit.needPhoto && !habit.shot).length)
const undoArmed = ref(false)
let undoTimer
const celebration = ref(null)
let celebrationTimer
let celebrationId = 0

function clearCelebration() {
  clearTimeout(celebrationTimer)
  celebration.value = null
}

async function saveCheckin(key, celebrate) {
  const accountId = authUser.value?.id
  const completed = recordsOf(key).length
  const target = data.habits.length
  await saveAccountJournal()
  if (!celebrate || !homeActive || authUser.value?.id !== accountId || !isCheckedIn(key)) return

  clearCelebration()
  celebration.value = { id: ++celebrationId, day: shortDate(key), completed, target }
  celebrationTimer = setTimeout(clearCelebration, 3000)
}

function openCheckModal(key = core.viewDate) {
  if (!key) {
    toast(hasCycle() ? '这一天还不能记录' : '先在「我的」里设置目标周期');
    return;
  }
  clearTimeout(undoTimer)
  undoArmed.value = false
  openModal({ kind: 'check', key })
}

function handleCheckUndo() {
  if (undoArmed.value) {
    cancelCheckin(modalKey.value)
    return
  }
  undoArmed.value = true
  undoTimer = setTimeout(() => { undoArmed.value = false }, 3000)
}

/**
 * 打卡行点击：普通项直接勾选；需要照片的项
 * 没照片 → 去拍照/选图；已有照片 → 和普通项一样勾选或取消。
 * 看大图只走缩略图，不再抢占整行的点击。
 */
function onCheckRow(key, id) {
  const habit = data.habits.find(h => h.id === id);
  if (!habit || !key) return;

  if (!habit.needPhoto) { toggleHabit(key, id); return; }
  if (!core.photoReady) { toast('照片还在读取，稍等一下再点'); return; }
  if (!photoOf(key, id)) { pickHabitPhoto(key, id); return; }
  toggleHabit(key, id);
}

/** 点「完成打卡」：即使一项都没勾，也把这天记成已打卡 */
async function commitCheckin() {
  const key = modalKey.value;
  if (!key) { closeModal(); return; }

  // 已有打卡记录时，「完成」只关闭弹层。
  if (isCheckedIn(key)) { closeModal(); return; }

  data.checkins[key] = 1;
  closeModal();
  core.refreshAll();
  try {
    await saveCheckin(key, true)
  } catch (error) {
    toast(error instanceof Error ? error.message : '打卡记录保存失败')
  }
}

/** 撤销某天的打卡：连同当天的完成项与照片一起清掉 */
function cancelCheckin(key) {
  if (!key) return;
  clearCelebration()
  delete data.checkins[key];
  delete data.records[key];
  dropPhotosBy(id => id.startsWith(`${key}|`));
  persist();
  closeModal();
  core.refreshAll();
  toast(`${shortDate(key)} 的打卡已撤销`);
}

/* ---- 打卡照片：拍照 / 选图 / 看大图 / 删除 ---- */
function pickHabitPhoto(key, habitId) {
  pendingPhoto = { key, habitId };
  const input = $('photoFile');
  input.value = '';
  input.click();
}

async function handleHabitPhoto(file, key, habitId) {
  const habit = data.habits.find(h => h.id === habitId);
  if (!habit) return;
  if (!file || !file.type.startsWith('image/')) {
    toast('只能上传图片文件');
    return;
  }

  const accountId = authUser.value?.id;
  toast('照片处理中…');
  let url;
  try {
    url = await compressImage(file, PHOTO_MAX_EDGE, PHOTO_QUALITY);
  } catch {
    toast('这张照片读不出来，换一张试试');
    return;
  }
  try {
    const blob = await (await fetch(url)).blob();
    const imagePath = await uploadImage(blob);
    if (authUser.value?.id !== accountId || !journalReady.value) return;
    putPhoto(photoKey(key, habitId), imagePath);

    // 照片到位才算这项完成
    const done = recordsOf(key);
    const firstCheckin = !isCheckedIn(key)
    const completesDay = !done.includes(habitId) && done.length + 1 === data.habits.length
    if (!done.includes(habitId)) data.records[key] = [...done, habitId];
    data.checkins[key] = 1;
    await saveCheckin(key, firstCheckin || completesDay);

    if (!firstCheckin && !completesDay) toast(`${habit.name} · 照片已保存，这项完成 ✨`);
    return true
  } catch (error) {
    toast(error instanceof Error ? error.message : '照片保存失败，请重试');
    return false
  }
}

/** 删掉照片：这一项退回未完成，打卡本身保留 */
function removeHabitPhoto(key, habitId) {
  dropPhoto(photoKey(key, habitId));
  const done = recordsOf(key);
  const next = done.filter(id => id !== habitId);
  if (next.length) data.records[key] = next;
  else delete data.records[key];

  persist();
  core.refreshAll();
  toast('照片已删除 · 这项回到未完成');
}

/** 大图查看。from: 'check' 打卡弹层 / 'home' 首页卡片 */
function openPhotoView(key, habitId, from) {
  const habit = data.habits.find(h => h.id === habitId);
  const src = photoOf(key, habitId);
  if (!habit || !src) return;

  openModal({ kind: 'photo', key, habitId, from, name: habit.name, src })
}

function returnFromPhoto() {
  const { key, from } = modal.value
  if (from === 'check') openCheckModal(key)
  else closeModal()
}

function confirmPhotoRemoval() {
  const { key, habitId } = modal.value
  confirmAction('删除这张照片', '删除后这一项会变回未完成，照片无法恢复。', () => {
    removeHabitPhoto(key, habitId)
    openCheckModal(key)
  }, '删除')
}


function goToCycleSettings() {
  router.push({ path: '/profile', query: { setting: 'cycle' } });
}

function recordNote(key, doneList, total) {
  if (!hasCycle()) return '还没有目标周期 · 去「我的」设置开始与结束日期';
  if (!total) return '先去「我的」挑几件想坚持的小事';
  if (!key && data.start > today()) return `周期从 ${shortDate(data.start)} 开始，那天过后就能记录`;
  if (!key) return '周期刚开始，明天起就能记录今天的完成情况';
  if (isRestDay(key)) return '这天请了假，不算断签，也不计入完成次数';

  const checked = isCheckedIn(key);
  if (checked) {
    if (!doneList.length) return '这天已打卡 · 一项都没完成，日历里会标成未完成';
    if (doneList.length === total) return '这一天全部完成 ✨';
    return `已打卡 · 完成 ${doneList.length} / ${total}，还差 ${total - doneList.length} 个`;
  }

  if (!doneList.length) return key === yesterdayKey()
    ? '昨天还没有打卡 · 点击下方卡片记录'
    : '这天还没有打卡 · 点击下方卡片补记';
  return `已完成 ${doneList.length} / ${total}，还差 ${total - doneList.length} 个`;
}

async function toggleHabit(key, id, showCelebration = true) {
  const habit = data.habits.find(h => h.id === id);
  if (!habit) return;

  const done = recordsOf(key);
  const already = done.includes(id);

  // 需要照片的项：还没有照片就去拍 / 选，不能直接勾
  if (habit.needPhoto && !already && !photoOf(key, id)) {
    pickHabitPhoto(key, id);
    return;
  }

  const next = already ? done.filter(x => x !== id) : [...done, id];
  const celebrate = !already && (!isCheckedIn(key) || next.length === data.habits.length)
  if (next.length) {
    data.records[key] = next;
    data.checkins[key] = 1;   // 勾了任意一项，这天就算打过卡了
  } else {
    delete data.records[key];  // 全部取消也不撤销打卡，要撤销走弹层里的按钮
  }

  core.refreshAll();

  try {
    await saveCheckin(key, showCelebration && celebrate)
    return true
  } catch (error) {
    toast(error instanceof Error ? error.message : '打卡记录保存失败')
    return false
  }
}


function stopTicker() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  document.removeEventListener('visibilitychange', syncTickerOnVisibility);
}

function requireReady(action) {
  if (!authUser.value) {
    router.push({ path: '/auth', query: { redirect: '/home' } });
    return;
  }
  if (!journalReady.value || !settingsReady.value) {
    toast('正在读取线上打卡数据，请稍候');
    return;
  }
  action()
}

function handlePhotoFileChange(event) {
  if (!authUser.value || !journalReady.value) return;
  const input = event.target;
  const file = input.files[0];
  input.value = '';
  if (!file || !pendingPhoto) return;
  const target = pendingPhoto;
  pendingPhoto = null;
  if (target.preview) {
    clearSelectedPhoto()
    selectedPhoto.value = file
    selectedPhotoUrl.value = URL.createObjectURL(file)
    return
  }
  handleHabitPhoto(file, target.key, target.habitId);
}

function activatePage() {
  core.initialize()
  ensureViewDate()
  startTicker()
  core.actions.photoFileChange = handlePhotoFileChange
  if (authUser.value) void refreshAccountData()
  homeActive = true
  openRequestedDay()
}

function deactivatePage() {
  homeActive = false
  clearCelebration()
  clearSelectedPhoto()
  clearTimeout(bubbleTimer)
  bubble.value = null
  stopTicker()
  if (['check', 'photo', 'habit-photo'].includes(modal.value?.kind)) closeModal()
  core.actions.photoFileChange = null
}

function openRequestedDay() {
  if (!homeActive || !authUser.value || homeLoading.value || homeLoadError.value) return
  if (route.path !== '/home') return
  const edit = route.query.editDay
  const day = route.query.day
  if (typeof edit === 'string' && isDateKey(edit)) {
    if (latest.value && edit >= data.start && edit <= latest.value) {
      core.viewDate = edit
      openCheckModal(edit)
    }
  } else if (typeof day === 'string' && isDateKey(day) && isCheckedIn(day)) {
    openModal({ kind: 'day', key: day })
  }
  if (edit !== undefined || day !== undefined) {
    const query = { ...route.query }
    delete query.editDay
    delete query.day
    void router.replace({ query })
  }
}

watch([() => route.query.editDay, () => route.query.day, homeLoading, homeLoadError], openRequestedDay)
onActivated(activatePage)
onDeactivated(deactivatePage)
watch(() => authUser.value?.id, () => {
  pendingPhoto = null
  clearCelebration()
  clearSelectedPhoto()
  if (['check', 'photo', 'habit-photo'].includes(modal.value?.kind)) closeModal()
})
</script>
<template>
  <section class="page active px-5 pt-3 pb-6" id="home">
    <div class="today-line flex items-center gap-3 mx-[2px] mt-[6px] mb-[14px]">
      <div class="today-badge flex h-[58px] w-[58px] flex-none items-center justify-center rounded-[18px]">
        <b id="todayNum">{{ pad2(clock.getDate()) }}</b>
      </div>
      <div class="today-copy flex min-w-0 flex-col gap-[5px]">
        <b id="todayMeta">{{ clock.getMonth() + 1 }}月 · 周{{ WEEK[clock.getDay()] }}</b>
        <span class="greet" id="greeting">{{ greetingByHour() }}</span>
      </div>
    </div>
    <TodayWeather :date="todayDate" />
    <h1 class="headline my-[10px] text-[length:var(--font-title)] font-bold tracking-[-.04em]">
      把日子过成<span>喜欢的样子</span>
    </h1>

    <div v-if="homeLoading" class="empty mt-5 grid min-h-48 content-center justify-items-center gap-3" role="status">
      <span aria-hidden="true" class="h-5 w-5 animate-spin rounded-full border-2 border-solid border-[var(--line)] border-t-[var(--green)] motion-reduce:animate-none"></span>
      正在读取打卡数据…
    </div>
    <div v-else-if="homeLoadError" class="empty mt-5 grid min-h-48 content-center justify-items-center gap-3">
      <span role="alert">{{ homeLoadError }}</span>
      <button type="button" class="rounded-full bg-[var(--green)] px-4 py-2 text-[var(--bg)]" @click="refreshAccountData()">重试</button>
    </div>
    <template v-else>
      <div class="live-strip" id="liveStrip" :hidden="!cycle || todayDate < data.start" :class="{ 'is-ended': ended }">
        <div class="live-cell">
          <span class="live-label" id="liveLabel">{{ ended ? '本次周期' : '今天还剩' }}</span>
          <b class="live-time" id="liveTime">{{ ended ? '已结束' : countdown }}</b>
        </div>
        <div class="live-cell live-cell-right">
          <span class="live-label" id="liveDaysLabel">{{ ended ? '本周期记录' : '连续坚持' }}</span>
          <b class="live-days" id="liveDays">{{ liveDays }} 天</b>
        </div>
      </div>


      <div class="hero" id="heroCard" :class="{ 'is-unset': !cycle }">
        <div class="hero-label">DAY OF YOUR JOURNEY</div>
        <div class="hero-row flex gap-2 items-end justify-between mt-[13px]">
          <div class="hero-num text-[43px] leading-none font-bold tracking-[-.06em] text-[var(--lime)]">
            <span id="dayCount">{{ cycle ? pad2(currentDay) : '旅程还没开始' }}</span><small> 天/ <span id="goalDisplay">{{ cycle ? days : '—' }}</span> 天</small>
          </div>
          <div class="hero-side text-right text-[18px] text-[#d5e4c9] opacity-80">
            <b id="dayDone">{{ done.length }} / {{ total }}</b><br><span id="doneLabel">{{ !cycle ? '待设置' : viewDate ? (isYesterday ? '昨日完成' : '当日完成') : pending ? '周期开始后记录' : '明天开始记录' }}</span>
          </div>
        </div>
        <div class="progress"><i id="journeyProgress" :style="{ width: cycle ? Math.min(100, currentDay / days * 100) + '%' : '0%' }"></i></div>
      </div>

      <div class="section-head mx-[2px] mt-[25px] mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="m-0 text-[length:var(--font-section)]" id="recordTitle">{{ !cycle ? '还没有设置周期' : viewDate ? (isYesterday ? '昨天的习惯' : '补记') : pending ? '周期还没开始' : '今天还没结束' }}</h2>
        <div class="day-switch" id="daySwitch" :hidden="!cycle">
          <button class="day-step" id="dayPrev" aria-label="前一天" :disabled="!viewDate || viewDate <= data.start" @click="requireReady(() => shiftViewDate(-1))">‹</button>
          <span class="day-cur" id="recordDate">{{ cycle ? fmtDate(viewDate || (pending ? data.start : todayDate)) : '—' }}</span>
          <button class="day-step" id="dayNext" aria-label="后一天" :disabled="!viewDate || viewDate >= latest" @click="requireReady(() => shiftViewDate(1))">›</button>
        </div>
      </div>

      <button v-if="checkEntry && !pendingDayHabits.length" type="button" class="check-entry" id="checkEntry" :class="checkEntry.className" @click="requireReady(() => openCheckModal())">
        <span class="check-entry-copy">
          <b>{{ checkEntry.title }}</b>
          <small>{{ fmtDate(viewDate) }} · {{ done.length }} / {{ total }} 已完成</small>
        </span>
        <span class="check-entry-go">{{ checkEntry.pill }}</span>
      </button>

      <div v-if="!cycle || !total || pendingDayHabits.length" class="habit-list" id="habitList">
        <div v-if="!cycle" class="home-empty">
          <div class="empty-art">◷</div>
          <strong>先定一个目标周期</strong>
          <span>选择开始的日期和结束的日期<br>有了周期，才知道自己走到了第几天</span>
          <button type="button" id="cycleCta" @click="requireReady(goToCycleSettings)">去设置目标周期　↗</button>
        </div>
        <div v-else-if="!total" class="home-empty">
          <div class="empty-art">✦</div>
          <strong>从一个小习惯开始</strong>
          <span>为自己挑一件想坚持的事<br>每天完成一点点</span>
          <button type="button" id="emptyAdd" @click="requireReady(() => router.push('/profile'))">去添加打卡项　↗</button>
        </div>
        <template v-else>
          <button
            v-for="habit in pendingDayHabits"
            :key="habit.id"
            type="button"
            class="habit"
            @click="requireReady(() => onHabitCard(habit, $event))"
          >
            <span v-if="habit.needPhoto" class="habit-flag">📷</span>
            <div class="habit-icon" :style="{ background: COLORS[habit.color % COLORS.length] }">{{ habit.icon }}</div>
            <div class="habit-copy"><div class="habit-title">{{ habit.name }}</div></div>
          </button>
        </template>
      </div>

      <div class="record-note" id="recordNote">{{ recordNote(viewDate, done, total) }}</div>

      <div class="tip">✦ &nbsp;当天的习惯在第二天记录，因为只有过完这一天，才知道结果</div>
    </template>
  </section>

  <CheckinCelebration :celebration="celebration" />
  <Teleport to="body">
    <div v-if="bubble" :key="bubble.id" class="check-bubble" :style="{ left: bubble.x + 'px', top: bubble.y + 'px' }" role="status">
      <span class="check-bubble-screen" :style="{ left: -bubble.x + 'px', top: -bubble.y + 'px', '--burst-x': bubble.x + 'px', '--burst-y': bubble.y + 'px' }"></span>
      <span class="check-bubble-core"><span class="check-bubble-shine"></span></span>
      <span class="check-bubble-flash"></span>
      <span v-for="(particle, index) in bubble.particles" :key="index" class="check-bubble-particle" :class="{ 'is-shard': index % 6 === 0 }" :style="particle"></span>
      <strong class="check-bubble-success">✓ {{ bubble.name }} 打卡成功</strong>
    </div>
  </Teleport>

  <Teleport v-if="['check', 'photo', 'habit-photo'].includes(modal?.kind)" to="#modal">
    <template v-if="modal.kind === 'check'">
      <div class="check-head">
        <h3>{{ modalKey === yesterdayKey() ? '昨天完成了哪些' : shortDate(modalKey) + ' 的完成情况' }}</h3>
        <span class="check-count">{{ modalDone.length }} / {{ total }}</span>
      </div>
      <p class="modal-desc">{{ fmtDate(modalKey) }}{{ isRestDay(modalKey) ? ' · 这天请了假，不算断签' : '' }} · 勾选即记录{{ photoLeft ? '；带 📷 的项要上传照片才算完成' : '' }}，随时可以撤销</p>
      <div v-if="modalChecked" class="check-status">
        ✓ 已打卡 · <template v-if="modalDone.length">完成 <em>{{ modalDone.length }}</em> / {{ total }}</template><template v-else>一项都没完成</template>
      </div>
      <div v-else class="check-tip">还没打卡 · 一项都不勾也可以点「完成打卡」，会记为未完成{{ photoLeft ? '；带 📷 的 ' + photoLeft + ' 项要上传照片才算完成' : '' }}</div>
      <div class="check-list">
        <div v-if="!total" class="empty">还没有打卡项，先去「我的」添加一个</div>
        <button v-for="habit in modalHabits" :key="habit.id" type="button" class="check-row" :class="{ done: habit.finished }" @click="onCheckRow(modalKey, habit.id)">
          <span class="check-row-icon" :style="{ background: COLORS[habit.color % COLORS.length] }">{{ habit.icon }}</span>
          <span class="check-row-name">
            <b>{{ habit.name }}</b>
            <small v-if="habit.needPhoto">{{ habit.shot ? (habit.finished ? '照片已上传 · 点图看大图' : '照片已上传 · 点这一行完成') : (habit.finished ? '缺照片 · 点一下补传' : '点一下拍照 / 选图') }}</small>
          </span>
          <template v-if="habit.needPhoto">
            <img v-if="habit.shot" class="check-thumb" :src="imageDisplayUrl(habit.shot)" alt="查看照片" title="查看照片" @click.stop="openPhotoView(modalKey, habit.id, 'check')">
            <span v-else class="check-need">📷</span>
          </template>
          <span class="check-row-mark">✓</span>
        </button>
      </div>
      <div class="modal-actions">
        <button type="button" class="save" id="checkClose" @click="commitCheckin">{{ modalChecked ? '完成' : '完成打卡' }}</button>
      </div>
      <button v-if="modalChecked" type="button" class="check-undo" id="checkUndo" :class="{ armed: undoArmed }" @click="handleCheckUndo">{{ undoArmed ? '再点一次确认撤销' : '撤销这天的打卡' }}</button>
    </template>

    <template v-else-if="modal.kind === 'habit-photo'">
      <h3>{{ modal.name }}</h3>
      <p class="modal-desc">{{ fmtDate(modalKey) }} · 上传照片后完成打卡</p>
      <button type="button" class="photo-pick-card" @click="pickCardPhoto">
        <img v-if="selectedPhotoUrl" :src="selectedPhotoUrl" alt="待上传的打卡照片">
        <span v-else>📷<br>拍照或选择图片</span>
      </button>
      <div class="modal-actions">
        <button type="button" @click="clearSelectedPhoto(); closeModal()">取消</button>
        <button type="button" class="save" :disabled="!selectedPhoto || photoSaving" @click="completePhotoCard">{{ photoSaving ? '上传中…' : '完成' }}</button>
      </div>
    </template>
    <template v-else>
      <h3>{{ modal.name }}</h3>
      <p class="modal-desc">{{ fmtDate(modalKey) }} · 打卡照片</p>
      <div class="photo-frame"><img :src="imageDisplayUrl(modal.src)" :alt="modal.name + '的打卡照片'"></div>
      <div class="modal-actions">
        <button type="button" id="photoBack" @click="returnFromPhoto">{{ modal.from === 'check' ? '返回打卡' : '关闭' }}</button>
        <button v-if="modal.from === 'check'" type="button" class="danger" id="photoDel" @click="confirmPhotoRemoval">删除照片</button>
      </div>
    </template>
  </Teleport>
</template>
