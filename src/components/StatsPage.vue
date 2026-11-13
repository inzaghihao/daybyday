<script setup>
import { computed, onActivated, onDeactivated, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { core } from '../composables/dayByDayCore.js'
import { authUser } from '../stores/auth'
import { accountDataLoading, journalReady, journalRevision, refreshAccountData } from '../stores/journal'
import { settingsReady, settingsRevision } from '../stores/settings'
import { getJournalStats } from '../services/journal'

const router = useRouter()
const statsActive = ref(false)
const serverStats = ref(null)
const {
  COLORS, WEEK, pad2, dateKey, parseKey, shiftDays, today, monthOf, fmtDate, shortDate,
  data, persist, recordsOf, isCheckedIn, isDayComplete, isRestDay, hasCycle,
  journeyDays, lastSettleableKey, cycleRecordDays, dayNum, settledDays, restUsed, restLeft,
  streakDays, totalChecks, checksInCycle, habitCounts, toast, revision,
} = core

const restCard = computed(() => {
  const key = core.viewDate;
  const left = restLeft();
  const done = key ? recordsOf(key) : [];
  const unfinished = data.habits.some(h => !done.includes(h.id));

  let hint;
  let label;
  let disabled = true;

  if (!hasCycle()) {
    hint = '先在「我的」里设置目标周期，再开始记录';
    label = '还没有目标周期';
  } else if (!data.habits.length) {
    hint = '还没有打卡项，先去添加一个吧';
    label = '暂无可休息的打卡项';
  } else if (!key) {
    hint = '今天还没结束，明天再来记录';
    label = '还没有可结算的日期';
  } else if (isRestDay(key)) {
    hint = `${shortDate(key)}已经请过假了`;
    label = '这天已休息 🌿';
  } else if (left <= 0) {
    hint = `本月额度已经用完了（共 ${data.restLimit} 次）`;
    label = '本月小憩次数已用完';
  } else if (!unfinished) {
    hint = `${shortDate(key)}已全部完成，不需要小憩啦`;
    label = '这天已经完成';
  } else {
    hint = `还剩 ${left} 次，留给实在做不到的那天`;
    label = `为 ${shortDate(key)} 请一次假 · 剩余 ${left} 次`;
    disabled = false;
  }

  return { hint, label, disabled }
})

const elapsed = computed(() => { revision.value; return settledDays() })
const currentDay = computed(() => { revision.value; return dayNum() })
const cycle = computed(hasCycle)
const total = computed(() => serverStats.value?.totalChecks ?? totalChecks())
const streak = computed(() => { revision.value; return serverStats.value?.streakCount ?? streakDays() })
const rate = computed(() => {
  const possible = elapsed.value * data.habits.length
  return serverStats.value?.completionRate ?? (possible ? Math.min(100, Math.round(checksInCycle() / possible * 100)) : 0)
})
const counts = computed(() => serverStats.value
  ? data.habits.map(habit => [habit, serverStats.value.habitCounts[habit.id] || 0]).sort((a, b) => b[1] - a[1])
  : habitCounts())
const maxCount = computed(() => Math.max(1, ...counts.value.map(([, count]) => count)))
const topHabit = computed(() => counts.value[0]?.[1] ? counts.value[0][0] : null)

const calendar = computed(() => {
  revision.value
  if (!cycle.value) return []
  const todayKey = today()
  const start = parseKey(data.start);
  const end = parseKey(data.end);
  const blocks = [];

  let year = start.getFullYear();
  let month = start.getMonth();

  while (year < end.getFullYear() || (year === end.getFullYear() && month <= end.getMonth())) {
    const lastDate = new Date(year, month + 1, 0).getDate();
    const offset = new Date(year, month, 1).getDay();
    const cells = [];

    for (let day = 1; day <= lastDate; day++) {
      const key = `${year}-${pad2(month + 1)}-${pad2(day)}`;
      const current = new Date(year, month, day);
      const inRange = current >= start && current <= end;

      const checked = isCheckedIn(key);
      const classes = ['day'];
      if (key === todayKey) classes.push('today');

      // 全部完成 / 打了卡但没完成 / 小憩日，三种状态分开
      if (isDayComplete(key)) classes.push('hit');
      else if (checked) classes.push('part');
      else if (isRestDay(key)) classes.push('rest');

      if (!inRange) classes.push('out');
      else if (checked) classes.push('is-open');

      cells.push({ day, key, classes, open: inRange && checked });
    }

    blocks.push({ year, month: month + 1, offset, cells });

    month += 1;
    if (month === 12) { month = 0; year += 1; }
  }

  return blocks;
})

const bars = computed(() => {
  revision.value
  const max = Math.max(1, data.habits.length);
  const settled = lastSettleableKey();
  const latest = settled ? parseKey(settled) : shiftDays(new Date(), -1);
  return Array.from({ length: 7 }, (_, i) => {
    const date = shiftDays(latest, i - 6);
    const key = dateKey(date);
    const count = recordsOf(key).length;
    const checked = isCheckedIn(key);

    // 三态：有完成项按比例 / 只打卡没完成用空心柱 / 没打卡压到最低
    let cls = 'bar';
    let height = 4;
    if (count) {
      height = Math.max(9, (count / max) * 70);
    } else if (checked) {
      cls += ' is-checkin';
      height = 8;
    } else {
      cls += ' is-empty';
    }
    if (i === 6) cls += ' current';

    return { key, cls, height, weekday: WEEK[date.getDay()] };
  });
})

function openDay(key) {
  core.openModal({ kind: 'day', key })
}

function useRest() {
  if (!authUser.value || !journalReady.value) { router.push('/auth'); return }
  if (restCard.value.disabled) return;

  data.restDays[core.viewDate] = 1;
  data.rests[monthOf(core.viewDate)] = restUsed() + 1;

  persist();
  core.refreshAll();
  toast('小憩已记下，今天不算断，照顾好自己 🌿');
}


function activatePage() {
  core.initialize()
  core.ensureViewDate()
  core.refreshAll()
  if (authUser.value) void refreshAccountData()
  statsActive.value = true
}

onActivated(activatePage)
onDeactivated(() => { statsActive.value = false })

const canLoadStats = computed(() => statsActive.value && !!authUser.value?.id
  && settingsReady.value && journalReady.value && !accountDataLoading.value)

watch(
  [canLoadStats, () => authUser.value?.id, journalRevision, settingsRevision],
  async ([ready], _previous, onCleanup) => {
    if (!ready) {
      serverStats.value = null
      return
    }

    const request = new AbortController()
    onCleanup(() => request.abort())
    try {
      const stats = await getJournalStats(request.signal)
      if (!request.signal.aborted) serverStats.value = stats
    } catch (error) {
      if (!request.signal.aborted) toast(error instanceof Error ? error.message : '读取统计失败')
    }
  },
)
</script>
<template>
  <section class="page active px-5 pt-3 pb-6" id="stats">
    <h1 class="stats-title my-1 text-[length:var(--font-title)] font-bold">看见你的坚持</h1>
    <div class="subline mb-[19px] text-[length:var(--font-body)] text-[var(--muted)]" id="statsSub">
      {{ cycle ? `第 ${currentDay} / ${journeyDays()} 天 · 已结算 ${elapsed} 天 · 打卡 ${cycleRecordDays()} 天` : '还没有设置目标周期，设置之后这里才开始统计' }}
    </div>

    <div class="card" id="restBox">
      <div class="setting-label">给自己一次喘息的机会</div>
      <div class="setting-hint">本月已休息 {{ restUsed() }} / {{ data.restLimit }} 次 · {{ restCard.hint }}</div>
      <button type="button" class="rest-btn" id="useRest" :disabled="restCard.disabled" @click="useRest">{{ restCard.label }}</button>
    </div>

    <div class="card">
        <div class="card-head flex items-center justify-between">
        <h3>打卡日历</h3>
        <small id="calendarRange">{{ cycle ? 'DAY 01 — ' + journeyDays() : '未设置周期' }}</small>
      </div>
      <div id="calendarMonths">
        <div v-if="!cycle" class="empty">设置目标周期后，这里会铺开你的打卡日历</div>
        <div v-for="month in calendar" :key="month.year + '-' + month.month" class="month-block">
          <div class="month-title">{{ month.year }}年{{ month.month }}月</div>
          <div class="week"><span v-for="weekday in WEEK" :key="weekday">{{ weekday }}</span></div>
          <div class="days">
            <span v-for="offset in month.offset" :key="offset"></span>
            <template v-for="cell in month.cells" :key="cell.key">
              <span
                v-if="cell.open" :class="cell.classes" role="button" tabindex="0"
                :aria-label="fmtDate(cell.key) + ' 的打卡明细'"
                @click="openDay(cell.key)" @keydown.enter.prevent="openDay(cell.key)" @keydown.space.prevent="openDay(cell.key)"
              >{{ cell.day }}</span>
              <span v-else :class="cell.classes">{{ cell.day }}</span>
            </template>
          </div>
        </div>
      </div>
      <div class="legend">
        <span><i></i>全部完成</span>
        <span><i class="sw-part"></i>已打卡未完成</span>
        <span><i class="sw-rest"></i>小憩日</span>
        <span>○ 今天</span>
      </div>
    </div>

    <div class="metrics grid grid-cols-2 gap-[10px]">
      <div class="metric">
        <label>累计完成</label>
        <strong id="totalChecks">{{ total }}<em>次</em></strong>
      </div>
      <div class="metric">
        <label>连续打卡</label>
        <strong id="streakCount">{{ streak }}<em>天</em></strong>
      </div>
      <div class="metric">
        <label>完成率</label>
        <strong id="completionRate">{{ rate }}<em>%</em></strong>
      </div>
      <div class="metric">
        <label>最常坚持</label>
        <strong class="metric-text" id="topHabit">{{ topHabit ? topHabit.icon + ' ' + topHabit.name : '—' }}</strong>
      </div>
    </div>

    <div class="card mt-[13px]">
      <div class="card-head flex items-center justify-between">
        <h3>近 7 天打卡趋势</h3>
        <small>完成习惯数</small>
      </div>
      <div class="bars" id="bars">
        <div v-for="bar in bars" :key="bar.key" class="bar-col">
          <div :class="bar.cls" :style="{ height: bar.height + 'px' }"></div>
          <span>{{ bar.weekday }}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head flex items-center justify-between">
        <h3>习惯完成排行</h3>
        <small>累计次数</small>
      </div>
      <div class="mt-2" id="ranking">
        <div v-if="!counts.length" class="empty">添加习惯后，这里会出现你的坚持排行</div>
        <div v-for="[habit, count] in counts" :key="habit.id" class="rank">
          <div class="rank-icon" :style="{ background: COLORS[habit.color % COLORS.length] }">{{ habit.icon }}</div>
          <div class="rank-text">{{ habit.name }}</div>
          <div class="rank-track"><i :style="{ width: (count / maxCount) * 100 + '%' }"></i></div>
          <b>{{ count }}</b>
        </div>
      </div>
    </div>
  </section>
</template>
