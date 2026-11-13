import axios, { type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from './authToken'
import type { AuthTokens } from './auth'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10_000,
  headers: {
    Accept: 'application/json',
  },
})

let refreshRequest: Promise<string> | null = null

client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

async function refreshAccessToken(): Promise<string> {
  if (refreshRequest) return refreshRequest

  const refreshToken = getRefreshToken()
  if (!refreshToken) throw new Error('登录状态已失效，请重新登录')

  refreshRequest = client
    .post<AuthTokens>('/auth/refresh', { refreshToken })
    .then(({ data }) => {
      saveTokens(data.accessToken, data.refreshToken)
      return data.accessToken
    })
    .catch(error => {
      clearTokens()
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('auth:expired'))
      throw error
    })
    .finally(() => {
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
    if (axios.isAxiosError(error) && error.response?.status === 401 && error.config) {
      const config = error.config as InternalAxiosRequestConfig & { authRetry?: boolean }
      const isAuthRoute = config.url?.includes('/auth/login')
        || config.url?.includes('/auth/register')
        || config.url?.includes('/auth/refresh')
      if (!isAuthRoute && !config.authRetry && getRefreshToken()) {
        config.authRetry = true
        try {
          const token = await refreshAccessToken()
          config.headers.Authorization = `Bearer ${token}`
          return client.request(config)
        } catch (refreshError) {
          return Promise.reject(new Error(getErrorMessage(refreshError)))
        }
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

export default request
