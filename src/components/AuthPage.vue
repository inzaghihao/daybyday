<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loginAccount, registerAccount } from '../stores/auth'
import { encryptPassword } from '../services/auth'

type AuthMode = 'login' | 'register'

const route = useRoute()
const router = useRouter()
const mode = ref<AuthMode>('login')
const username = ref('')
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const recoveryMessage = ref('')
const authModes = [
  { value: 'login', label: '登录' },
  { value: 'register', label: '注册' },
] as const

const redirectPath = typeof route.query.redirect === 'string'
  && route.query.redirect.startsWith('/')
  && !route.query.redirect.startsWith('//')
  ? route.query.redirect
  : '/profile'

function setMode(nextMode: AuthMode) {
  if (busy.value || mode.value === nextMode) return
  mode.value = nextMode
  showPassword.value = false
  errorMessage.value = ''
  recoveryMessage.value = ''
}

async function submitAuth() {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  recoveryMessage.value = ''

  try {
    const encryptedPassword = await encryptPassword(password.value)
    if (mode.value === 'register') {
      await registerAccount({
        username: username.value.trim(),
        email: email.value.trim() || null,
        encryptedPassword,
      })
    } else {
      await loginAccount({ username: username.value.trim(), encryptedPassword })
    }
    await router.replace(redirectPath)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '操作失败，请稍后重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="auth" aria-labelledby="auth-title">
    <div class="auth-shell">
      <RouterLink class="auth-back" to="/profile" replace>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="m11 6-6 6 6 6M5 12h14" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        返回我的
      </RouterLink>

      <div class="auth-layout">
        <aside class="auth-intro">
          <div class="auth-brand"><span aria-hidden="true">✳</span> DAY BY DAY</div>
          <div class="auth-art" aria-hidden="true">
            <svg viewBox="0 0 360 190" fill="none">
              <path d="M0 156H360M0 110H360M0 64H360M46 0V190M113 0V190M180 0V190M247 0V190M314 0V190" stroke="#d6ef7c" stroke-opacity=".12" />
              <path d="M20 153H65Q82 153 91 139L103 121Q112 107 129 107H160Q177 107 186 93L198 75Q207 61 224 61H255Q272 61 281 47L293 29Q302 15 319 15H337" stroke="#d6ef7c" stroke-opacity=".3" stroke-width="2" stroke-dasharray="4 6" />
              <g fill="#d6ef7c">
                <circle cx="46" cy="153" r="5" fill-opacity=".55" />
                <circle cx="141" cy="107" r="6" fill-opacity=".72" />
                <circle cx="236" cy="61" r="7" fill-opacity=".9" />
                <circle cx="331" cy="15" r="9" />
              </g>
              <circle cx="331" cy="15" r="14" stroke="#d6ef7c" stroke-opacity=".45" />
            </svg>
          </div>
          <div class="auth-intro-copy">
            <p>把好习惯，<br class="auth-desktop-break">过成日常。</p>
            <span>从一次打卡开始，记录每一点进步。</span>
          </div>
        </aside>

        <div class="auth-card">
          <header class="auth-heading">
            <h1 id="auth-title">{{ mode === 'login' ? '欢迎回来' : '创建账号' }}</h1>
            <p>{{ mode === 'login' ? '登录账号，继续你的习惯打卡。' : '开启你的习惯打卡之旅。' }}</p>
          </header>

          <div class="auth-modes" role="group" aria-label="账号操作">
            <button
              v-for="option in authModes"
              :key="option.value"
              type="button"
              :aria-pressed="mode === option.value"
              :disabled="busy"
              @click="setMode(option.value)"
            >
              {{ option.label }}
            </button>
          </div>

          <form class="auth-form" :aria-busy="busy" @submit.prevent="submitAuth">
            <div class="auth-field">
              <label for="auth-username">用户名</label>
              <input
                id="auth-username"
                v-model="username"
                name="username"
                type="text"
                :maxlength="mode === 'register' ? 24 : 320"
                autocomplete="username"
                autocapitalize="none"
                placeholder="输入用户名"
                :readonly="busy"
                required
              >
            </div>

            <div v-if="mode === 'register'" class="auth-field">
              <label for="auth-email">邮箱 <span>选填</span></label>
              <input
                id="auth-email"
                v-model="email"
                name="email"
                type="email"
                autocomplete="email"
                placeholder="name@example.com"
                :readonly="busy"
              >
            </div>

            <div class="auth-field">
              <div class="auth-field-head">
                <label for="auth-password">密码</label>
                <button v-if="mode === 'login'" type="button" class="auth-text-button" :disabled="busy" @click="recoveryMessage = '找回密码功能即将开放'">
                  找回密码
                </button>
              </div>
              <div class="auth-password">
                <input
                  id="auth-password"
                  v-model="password"
                  name="password"
                  :type="showPassword ? 'text' : 'password'"
                  :minlength="mode === 'register' ? 6 : 1"
                  :maxlength="mode === 'register' ? 72 : 128"
                  :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
                  :placeholder="mode === 'register' ? '输入 6–72 个字符' : '输入密码'"
                  :readonly="busy"
                  required
                >
                <button type="button" class="auth-visibility" aria-controls="auth-password" @click="showPassword = !showPassword">
                  {{ showPassword ? '隐藏' : '显示' }}<span class="sr-only">密码</span>
                </button>
              </div>
            </div>

            <p v-if="errorMessage" class="auth-message auth-error" role="alert">{{ errorMessage }}</p>
            <p v-if="recoveryMessage" class="auth-message" role="status">{{ recoveryMessage }}</p>

            <button class="auth-submit" type="submit" :disabled="busy">
              {{ busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
              <svg v-if="!busy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M5 12h14m-6-6 6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.auth {
  min-height: 100dvh;
  padding: max(24px, env(safe-area-inset-top)) 24px max(32px, env(safe-area-inset-bottom));
  display: grid;
  align-items: center;
  color-scheme: dark;
  background: radial-gradient(ellipse at 18% 0%, #23332a, transparent 58%), var(--bg);
}

.auth-shell {
  width: min(100%, 920px);
  margin-inline: auto;
}

.auth-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  margin-bottom: 16px;
  padding: 0 13px;
  border: 1px solid #3a483c;
  border-radius: 999px;
  color: #c4cfc1;
  background: #171e19;
  font-size: var(--font-label);
  text-decoration: none;
}

.auth-back:hover { color: var(--lime); }
.auth-back svg, .auth-submit svg { width: 18px; height: 18px; }

.auth-layout {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  overflow: hidden;
  border: 1px solid #354138;
  border-radius: 28px;
  box-shadow: 0 24px 72px #0006;
}

.auth-intro {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 28px;
  min-width: 0;
  padding: clamp(28px, 4vw, 48px);
  background: radial-gradient(ellipse at 100% 0%, #445a35, transparent 72%), linear-gradient(155deg, #2b4332, #1b2e25);
}

.auth-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--lime);
  font-size: var(--font-caption);
  font-weight: 700;
  letter-spacing: .2em;
}

.auth-brand span {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid #d6ef7c55;
  border-radius: 11px;
  background: #d6ef7c16;
  font-size: 22px;
  letter-spacing: 0;
}

.auth-art { min-width: 0; }
.auth-art svg { display: block; width: 100%; }

.auth-intro-copy p {
  margin: 0 0 10px;
  color: #f0f5e9;
  font-size: clamp(26px, 4.6vw, 46px);
  font-weight: 800;
  line-height: 1.25;
}

.auth-intro-copy span {
  color: #c3d2bb;
  font-size: var(--font-body);
  line-height: 1.6;
}

.auth-card {
  min-width: 0;
  padding: clamp(28px, 4vw, 48px);
  background: var(--paper);
}

.auth-heading h1 {
  margin: 0;
  font-size: var(--font-title);
  line-height: 1.25;
}

.auth-heading p {
  margin: 9px 0 0;
  color: #a8b3a6;
  font-size: var(--font-body);
  line-height: 1.6;
}

.auth-modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin: 24px 0;
  padding: 4px;
  border: 1px solid #343e35;
  border-radius: 14px;
  background: #101512;
}

.auth-modes button {
  min-height: 40px;
  border-radius: 10px;
  background: transparent;
  color: #a8b3a6;
  font-size: var(--font-body);
  font-weight: 600;
}

.auth-modes button:hover { color: var(--lime); }
.auth-modes button[aria-pressed='true'] {
  background: #2c4030;
  color: var(--lime);
  box-shadow: inset 0 0 0 1px #476048;
}

.auth-form, .auth-field { display: grid; }
.auth-form { gap: 16px; }
.auth-field { gap: 8px; }

.auth-field label {
  color: #dce4d8;
  font-size: var(--font-label);
  font-weight: 600;
}

.auth-field label span {
  margin-left: 4px;
  color: #a8b3a6;
  font-size: var(--font-caption);
  font-weight: 400;
}

.auth-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.auth-text-button, .auth-visibility {
  padding: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--green-soft);
  font-size: var(--font-label);
}

