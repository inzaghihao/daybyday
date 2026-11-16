let accessToken = ''

export function getAccessToken(): string {
  return accessToken
}

export function setAccessToken(token: string): void {
  accessToken = token
}

export function clearLegacyTokens(): void {
  try {
    window.sessionStorage.removeItem('100day.access-token')
    window.sessionStorage.removeItem('100day.refresh-token')
  } catch {
    // Browser storage may be disabled.
  }
}
