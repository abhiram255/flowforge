import type { Page } from '@playwright/test'

export const DEMO_OWNER = {
  email: 'aarav.mehta@flowforge.dev',
  password: 'Password123!',
}

export async function login(page: Page, email = DEMO_OWNER.email, password = DEMO_OWNER.password): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function openProject(page: Page, projectName = 'Website Redesign'): Promise<void> {
  await page.getByRole('link', { name: projectName }).first().click()
  await page.waitForURL(/\/projects\//)
}
