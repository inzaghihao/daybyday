const ACCESS_TOKEN_KEY = '100day.access-token'
const REFRESH_TOKEN_KEY = '100day.refresh-token'

function getStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage
}

export function getAccessToken(): string {
  return getStorage()?.getItem(ACCESS_TOKEN_KEY) ?? ''
}

export function getRefreshToken(): string {
  return getStorage()?.getItem(REFRESH_TOKEN_KEY) ?? ''
}

export function saveTokens(accessToken: string, refreshToken: string): void {
  const storage = getStorage()
  storage?.setItem(ACCESS_TOKEN_KEY, accessToken)
  storage?.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens(): void {
  const storage = getStorage()
  storage?.removeItem(ACCESS_TOKEN_KEY)
  storage?.removeItem(REFRESH_TOKEN_KEY)
}
