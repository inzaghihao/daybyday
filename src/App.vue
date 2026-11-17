<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { core } from './composables/dayByDayCore.js'
import { authUser, initializeAuth } from './stores/auth'
import { refreshAccountData } from './stores/journal'
import DayDetails from './components/DayDetails.vue'

const route = useRoute()
const router = useRouter()
const pageContent = ref<HTMLElement | null>(null)
let pageAnimation: Animation | undefined
const { modal } = core
const currentYear = computed(() => {
  core.revision.value
  return new Date().getFullYear()
})
watch(() => authUser.value?.id, () => {
  void refreshAccountData()
})

watch([() => route.path, () => authUser.value?.id], () => {
  if (['confirm', 'day', 'day-photo'].includes(modal.value?.kind)) core.closeModal()
})

watch(() => route.name, (_name, previousName) => {
  pageAnimation?.cancel()
  if (!previousName || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  pageAnimation = pageContent.value?.animate(
    [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: 180, easing: 'ease-out' },
  )
}, { flush: 'post' })

function navigateTo(path: string) {
  void router.replace(path)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') core.closeModal()
}

function handleVisibilityChange() {
  if (!document.hidden) core.actions.maybeLocalRemind?.()
}

function handleAvatarFileChange(event: Event) {
  core.actions.avatarFileChange?.(event)
}

function handlePhotoFileChange(event: Event) {
  core.actions.photoFileChange?.(event)
}

onMounted(() => {
  void initializeAuth()

  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  pageAnimation?.cancel()
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div :class="route.name === 'auth' ? 'min-h-[100dvh]' : 'app mx-auto min-h-[100dvh] w-full max-w-[460px] relative pb-24 bg-[var(--bg)] shadow-[0_0_80px_#000000cc]'">
    <header v-if="route.name !== 'auth'" class="topbar flex items-center justify-between px-[22px] pt-[22px] pb-[10px]">
      <div class="brand text-[length:var(--font-label)] font-bold tracking-[.18em]">
        DAY BY DAY <span class="text-[var(--green)]">✳</span>
      </div>
      <div class="date text-[length:var(--font-label)] text-[var(--muted)]" id="dateLabel">{{ currentYear }}</div>
    </header>

    <main ref="pageContent">
      <RouterView v-slot="{ Component }">
        <KeepAlive>
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </main>

    <nav v-if="route.name !== 'auth'" class="nav flex justify-around" aria-label="主导航">
      <button
        class="flex flex-col items-center gap-[3px] px-4 py-1"
        :class="{ active: route.path === '/home' }"
        :aria-current="route.path === '/home' ? 'page' : undefined"
        type="button"
        @click="navigateTo('/home')"
      >
        <b>⌂</b>打卡
      </button>
      <button
        class="flex flex-col items-center gap-[3px] px-4 py-1"
        :class="{ active: route.path === '/stats' }"
        :aria-current="route.path === '/stats' ? 'page' : undefined"
        type="button"
        @click="navigateTo('/stats')"
      >
        <b>▦</b>统计
      </button>
      <button
        class="flex flex-col items-center gap-[3px] px-4 py-1"
        :class="{ active: route.path === '/profile' }"
        :aria-current="route.path === '/profile' ? 'page' : undefined"
        type="button"
        @click="navigateTo('/profile')"
      >
        <b>◉</b>我的
      </button>
    </nav>
  </div>

  <div class="modal-bg" :class="{ show: modal }" id="modalBg" @click.self="core.closeModal()">
    <div class="modal" id="modal" role="dialog" aria-modal="true">
      <template v-if="modal?.kind === 'confirm'">
        <h3>{{ modal.title }}</h3>
        <p class="modal-desc">{{ modal.desc }}</p>
        <div class="modal-actions">
          <button type="button" @click="core.closeModal()">取消</button>
          <button type="button" class="danger" @click="core.confirmModal()">{{ modal.confirmText }}</button>
        </div>
      </template>
      <DayDetails v-else-if="modal?.kind === 'day' || modal?.kind === 'day-photo'" />
    </div>
  </div>
  <div class="toast" id="toast"></div>
  <input type="file" id="avatarFile" accept="image/*" hidden @change="handleAvatarFileChange">
  <input type="file" id="photoFile" accept="image/*" hidden @change="handlePhotoFileChange">
</template>
