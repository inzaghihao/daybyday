import request from './request'

export interface Journal {
  records: Record<string, string[]>
  checkins: Record<string, 1>
  restDays: Record<string, 1>
  photos: Record<string, string>
}

export interface JournalStats {
  journal: Journal
  totalChecks: number
  checkedDays: number
  habitCounts: Record<string, number>
  streakCount: number
  completionRate: number
}

export const getJournal = () => request.get<Journal>('/journal')
export const saveJournal = (journal: Journal) => request.put<{ saved: true }>('/journal', journal)
export const getJournalStats = (signal?: AbortSignal) => request.get<JournalStats>('/journal/stats', {
  signal,
  params: { timezoneOffset: new Date().getTimezoneOffset() },
})