.auth-text-button:hover, .auth-visibility:hover { text-decoration: underline; }

.auth-field input {
  width: 100%;
  min-width: 0;
  min-height: 50px;
  padding: 12px 14px;
  border: 1px solid #3c483e;
  border-radius: 12px;
  background: #101512;
  color: var(--ink);
  font-size: var(--font-input);
}

.auth-field input::placeholder { color: #899587; }
.auth-field input:focus {
  border-color: var(--green);
  outline: none;
  box-shadow: 0 0 0 3px #8ec27230;
}

.auth-password { position: relative; }
.auth-password input { padding-right: 62px; }
.auth-visibility {
  position: absolute;
  inset: 3px 4px 3px auto;
  min-width: 48px;
}

.auth-message {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #24352a;
  color: #d3e6c6;
  font-size: var(--font-label);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.auth-error { background: #392422; color: #f6bbb0; }

.auth-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 50px;
  margin-top: 4px;
  border-radius: 12px;
  background: var(--lime);
  color: #1a2711;
  font-size: var(--font-action);
  font-weight: 700;
}

.auth-submit:hover:enabled { background: #e2f6a5; }
.auth button:disabled { cursor: not-allowed; }
.auth-submit:disabled { opacity: .65; }

@media (max-width: 680px) {
  .auth { align-items: start; padding-inline: 16px; }
  .auth-shell { max-width: 460px; }
  .auth-back { margin-bottom: 12px; }
  .auth-layout { grid-template-columns: minmax(0, 1fr); border-radius: 22px; }
  .auth-intro { position: relative; overflow: hidden; gap: 16px; padding: 22px; }
  .auth-art { position: absolute; right: -56px; bottom: -28px; width: 210px; opacity: .3; }
  .auth-brand, .auth-intro-copy { position: relative; z-index: 1; }
  .auth-desktop-break { display: none; }
  .auth-intro-copy p { margin-bottom: 6px; }
  .auth-intro-copy span { font-size: var(--font-label); }
  .auth-card { padding: 24px 22px; }
  .auth-modes { margin-block: 18px; }
}
</style>
