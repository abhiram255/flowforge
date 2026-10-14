import { ROLE_RANK, type Role } from '@flowforge/shared'
import { AppError } from './errors'

export const hasAtLeast = (role: Role, min: Role): boolean => ROLE_RANK[role] >= ROLE_RANK[min]

export function assertAtLeast(role: Role, min: Role, message?: string): void {
  if (!hasAtLeast(role, min)) {
    throw AppError.forbidden(message ?? `Requires at least the ${min} role`)
  }
}

export const isPrivileged = (role: Role): boolean => hasAtLeast(role, 'admin')

/** Viewers are read-only across every workspace-owned resource. */
export const canWrite = (role: Role): boolean => hasAtLeast(role, 'member')
