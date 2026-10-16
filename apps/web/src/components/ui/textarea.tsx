import * as React from 'react'
import { cn } from '@/lib/utils'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[80px] w-full rounded-md border border-input bg-surface-2/70 px-3 py-2 text-sm leading-relaxed text-foreground transition-[border-color,background-color,box-shadow] duration-150 ease-quart placeholder:text-muted-foreground/80 hover:border-border-strong focus-visible:border-primary focus-visible:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'
