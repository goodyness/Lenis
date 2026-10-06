import { apiClient } from '../lib/api'

export interface AppNotification {
  id: string
  user_id: string
  type: string
  title: string
  message: string
  link?: string | null
  is_read: boolean
  created_at: string
}

export interface NotificationListResponse {
  items: AppNotification[]
  total: number
  unread_count: number
  page: number
  limit: number
}

export async function fetchNotifications(
  page: number = 1,
  limit: number = 20,
  unreadOnly: boolean = false
): Promise<NotificationListResponse> {
  const params: Record<string, string | number | boolean> = { page, limit }
  if (unreadOnly) {
    params.unread_only = true
  }
  const res = await apiClient.get<NotificationListResponse>('/notifications', { params })
  return res.data
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await apiClient.get<{ unread_count: number }>('/notifications/unread-count')
  return res.data.unread_count
}

export async function markNotificationAsRead(notificationId: string): Promise<boolean> {
  const res = await apiClient.patch<{ success: boolean }>(`/notifications/${notificationId}/read`)
  return res.data.success
}

export async function markAllNotificationsAsRead(): Promise<boolean> {
  const res = await apiClient.post<{ success: boolean; updated_count: number }>('/notifications/mark-all-read')
  return res.data.success
}

export async function deleteNotification(notificationId: string): Promise<boolean> {
  const res = await apiClient.delete<{ success: boolean }>(`/notifications/${notificationId}`)
  return res.data.success
}
