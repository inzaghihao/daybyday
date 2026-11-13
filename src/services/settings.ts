import request from './request'

export interface AccountSettings {
  habits: Array<{ id: string; name: string; detail: string; icon: string; color: number; needPhoto: boolean }>
  start: string | null
  end: string | null
  restLimit: number
  reminder: { enabled: boolean; time: string }
  avatar: string
}

export const getSettings = () => request.get<AccountSettings | null>('/settings')
export const saveSettings = (settings: AccountSettings) => request.put<AccountSettings>('/settings', settings)
