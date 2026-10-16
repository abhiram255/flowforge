import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-md border border-input bg-surface-2/70 px-3 py-1 text-sm text-foreground transition-[border-color,background-color,box-shadow] duration-150 ease-quart placeholder:text-muted-foreground/80 hover:border-border-strong focus-visible:border-primary focus-visible:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'
