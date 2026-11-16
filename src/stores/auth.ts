import { computed, ref } from 'vue'
import axios from 'axios'
import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  updateCurrentUser as updateCurrentUserRequest,
  type AuthResponse,
  type AuthUser,
  type LoginInput,
  type RegisterInput,
} from '../services/auth'
import { clearLegacyTokens, getAccessToken, setAccessToken } from '../services/authToken'
import { refreshAccessToken, withSessionLock } from '../services/request'

export const authUser = ref<AuthUser | null>(null)
export const authLoading = ref(false)
export const isAuthenticated = computed(() => authUser.value !== null)

let initialization: Promise<void> | undefined
const sessionEvents = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('100day.auth-session')
  : undefined

function clearAuth(): void {
  setAccessToken('')
  authUser.value = null
}

function applyAuthResponse(response: AuthResponse): void {
  setAccessToken(response.accessToken)
  authUser.value = response.user
  sessionEvents?.postMessage('login')
}

export function initializeAuth(): Promise<void> {
  if (initialization) return initialization
  clearLegacyTokens()
  authLoading.value = true

  initialization = restoreSession()
  return initialization
}

async function restoreSession(): Promise<void> {
  try {
    const token = getAccessToken() || await refreshAccessToken()
    const user = await getCurrentUser()
    if (getAccessToken() === token) authUser.value = user
  } catch (error) {
    // Let an online event or a page reload retry transient failures.
    if (!axios.isAxiosError(error) || error.response?.status !== 401) initialization = undefined
  } finally {
    authLoading.value = false
  }
}

export async function registerAccount(input: RegisterInput): Promise<AuthUser> {
  await initialization
  return withSessionLock(async () => {
    const response = await registerRequest(input)
    applyAuthResponse(response)
    return response.user
  })
}

export async function loginAccount(input: LoginInput): Promise<AuthUser> {
  await initialization
  return withSessionLock(async () => {
    const response = await loginRequest(input)
    applyAuthResponse(response)
    return response.user
  })
}

export async function updateAccount(username: string): Promise<AuthUser> {
  const previousUser = authUser.value
  const user = await updateCurrentUserRequest(username)
  if (authUser.value === previousUser) authUser.value = user
  return user
}

export async function logoutAccount(): Promise<void> {
  await withSessionLock(async () => {
    await logoutRequest()
    clearAuth()
    sessionEvents?.postMessage('logout')
  })
}

if (typeof window !== 'undefined') {
  window.addEventListener('auth:expired', clearAuth)
  window.addEventListener('online', () => {
    void initializeAuth()
  })
}

sessionEvents?.addEventListener('message', async ({ data }) => {
  // Wait for any in-flight refresh to finish before discarding its access token.
  await withSessionLock(async () => clearAuth())
  await initialization
  if (data === 'login') {
    initialization = undefined
    void initializeAuth()
  }
})
