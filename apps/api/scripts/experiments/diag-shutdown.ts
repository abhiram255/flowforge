/** Throwaway: does stopGracefully really stop the API, and does the LB eject it? */
import { logger } from '../../src/config/logger'
import { RoundRobinBalancer, sleep, startApiInstance } from './lib'

const PORT = 43701
const LB = 43700

async function probe(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
      signal: AbortSignal.timeout(700),
    })
    return response.ok
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const instance = await startApiInstance({
    name: 'diag',
    port: PORT,
    mongoUri: 'mongodb://127.0.0.1:27017/flowforge_diag',
    redisUrl: null,
  })
  const balancer = new RoundRobinBalancer({
    port: LB,
    upstreams: [{ name: 'diag', port: PORT }],
    healthIntervalMs: 500,
  })
  await balancer.listen()

  logger.warn(
    `diag: before stop → health=${await probe(PORT)} snapshot=${JSON.stringify(balancer.snapshot())}`,
  )
  const stopped = await instance.stopGracefully()
  logger.warn({ stopped }, 'diag: stopGracefully result')
  logger.warn(
    `diag: immediately after stop → health=${await probe(PORT)} childExitCode=${instance.child.exitCode} signalCode=${instance.child.signalCode}`,
  )

  for (let i = 1; i <= 3; i += 1) {
    await sleep(1000)
    logger.warn(
      `diag: +${i}s → health=${await probe(PORT)} snapshot=${JSON.stringify(balancer.snapshot())} events=${JSON.stringify(balancer.events)}`,
    )
  }

  await balancer.close()
  await instance.kill()
  await sleep(500)
  logger.warn(`diag: after final kill → health=${await probe(PORT)}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ err: error }, 'diag failed')
    process.exit(1)
  })
