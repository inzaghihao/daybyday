import request from './request'

export interface AuthUser {
  id: string
  username: string
  email: string | null
  avatarUrl: string | null
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface AuthResponse extends AuthTokens {
  user: AuthUser
}

export interface RegisterInput {
  username: string
  email: string | null
  encryptedPassword: string
}

export interface LoginInput {
  username: string
  encryptedPassword: string
}

export async function encryptPassword(password: string): Promise<string> {
  const { publicKey } = await request.get<{ publicKey: string }>('/auth/password-key')
  const pem = publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
  const bytes = Uint8Array.from(atob(pem), char => char.charCodeAt(0))
  const key = await crypto.subtle.importKey('spki', bytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(password)))
  return btoa(String.fromCharCode(...encrypted))
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return request.post<AuthResponse>('/auth/register', input)
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return request.post<AuthResponse>('/auth/login', input)
}

export function getCurrentUser(): Promise<AuthUser> {
  return request.get<AuthUser>('/auth/me')
}

export function updateCurrentUser(username: string): Promise<AuthUser> {
  return request.patch<AuthUser>('/auth/me', { username })
}

export function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  return request.post<AuthTokens>('/auth/refresh', { refreshToken })
}

export function logout(refreshToken: string): Promise<void> {
  return request.post<void>('/auth/logout', { refreshToken })
}
