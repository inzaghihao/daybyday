<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { core } from '../composables/dayByDayCore.js'

const route = useRoute()
const router = useRouter()
const {
  COLORS, data, revision, modal, recordsOf, photoOf, fmtDate,
  isDayComplete, isRestDay, lastSettleableKey, openModal, closeModal,
} = core

const key = computed(() => modal.value.key)
const groups = computed(() => {
  const done = recordsOf(key.value)
  const habits = data.habits.map(habit => ({
    ...habit,
    finished: done.includes(habit.id),
    shot: photoOf(key.value, habit.id),
  }))
  return [
    { done: true, label: '已打卡', habits: habits.filter(habit => habit.finished) },
    { done: false, label: '未打卡', habits: habits.filter(habit => !habit.finished) },
  ]
})
const completed = computed(() => groups.value[0].habits.length)
const canEdit = computed(() => {
  revision.value
  const latest = lastSettleableKey()
  return latest && key.value >= data.start && key.value <= latest
})

function showPhoto(habit) {
  openModal({ kind: 'day-photo', key: key.value, name: habit.name, src: habit.shot })
}

function returnToDay() {
  openModal({ kind: 'day', key: key.value })
}

function editDay() {
  const day = key.value
  closeModal()
  void router.push({
    path: '/home',
    query: { ...(route.path === '/home' ? route.query : {}), editDay: day },
  })
}
</script>

<template>
  <template v-if="modal.kind === 'day'">
    <div class="check-head">
      <h3>{{ fmtDate(key) }}</h3>
      <span class="check-count">{{ completed }} / {{ data.habits.length }}</span>
    </div>
    <p class="modal-desc">{{ isRestDay(key) ? '这天请了假 · ' : '' }}已打卡 · {{ isDayComplete(key) ? '全部完成 ✨' : completed ? '完成 ' + completed + ' / ' + data.habits.length : '一项都没完成' }}</p>
    <template v-for="group in groups" :key="group.label">
      <div v-if="group.done || group.habits.length" class="day-group">
        <div class="day-group-title"><i :class="{ miss: !group.done }"></i>{{ group.label }} <b>{{ group.habits.length }}</b></div>
        <div v-if="!group.habits.length" class="day-empty">这天只打了卡，一项都没有完成</div>
        <component
          :is="habit.shot ? 'button' : 'div'"
          v-for="habit in group.habits"
          :key="habit.id"
          :type="habit.shot ? 'button' : undefined"
          class="check-row is-static"
          :class="{ done: group.done, miss: !group.done, 'is-photo': habit.shot }"
          :aria-label="habit.shot ? '查看' + habit.name + '的打卡照片' : undefined"
          @click="habit.shot && showPhoto(habit)"
        >
          <span class="check-row-icon" :style="{ background: COLORS[habit.color % COLORS.length] }">{{ habit.icon }}</span>
          <span class="check-row-name">
            <b>{{ habit.name }}</b>
            <small v-if="habit.needPhoto">{{ habit.shot ? (group.done ? '照片已上传' : '照片已上传 · 未计入') : (group.done ? '缺照片' : '需上传照片') }}</small>
          </span>
          <template v-if="habit.needPhoto">
            <img v-if="habit.shot" class="check-thumb" :src="habit.shot" alt="">
            <span v-else class="check-need">📷</span>
          </template>
          <span class="check-row-mark">{{ group.done ? '✓' : '' }}</span>
        </component>
      </div>
    </template>
    <div class="modal-actions">
      <button type="button" id="dayClose" @click="closeModal">关闭</button>
      <button v-if="canEdit" type="button" class="save" id="dayEdit" @click="editDay">修改这天的打卡</button>
    </div>
  </template>

  <template v-else>
    <h3>{{ modal.name }}</h3>
    <p class="modal-desc">{{ fmtDate(key) }} · 打卡照片</p>
    <div class="photo-frame"><img :src="modal.src" :alt="modal.name + '的打卡照片'"></div>
    <div class="modal-actions">
      <button type="button" @click="returnToDay">返回当天明细</button>
    </div>
  </template>
</template>

<style scoped>
button.check-row { color: inherit; }
button.check-row.miss { color: var(--muted); }
</style>
