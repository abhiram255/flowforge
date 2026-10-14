import { expect, test } from '@playwright/test'
import { login, openProject } from './helpers'

test.describe('board and task lifecycle', () => {
  test('the seeded board renders every column with tasks', async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL(/\/app\/acme/, { timeout: 20_000 })
    await openProject(page)

    await expect(page.getByRole('heading', { name: 'Website Redesign' })).toBeVisible()
    for (const column of ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done']) {
      await expect(page.getByRole('heading', { name: column })).toBeVisible()
    }
    await expect(page.locator('[data-testid^="task-card-"]').first()).toBeVisible()
  })

  test('a task can be created, opened and commented on', async ({ page }) => {
    const title = `E2E release checklist ${Date.now()}`

    await login(page)
    await expect(page).toHaveURL(/\/app\/acme/, { timeout: 20_000 })
    await openProject(page)

    // Create
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('Title').fill(title)
    await page.getByLabel('Description').fill('Created by the Playwright suite.')
    await page.getByRole('button', { name: 'Create task' }).click()

    const card = page.locator('article', { hasText: title }).first()
    await expect(card).toBeVisible({ timeout: 20_000 })

    // Open detail
    await card.click()
    await expect(page.getByRole('heading', { name: title })).toBeVisible()

    // Comment
    const commentText = `Looks good to ship ${Date.now()}`
    await page.getByPlaceholder(/Write a comment/).fill(commentText)
    await page.getByRole('button', { name: 'Comment' }).click()
    await expect(page.getByText(commentText)).toBeVisible({ timeout: 20_000 })
  })

  test('filters narrow the board to a single priority', async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL(/\/app\/acme/, { timeout: 20_000 })
    await openProject(page)

    await page.getByRole('combobox').nth(1).click()
    await page.getByRole('option', { name: 'Urgent' }).click()

    await expect(page.locator('[data-testid^="task-card-"]').first()).toBeVisible()
    const cards = page.locator('[data-testid^="task-card-"]')
    const count = await cards.count()
    for (let index = 0; index < count; index += 1) {
      await expect(cards.nth(index).getByText('Urgent')).toBeVisible()
    }
  })
})
