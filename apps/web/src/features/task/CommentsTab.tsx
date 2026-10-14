import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Trash2, Pencil } from 'lucide-react'
import { useState, type FormEvent, type ReactElement } from 'react'
import type { CommentDTO, Paginated } from '@flowforge/shared'
import api, { ApiError } from '@/lib/api'
import { qk } from '@/lib/query'
import { cn, formatRelative } from '@/lib/utils'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/feedback'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStore } from '@/stores/auth'

export function CommentsTab({ taskId }: { taskId: string }): ReactElement {
  const user = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  const query = useInfiniteQuery({
    queryKey: qk.comments(taskId),
    queryFn: ({ pageParam }) =>
      api.get<Paginated<CommentDTO>>(
        `/tasks/${taskId}/comments?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam as string)}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: qk.comments(taskId) })
    void queryClient.invalidateQueries({ queryKey: qk.task(taskId) })
  }

  const create = useMutation({
    mutationFn: (content: string) => api.post(`/tasks/${taskId}/comments`, { content }),
    onSuccess: () => {
      setDraft('')
      invalidate()
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not post the comment'),
  })

  const update = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.patch(`/comments/${id}`, { content }),
    onSuccess: () => {
      setEditingId(null)
      invalidate()
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not edit the comment'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/comments/${id}`),
    onSuccess: invalidate,
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not delete the comment'),
  })

  const comments = (query.data?.pages ?? []).flatMap((page) => page.data)

  function onSubmit(event: FormEvent): void {
    event.preventDefault()
    const content = draft.trim()
    if (!content) return
    create.mutate(content)
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="space-y-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a comment… use @ to mention teammates in the text"
          className="min-h-[70px]"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={create.isPending || draft.trim().length === 0}>
            <Send /> Comment
          </Button>
        </div>
      </form>

      {query.isLoading ? <Spinner /> : null}

      <div className="space-y-4">
        {comments.map((comment) => {
          const isAuthor = comment.author?.id === user?.id
          return (
            <div key={comment.id} className="flex gap-3">
              <Avatar
                name={comment.author?.name ?? 'Unknown'}
                src={comment.author?.avatarUrl ?? null}
                seed={comment.author?.id}
                className="h-7 w-7"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{comment.author?.name ?? 'Unknown'}</span>
                  <span>{formatRelative(comment.createdAt)}</span>
                  {comment.editedAt ? <span>· edited</span> : null}
                </div>

                {editingId === comment.id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      value={editingText}
                      onChange={(event) => setEditingText(event.target.value)}
                      className="min-h-[60px]"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: comment.id, content: editingText.trim() })}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className={cn('mt-1 whitespace-pre-wrap text-sm')}>{comment.content}</p>
                )}

                {isAuthor && editingId !== comment.id ? (
                  <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                    <button
                      className="hover:text-foreground"
                      onClick={() => {
                        setEditingId(comment.id)
                        setEditingText(comment.content)
                      }}
                    >
                      <Pencil className="mr-1 inline h-3 w-3" />
                      Edit
                    </button>
                    <button className="hover:text-destructive" onClick={() => remove.mutate(comment.id)}>
                      <Trash2 className="mr-1 inline h-3 w-3" />
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {query.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load older comments'}
        </Button>
      ) : null}

      {!query.isLoading && comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet — start the discussion.</p>
      ) : null}
    </div>
  )
}
