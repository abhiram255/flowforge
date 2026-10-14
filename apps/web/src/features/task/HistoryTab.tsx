import { useInfiniteQuery } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { ActivityDTO, Paginated } from '@flowforge/shared'
import api from '@/lib/api'
import { ActivityFeed } from '@/components/common/ActivityFeed'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/feedback'
import { useWorkspace } from '@/hooks/useWorkspace'

export function HistoryTab({ taskId }: { taskId: string }): ReactElement {
  const workspace = useWorkspace()

  const query = useInfiniteQuery({
    queryKey: ['activity', { taskId }],
    queryFn: ({ pageParam }) =>
      api.get<Paginated<ActivityDTO>>(
        `/workspaces/${workspace.id}/activity?taskId=${taskId}&limit=20${
          pageParam ? `&cursor=${encodeURIComponent(pageParam as string)}` : ''
        }`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })

  if (query.isLoading) return <Spinner />

  const entries = (query.data?.pages ?? []).flatMap((page) => page.data)

  return (
    <div className="space-y-4">
      <ActivityFeed entries={entries} emptyLabel="No history for this task yet." />
      {query.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load older events'}
        </Button>
      ) : null}
    </div>
  )
}
