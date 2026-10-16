import { LogOut, Moon, Settings, Sun, User as UserIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWorkspaceOptional } from '@/hooks/useWorkspace'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

export function UserMenu(): ReactElement {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const { theme, setTheme } = useUiStore()
  const workspace = useWorkspaceOptional()
  const navigate = useNavigate()

  if (!user) return <span />

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle theme"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="rounded-md transition-opacity duration-150 hover:opacity-85"
            aria-label="Account menu"
          >
            <Avatar name={user.name} src={user.avatarUrl} seed={user.id} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <span className="block text-sm font-medium normal-case tracking-normal text-foreground">
              {user.name}
            </span>
            <span className="ff-num mt-1 block truncate text-[10px] font-normal normal-case">
              {user.email}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              if (workspace) navigate(`/app/${workspace.slug}/settings`)
            }}
          >
            <Settings className="h-4 w-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              if (workspace) navigate(`/app/${workspace.slug}/settings?tab=profile`)
            }}
          >
            <UserIcon className="h-4 w-4" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void logout()}>
            <LogOut className="h-4 w-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
