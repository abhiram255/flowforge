import { createContext, useContext, type ReactElement, type ReactNode } from 'react'
import type { WorkspaceDTO } from '@flowforge/shared'

const WorkspaceContext = createContext<WorkspaceDTO | null>(null)

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: WorkspaceDTO
  children: ReactNode
}): ReactElement {
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceDTO {
  const workspace = useContext(WorkspaceContext)
  if (!workspace) throw new Error('useWorkspace must be used inside a workspace route')
  return workspace
}

export function useWorkspaceOptional(): WorkspaceDTO | null {
  return useContext(WorkspaceContext)
}

/** Members with at least the member rank can perform write actions in the UI. */
export function canWrite(role: WorkspaceDTO['role'] | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'member'
}

export function canManage(role: WorkspaceDTO['role'] | undefined): boolean {
  return role === 'owner' || role === 'admin'
}
