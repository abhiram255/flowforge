import * as AvatarPrimitive from '@radix-ui/react-avatar'
import * as React from 'react'
import { avatarGradient, cn, initials } from '@/lib/utils'

export interface AvatarProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  name: string
  src?: string | null
  seed?: string
}

export function Avatar({ name, src, seed, className, ...props }: AvatarProps): React.ReactElement {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gradient-to-br text-white',
        avatarGradient(seed ?? name),
        className,
      )}
      {...props}
    >
      {src ? <AvatarPrimitive.Image src={src} alt={name} className="h-full w-full object-cover" /> : null}
      <AvatarPrimitive.Fallback className="flex h-full w-full items-center justify-center text-xs font-semibold">
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}

export function AvatarGroup({
  people,
  max = 3,
  className,
}: {
  people: Array<{ id: string; name: string; avatarUrl?: string | null }>
  max?: number
  className?: string
}): React.ReactElement | null {
  if (people.length === 0) return null
  const shown = people.slice(0, max)
  const overflow = people.length - shown.length

  return (
    <div className={cn('flex items-center -space-x-2', className)}>
      {shown.map((person) => (
        <Avatar
          key={person.id}
          name={person.name}
          src={person.avatarUrl}
          seed={person.id}
          className="h-6 w-6 ring-2 ring-card"
        />
      ))}
      {overflow > 0 ? (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-card">
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}
