import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { lazy, Suspense, type ReactElement } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import type { Paginated, WorkspaceDTO } from '@flowforge/shared'
import api from './lib/api'
import { qk } from './lib/query'
import { AppShell } from './components/layout/AppShell'
import { WorkspaceProvider } from './hooks/useWorkspace'
import { useAuthStore } from './stores/auth'
import { AcceptInvitePage } from './features/invitations/AcceptInvitePage'
import { LoginPage } from './features/auth/LoginPage'
import { RegisterPage } from './features/auth/RegisterPage'
import { NotFoundPage } from './features/NotFoundPage'

// Route-level code splitting: each workspace view loads on first visit, so the
// initial bundle stays small (recharts only ships with the analytics page).
const OnboardingPage = lazy(() =>
  import('./features/onboarding/OnboardingPage').then((module) => ({
    default: module.OnboardingPage,
  })),
)
const DashboardPage = lazy(() =>
  import('./features/dashboard/DashboardPage').then((module) => ({
    default: module.DashboardPage,
  })),
)
const ProjectsPage = lazy(() =>
  import('./features/projects/ProjectsPage').then((module) => ({ default: module.ProjectsPage })),
)
const BoardPage = lazy(() =>
  import('./features/board/BoardPage').then((module) => ({ default: module.BoardPage })),
)
const TaskDetailPage = lazy(() =>
  import('./features/task/TaskDetailPage').then((module) => ({ default: module.TaskDetailPage })),
)
const TeamPage = lazy(() =>
  import('./features/team/TeamPage').then((module) => ({ default: module.TeamPage })),
)
const AnalyticsPage = lazy(() =>
  import('./features/analytics/AnalyticsPage').then((module) => ({
    default: module.AnalyticsPage,
  })),
)
const SettingsPage = lazy(() =>
  import('./features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)

function FullPageSplash(): ReactElement {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <p className="ff-label text-muted-foreground">Initialising</p>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactElement }): ReactElement {
  const status = useAuthStore((state) => state.status)
  const location = useLocation()

  if (status === 'loading') return <FullPageSplash />
  if (status === 'anonymous') {
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    )
  }
  return children
}

function RootRedirect(): ReactElement {
  const status = useAuthStore((state) => state.status)
  if (status === 'loading') return <FullPageSplash />
  return <Navigate to={status === 'authenticated' ? '/app' : '/login'} replace />
}

/** /app → first workspace dashboard, or onboarding when the user has none. */
function WorkspaceGate(): ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: qk.workspaces,
    queryFn: () => api.get<{ data: WorkspaceDTO[] }>('/workspaces'),
  })

  if (isLoading) return <FullPageSplash />
  const first = data?.data[0]
  return <Navigate to={first ? `/app/${first.slug}` : '/app/onboarding'} replace />
}

function WorkspaceLayout(): ReactElement {
  const { slug } = useParams()
  const { data, isLoading } = useQuery({
    queryKey: qk.workspaces,
    queryFn: () => api.get<{ data: WorkspaceDTO[] }>('/workspaces'),
  })

  if (isLoading) return <FullPageSplash />
  const workspace = data?.data.find((entry) => entry.slug === slug)
  if (!workspace) {
    return (
      <NotFoundPage
        title="Workspace not found"
        message="This workspace does not exist, or you are not a member of it."
      />
    )
  }

  return (
    <WorkspaceProvider workspace={workspace}>
      <AppShell />
    </WorkspaceProvider>
  )
}

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/invite/:token', element: <AcceptInvitePage /> },
  {
    element: (
      <RequireAuth>
        <Suspense fallback={<FullPageSplash />}>
          <Outlet />
        </Suspense>
      </RequireAuth>
    ),
    children: [
      { path: '/app', element: <WorkspaceGate /> },
      { path: '/app/onboarding', element: <OnboardingPage /> },
      {
        path: '/app/:slug',
        element: <WorkspaceLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'projects/:projectId', element: <BoardPage /> },
          { path: 'tasks/:taskId', element: <TaskDetailPage /> },
          { path: 'team', element: <TeamPage /> },
          { path: 'analytics', element: <AnalyticsPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])

export type { Paginated }
