import { computed, ref } from 'vue'
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
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from '../services/authToken'

export const authUser = ref<AuthUser | null>(null)
export const authLoading = ref(false)
export const isAuthenticated = computed(() => authUser.value !== null)

let initialized = false

function applyAuthResponse(response: AuthResponse): void {
  saveTokens(response.accessToken, response.refreshToken)
  authUser.value = response.user
}

export async function initializeAuth(): Promise<void> {
  if (initialized) return
  initialized = true

  if (!getAccessToken() && !getRefreshToken()) return

  authLoading.value = true
  try {
    authUser.value = await getCurrentUser()
  } catch {
    clearTokens()
    authUser.value = null
  } finally {
    authLoading.value = false
  }
}

export async function registerAccount(input: RegisterInput): Promise<AuthUser> {
  const response = await registerRequest(input)
  applyAuthResponse(response)
  return response.user
}

export async function loginAccount(input: LoginInput): Promise<AuthUser> {
  const response = await loginRequest(input)
  applyAuthResponse(response)
  return response.user
}

export async function updateAccount(username: string): Promise<AuthUser> {
  const user = await updateCurrentUserRequest(username)
  authUser.value = user
  return user
}

export async function logoutAccount(): Promise<void> {
  const refreshToken = getRefreshToken()
  try {
    if (refreshToken) await logoutRequest(refreshToken)
  } finally {
    clearTokens()
    authUser.value = null
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('auth:expired', () => {
    clearTokens()
    authUser.value = null
  })
}
