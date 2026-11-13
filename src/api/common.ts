import request from '@/services/request'

export function getHello(): Promise<string> {
  return request.get<string>('/')
}
