import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import type { NotificationDTO, Paginated } from '@flowforge/shared'
import api from '@/lib/api'
import { qk } from '@/lib/query'
import { formatRelative } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function NotificationsMenu(): ReactElement {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const notificationsQuery = useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.get<Paginated<NotificationDTO>>('/notifications?limit=12'),
  })
  const unreadQuery = useQuery({
    queryKey: qk.notificationsUnread,
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
  })

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications })
      void queryClient.invalidateQueries({ queryKey: qk.notificationsUnread })
    },
  })

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications })
      void queryClient.invalidateQueries({ queryKey: qk.notificationsUnread })
    },
  })

  const unread = unreadQuery.data?.count ?? 0
  const items = notificationsQuery.data?.data ?? []

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 ? (
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            You are all caught up.
          </p>
        ) : (
          items.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              className="flex-col items-start gap-0.5 py-2"
              onSelect={() => {
                if (!notification.readAt) markRead.mutate(notification.id)
                if (notification.link) navigate(notification.link)
              }}
            >
              <span className="flex w-full items-start gap-2">
                {!notification.readAt ? (
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                ) : (
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{notification.title}</span>
                  {notification.body ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {notification.body}
                    </span>
                  ) : null}
                  <span className="block text-[11px] text-muted-foreground">
                    {formatRelative(notification.createdAt)}
                  </span>
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
