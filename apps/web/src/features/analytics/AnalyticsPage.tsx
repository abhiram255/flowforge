import { useQuery } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TASK_STATUS_LABELS, type AnalyticsDTO } from '@flowforge/shared'
import api from '@/lib/api'
import { qk } from '@/lib/query'
import { useChartTheme } from '@/lib/chart-theme'
import { PageHeader, StatCard } from '@/components/common/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingScreen } from '@/components/ui/feedback'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWorkspace } from '@/hooks/useWorkspace'

const TOOLTIP_STYLE = {
  background: 'var(--surface-1)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  color: 'var(--foreground)',
} as const

export function AnalyticsPage(): ReactElement {
  const workspace = useWorkspace()
  const [range, setRange] = useState(30)
  const theme = useChartTheme()

  const { data, isLoading } = useQuery({
    queryKey: qk.analytics(workspace.id, range),
    queryFn: () =>
      api.get<{ analytics: AnalyticsDTO }>(`/workspaces/${workspace.id}/analytics?range=${range}`),
  })

  if (isLoading || !data) return <LoadingScreen label="Computing analytics…" />
  const analytics = data.analytics
  const overview = analytics.overview

  const axisTick = { fontSize: 10, fill: theme.muted, fontFamily: 'var(--font-mono)' }

  const trendData = analytics.completionTrend.map((point) => ({
    ...point,
    label: point.date.slice(5),
  }))

  const workloadData = analytics.workload.map((entry) => ({
    name: entry.name.split(' ')[0] ?? entry.name,
    open: entry.open,
    overdue: entry.overdue,
  }))

  const statusData = analytics.statusDistribution
    .filter((slice) => slice.count > 0)
    .map((slice) => ({
      name: TASK_STATUS_LABELS[slice.status],
      value: slice.count,
      status: slice.status,
    }))

  const delta = overview.completedLast30d - overview.completedPrev30d

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Telemetry"
        title="Analytics"
        description="Delivery health across this workspace, computed from live task data."
        actions={
          <Select value={String(range)} onValueChange={(value) => setRange(Number(value))}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="ff-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total tasks"
          value={overview.totalTasks}
          hint={`${overview.openTasks} open`}
        />
        <StatCard
          label="Completion rate"
          value={`${overview.completionRate}%`}
          hint={`${overview.completedTasks} completed`}
          tone="success"
        />
        <StatCard
          label="Overdue"
          value={overview.overdueTasks}
          tone={overview.overdueTasks > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Avg cycle time"
          value={overview.avgCycleTimeHours !== null ? `${overview.avgCycleTimeHours}h` : '—'}
          hint={`${delta >= 0 ? '+' : ''}${delta} vs previous 30d`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Completion trend</CardTitle>
            <span className="ff-label text-muted-foreground">Last {range} days</span>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ left: -20, right: 8, top: 4 }}>
                  <defs>
                    <linearGradient id="completedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={theme.success} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={theme.success} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="createdFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={theme.accent} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={theme.accent} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke={theme.grid} vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: theme.border }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    type="monotone"
                    dataKey="created"
                    name="Created"
                    stroke={theme.accent}
                    fill="url(#createdFill)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="completed"
                    name="Completed"
                    stroke={theme.success}
                    fill="url(#completedFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={3}
                    stroke={theme.surface}
                    strokeWidth={2}
                  >
                    {statusData.map((entry) => (
                      <Cell key={entry.status} fill={theme.status[entry.status]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Workload by member</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workloadData} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={theme.grid} vertical={false} />
                  <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--surface-2)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="open" name="Open tasks" fill={theme.accent} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="overdue" name="Overdue" fill={theme.danger} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {analytics.projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active projects.</p>
            ) : (
              analytics.projects.map((project) => {
                const percent =
                  project.total > 0 ? Math.round((project.done / project.total) * 100) : 0
                return (
                  <div key={project.id}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium tracking-tight">
                        {project.name}
                      </span>
                      <span className="ff-num text-[10px] text-muted-foreground">
                        {project.done}/{project.total}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-expo"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                )
              })
            )}
            <p className="ff-label border-t border-border pt-3 text-muted-foreground">
              Generated {new Date(analytics.generatedAt).toLocaleTimeString()} · cached 60s
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
