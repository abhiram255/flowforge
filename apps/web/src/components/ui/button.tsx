import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium tracking-tight transition-[background-color,border-color,color,box-shadow,transform,filter] duration-150 ease-quart active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/0.25)] hover:brightness-110 hover:shadow-glow',
        secondary:
          'border border-border bg-surface-2 text-foreground hover:border-border-strong hover:bg-surface-3',
        outline:
          'border border-border bg-transparent text-foreground hover:border-primary/45 hover:bg-primary-soft hover:text-primary',
        ghost: 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/0.2)] hover:brightness-110',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-xs [&_svg]:size-3.5',
        lg: 'h-10 px-6',
        icon: 'h-9 w-9 ff-tap',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render as the child element (e.g. a router <Link>) instead of a button. */
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Component = asChild ? Slot : 'button'
    return (
      <Component
        ref={ref}
        {...(asChild ? {} : { type: type ?? 'button' })}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
