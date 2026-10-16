import type { ReactElement } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BrandMark } from '@/components/common/BrandMark'
import { WorkspaceCreateDialog } from './WorkspaceCreateDialog'
import { Button } from '@/components/ui/button'

export function OnboardingPage(): ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <Card className="ff-brackets">
          <CardHeader>
            <BrandMark className="mb-4" />
            <CardTitle className="text-lg tracking-[-0.02em]">
              Create your first workspace
            </CardTitle>
            <CardDescription>
              A workspace is where your projects, tasks and teammates live. You can create more
              later and switch between them at any time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkspaceCreateDialog trigger={<Button className="w-full">Create workspace</Button>} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
