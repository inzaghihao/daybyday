<script setup lang="ts">
defineProps<{
  celebration: { id: number; day: string; completed: number; target: number } | null
}>()

const colors = ['#d6ef7c', '#8ec272', '#a9e7da', '#f7c78e']
const confetti = Array.from({ length: 20 }, (_, index) => ({
  '--angle': `${index * 18}deg`,
  '--distance': `${48 + (index % 5) * 9}px`,
  '--delay': `${(index % 4) * 35}ms`,
  '--color': colors[index % colors.length],
}))
</script>

<template>
  <Teleport to="body">
    <div class="celebration" role="status" aria-atomic="true">
      <div v-if="celebration" :key="celebration.id" class="celebration-card">
        <div class="celebration-mark" aria-hidden="true">
          <span v-for="(particle, index) in confetti" :key="index" class="confetti" :style="particle"></span>
          <span class="celebration-ring"></span>
          <span class="celebration-ring celebration-ring-outer"></span>
          <span class="celebration-stamp">✓</span>
        </div>
        <div class="celebration-copy">
          <strong>{{ celebration.completed === celebration.target ? '全项达成！' : '打卡成功！' }}</strong>
          <span>{{ celebration.day }} · {{ celebration.completed }} / {{ celebration.target }} 项完成</span>
          <small>{{ celebration.completed ? '又为想要的生活迈了一步。' : '愿意回来记一笔，也是一种坚持。' }}</small>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.celebration {
  position: fixed;
  z-index: 30;
  inset: calc(env(safe-area-inset-top) + 20px) 16px auto;
  display: grid;
  justify-items: center;
  pointer-events: none;
}

.celebration-card {
  display: flex;
  align-items: center;
  gap: 18px;
  width: min(100%, 360px);
  min-height: 104px;
  padding: 14px 18px;
  border: 1px solid #75994d;
  border-radius: 24px;
  background: radial-gradient(ellipse at 0 100%, #3a532e, transparent 74%), #17231d;
  box-shadow: 0 18px 44px #0009, 0 0 30px #aedd8e26;
  animation: celebration-arrive .55s cubic-bezier(.2, .85, .25, 1.2) both;
}

.celebration-mark {
  position: relative;
  display: grid;
  flex: 0 0 68px;
  place-items: center;
  height: 68px;
}

.celebration-stamp {
  z-index: 1;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 20%, #f3ffbb, var(--lime) 52%, var(--green));
  color: #21331a;
  font-size: 29px;
  font-weight: 800;
  box-shadow: 0 0 22px #d6ef7c5c, inset 0 0 0 2px #ffffff65;
  animation: celebration-stamp .65s cubic-bezier(.2, .85, .25, 1.35) both;
}

.celebration-ring {
  position: absolute;
  inset: 4px;
  border: 1px solid #d6ef7cbd;
  border-radius: 50%;
  animation: celebration-ring .85s ease-out both;
}

.celebration-ring-outer {
  inset: 0;
  border-style: dashed;
  animation-delay: .11s;
}

.confetti {
  position: absolute;
  top: calc(50% - 3px);
  left: calc(50% - 3px);
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: var(--color);
  animation: celebration-burst 1s var(--delay) cubic-bezier(.17, .75, .31, 1) both;
}

.confetti:nth-child(3n) {
  border-radius: 50%;
  width: 4px;
  height: 4px;
}

.celebration-copy {
  z-index: 1;
  display: grid;
  gap: 3px;
  color: #e7f3db;
  font-size: var(--font-label);
}

.celebration-copy strong {
  color: var(--lime);
  font-size: 23px;
  line-height: 1.2;
}

.celebration-copy small {
  color: #b6c8ac;
  font-size: var(--font-body);
}

@keyframes celebration-arrive {
  from { opacity: 0; transform: translateY(-14px) scale(.94); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes celebration-stamp {
  from { transform: scale(.5) rotate(-32deg); }
  to { transform: scale(1) rotate(0); }
}

@keyframes celebration-ring {
  from { opacity: .9; transform: scale(.65); }
  to { opacity: .25; transform: scale(1); }
}

@keyframes celebration-burst {
  from { opacity: 1; transform: rotate(var(--angle)) translateY(-18px) rotate(0); }
  to { opacity: 0; transform: rotate(var(--angle)) translateY(calc(-1 * var(--distance))) rotate(165deg); }
}

@media (prefers-reduced-motion: reduce) {
  .celebration-card, .celebration-ring, .celebration-stamp { animation: none; }
  .confetti { display: none; }
}
</style>
