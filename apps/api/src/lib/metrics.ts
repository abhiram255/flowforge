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
