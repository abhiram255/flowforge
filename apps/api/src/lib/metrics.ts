import client from 'prom-client'
import type { RequestHandler } from 'express'

client.collectDefaultMetrics({ prefix: 'flowforge_' })

export const httpRequestDuration = new client.Histogram({
  name: 'flowforge_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
})

export const httpRequestsTotal = new client.Counter({
  name: 'flowforge_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
})

export const wsConnectionsGauge = new client.Gauge({
  name: 'flowforge_ws_connections',
  help: 'Active Socket.IO connections',
})

/** Read-through cache lookups that returned a stored value. */
export const cacheHitsTotal = new client.Counter({
  name: 'flowforge_cache_hits_total',
  help: 'Cache hits (value served from the cache)',
  labelNames: ['namespace'],
})

/** Cache misses — one increment per producer execution (i.e. database work). */
export const cacheMissesTotal = new client.Counter({
  name: 'flowforge_cache_misses_total',
  help: 'Cache misses (producer executions / database work performed)',
  labelNames: ['namespace'],
})

/** Concurrent misses on the same key that joined an in-flight producer. */
export const cacheCoalescedTotal = new client.Counter({
  name: 'flowforge_cache_coalesced_total',
  help: 'Cache misses coalesced onto an in-flight producer (stampede protection)',
  labelNames: ['namespace'],
})

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const stopTimer = httpRequestDuration.startTimer()
  res.on('finish', () => {
    const route = req.route ? `${req.baseUrl}${String(req.route.path)}` : 'unmatched'
    const labels = { method: req.method, route, status: String(res.statusCode) }
    stopTimer(labels)
    httpRequestsTotal.inc(labels)
  })
  next()
}

export const metricsHandler: RequestHandler = async (_req, res) => {
  res.setHeader('Content-Type', client.register.contentType)
  res.end(await client.register.metrics())
}
