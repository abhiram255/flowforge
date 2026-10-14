import { expect, test } from '@playwright/test'
import { DEMO_OWNER, login } from './helpers'

test.describe('authentication', () => {
  test('a new user can register, create a workspace and land on the dashboard', async ({ page }) => {
    const email = `e2e-${Date.now()}@flowforge.test`

    await page.goto('/register')
    await page.getByLabel('Full name').fill('E2E Tester')
    await page.getByLabel('Work email').fill(email)
    await page.getByLabel('Password').fill('Password123!')
    await page.getByRole('button', { name: 'Create account' }).click()

    // No workspaces yet → onboarding
    await expect(page.getByText('Create your first workspace')).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Create workspace' }).click()
    await page.getByLabel('Workspace name').fill('E2E Workspace')
    await page.getByRole('dialog').getByRole('button', { name: 'Create workspace' }).click()

    await expect(page.getByText(/Good to see you/)).toBeVisible({ timeout: 20_000 })
    // Workspace slug derived from the name
    await expect(page).toHaveURL(/\/app\/e2e-workspace/)
  })

  test('rejects invalid credentials with an inline error', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(DEMO_OWNER.email)
    await page.getByLabel('Password').fill('WrongPassword1')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toContainText(/invalid/i)
  })

  test('seeded owner signs in, sees the dashboard and can sign out', async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL(/\/app\/acme/, { timeout: 20_000 })
    await expect(page.getByText(/Good to see you/)).toBeVisible()

    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
  })
})
