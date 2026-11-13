import request from './request'

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export function imageDisplayUrl(path: string): string {
  return path.startsWith('/images/') ? `${apiBase}${path}` : path
}

export async function uploadImage(blob: Blob): Promise<string> {
  const form = new FormData()
  form.append('file', blob, 'checkin.jpg')
  const result = await request.post<{ path: string }, FormData>('/images', form)
  return result.path
}
