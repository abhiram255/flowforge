/**
 * Load-runner child process for Experiment 6.
 *
 * autocannon is CPU-hungry, and running it inside the orchestrator starved that
 * process's timers (the scheduled instance kill drifted from 8s to 38s). Running
 * it as a child keeps the orchestrator's clock accurate; the JSON result is
 * printed to stdout for the parent to parse.
 *
 * Usage: tsx scripts/experiments/load-runner.ts <url> <token> <connections> <durationSeconds>
 */
const [url, token, connectionsArg, durationArg] = process.argv.slice(2)

async function main(): Promise<void> {
  if (!url || !token)
    throw new Error('usage: load-runner <url> <token> <connections> <durationSeconds>')
  const autocannon = (await import('autocannon')).default as unknown as (
    options: Record<string, unknown>,
  ) => Promise<{
    errors: number
    non2xx: number
    timeouts: number
    requests: { average: number; total: number }
    latency: { p97_5: number }
  }>

  const result = await autocannon({
    url,
    method: 'GET',
    connections: Number(connectionsArg ?? 30),
    duration: Number(durationArg ?? 30),
    pipelining: 1,
    headers: { authorization: `Bearer ${token}` },
  })

  process.stdout.write(
    `RESULT ${JSON.stringify({
      errors: result.errors,
      non2xx: result.non2xx,
      timeouts: result.timeouts,
      requestsPerSecond: Math.round(result.requests.average),
      requestCount: result.requests.total,
      latencyP97_5: result.latency.p97_5,
    })}\n`,
  )
}

main().catch((error) => {
  process.stderr.write(`load-runner failed: ${(error as Error).message}\n`)
  process.exit(1)
})
