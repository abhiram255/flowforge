import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type ReactElement } from 'react'
import type { AttachmentDTO, TaskDTO } from '@flowforge/shared'
import api, { ApiError, downloadFile } from '@/lib/api'
import { qk } from '@/lib/query'
import { formatBytes, formatRelative } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/feedback'

export function AttachmentsTab({
  task,
  writable,
}: {
  task: TaskDTO
  writable: boolean
}): ReactElement {
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const query = useQuery({
    queryKey: qk.attachments(task.id),
    queryFn: () => api.get<{ data: AttachmentDTO[] }>(`/tasks/${task.id}/attachments`),
  })

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: qk.attachments(task.id) })
    void queryClient.invalidateQueries({ queryKey: qk.task(task.id) })
  }

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/attachments/${id}`),
    onSuccess: () => {
      toast.success('File removed')
      invalidate()
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not remove the file'),
  })

  async function onFileChosen(file: File | undefined): Promise<void> {
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await api.upload(`/tasks/${task.id}/attachments`, formData)
      toast.success(`${file.name} uploaded`)
      invalidate()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function onDownload(attachment: AttachmentDTO): Promise<void> {
    try {
      const blob = await downloadFile(`/attachments/${attachment.id}/download`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = attachment.filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Download failed')
    }
  }

  const attachments = query.data?.data ?? []

  return (
    <div className="space-y-4">
      {writable ? (
        <div>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(event) => void onFileChosen(event.target.files?.[0])}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            <Upload /> {uploading ? 'Uploading…' : 'Upload file'}
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Images, PDF, office documents, text, CSV and ZIP up to 10 MB.
          </p>
        </div>
      ) : null}

      {query.isLoading ? <Spinner /> : null}

      <div className="space-y-1">
        {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{attachment.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(attachment.size)} · {attachment.uploader?.name ?? 'Unknown'} ·{' '}
                  {formatRelative(attachment.createdAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Download ${attachment.filename}`}
                onClick={() => void onDownload(attachment)}
              >
                <Download />
              </Button>
              {writable ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${attachment.filename}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate(attachment.id)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          ))}
      </div>

      {!query.isLoading && attachments.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Paperclip className="h-4 w-4" /> No files attached yet.
        </p>
      ) : null}
    </div>
  )
}
