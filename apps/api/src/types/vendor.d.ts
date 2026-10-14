/**
 * Ambient declarations for dev-only tooling that ships without TypeScript types.
 * autocannon is only used by scripts/load-smoke.ts, where the result shape is
 * narrowed locally into `AutocannonResult`.
 */
declare module 'autocannon'
