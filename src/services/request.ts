import axios, { type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { getAccessToken, setAccessToken } from './authToken'
import type { AuthTokens } from './auth'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10_000,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
  },
})

let refreshRequest: Promise<string> | null = null
let sessionQueue: Promise<unknown> = Promise.resolve()

const sessionRequestConfig = { headers: { 'X-Auth-Session': '1' } }
type AuthRequestConfig = InternalAxiosRequestConfig & { authRetry?: boolean }

export function withSessionLock<T>(action: () => Promise<T>): Promise<T> {
  // The cookie is shared across tabs, and each refresh token can only be used once.
  const result = sessionQueue.then(() =>
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('100day.auth-session', action)
      : action(),
  )
  sessionQueue = result.catch(() => {})
  return result
}

client.interceptors.request.use((config: AuthRequestConfig) => {
  const token = getAccessToken()
  if (token && !config.authRetry && !config.headers.has('X-Auth-Session')) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

function expireAuth(): void {
  setAccessToken('')
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('auth:expired'))
}

function tokenSubject(token: string): string | undefined {
  const payload = token.split('.')[1]
  if (!payload) return
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).sub
  } catch {
    return undefined
  }
}

export function refreshAccessToken(expiredToken = ''): Promise<string> {
  if (refreshRequest) return refreshRequest

  refreshRequest = withSessionLock(async () => {
    const currentToken = getAccessToken()
    if (expiredToken !== currentToken) {
      if (currentToken && tokenSubject(currentToken) === tokenSubject(expiredToken)) return currentToken
      throw new Error('登录状态已变更，请重试')
    }

    let data: AuthTokens
    try {
      ({ data } = await client.post<AuthTokens>('/auth/refresh', undefined, sessionRequestConfig))
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) expireAuth()
      throw error
    }
    // Another tab may have signed in to a different account since this request was sent.
    if (expiredToken && tokenSubject(data.accessToken) !== tokenSubject(expiredToken)) {
      expireAuth()
      throw new Error('登录账号已变更，请刷新页面')
    }
    setAccessToken(data.accessToken)
    return data.accessToken
  }).finally(() => {
    refreshRequest = null
  })

  return refreshRequest
}

function getErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : '请求失败，请稍后重试'
  }

  const bodyMessage = (error.response?.data as { message?: unknown } | undefined)?.message
  if (Array.isArray(bodyMessage)) return bodyMessage.join('；')
  if (typeof bodyMessage === 'string') return bodyMessage
  if (error.response) return `请求失败（${error.response.status}）`
  if (error.code === 'ECONNABORTED') return '请求超时'
  return '无法连接服务器，请确认 Nest 后端已启动'
}

client.interceptors.response.use(
  response => response,
  async (error: unknown) => {
    if (axios.isAxiosError(error) && error.config?.headers.has('X-Auth-Session')) {
      return Promise.reject(error)
    }

    if (axios.isAxiosError(error) && error.response?.status === 401 && error.config) {
      const config = error.config as AuthRequestConfig
      const authorization = config.headers.get('Authorization')
      const sentToken = typeof authorization === 'string' ? authorization.slice('Bearer '.length) : ''
      if (!config.authRetry && sentToken) {
        config.authRetry = true
        try {
          const token = await refreshAccessToken(sentToken)
          if (token !== getAccessToken() || tokenSubject(token) !== tokenSubject(sentToken)) {
            throw new Error('登录状态已变更，请重试')
          }
          config.headers.Authorization = `Bearer ${token}`
          return client.request(config)
        } catch (refreshError) {
          return Promise.reject(new Error(getErrorMessage(refreshError)))
        }
      } else if (config.authRetry && sentToken === getAccessToken()) {
        expireAuth()
      }
    }

    return Promise.reject(new Error(getErrorMessage(error)))
  },
)

function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return client.get<T>(url, config).then((response: AxiosResponse<T>) => response.data)
}

function post<T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig): Promise<T> {
  return client.post<T>(url, data, config).then((response: AxiosResponse<T>) => response.data)
}

function put<T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig): Promise<T> {
  return client.put<T>(url, data, config).then((response: AxiosResponse<T>) => response.data)
}

function patch<T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig): Promise<T> {
  return client.patch<T>(url, data, config).then((response: AxiosResponse<T>) => response.data)
}

function remove<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return client.delete<T>(url, config).then((response: AxiosResponse<T>) => response.data)
}

const request = { get, post, put, patch, delete: remove }

export function postSession<T>(url: string, data?: unknown): Promise<T> {
  return post<T>(url, data, sessionRequestConfig).catch(error => {
    throw new Error(getErrorMessage(error))
  })
}

export default request
