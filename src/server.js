import dotenv from 'dotenv'
import cors from 'cors'
import express from 'express'
import { fetchKpis, formatKpiResult } from './kpis.js'
import { connect, createConnectionFromEnv, execute } from './snowflake.js'
import path from 'path'
import { fileURLToPath } from 'url'

// Load backend/.env reliably regardless of current working directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const app = express()
app.use(express.json())
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? true,
    credentials: false,
  }),
)

let conn
async function getConn() {
  if (conn) return conn
  const c = createConnectionFromEnv(process.env)
  await connect(c)
  conn = c
  return conn
}

app.get('/', (_req, res) => {
  res.type('text').send(
    [
      'Analytixhub Dashboard Backend',
      '',
      'Available endpoints:',
      '- GET /api/health',
      '- GET /api/kpis',
      '',
    ].join('\n'),
  )
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/envcheck', (_req, res) => {
  // Never return secret values; just presence/absence
  const keys = [
    'SNOWFLAKE_ACCOUNT',
    'SNOWFLAKE_USER',
    'SNOWFLAKE_PASSWORD',
    'SNOWFLAKE_WAREHOUSE',
    'SNOWFLAKE_DATABASE',
    'SNOWFLAKE_SCHEMA',
  ]
  res.json(
    Object.fromEntries(keys.map((k) => [k, Boolean(process.env[k])])),
  )
})

app.get('/api/kpis', async (_req, res) => {
  try {
    const c = await getConn()
    const k = await fetchKpis(c, process.env)

    res.json({
      meta: k.meta,
      statusBreakdown: k.statusBreakdown,
      activeTenders: formatKpiResult(k.activeTendersRaw),
      tenderOwners: formatKpiResult(k.tenderOwnersRaw),
      totalValue: formatKpiResult(k.totalValueRaw),
      activeValue: formatKpiResult(k.activeValueRaw),
    })
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch KPIs',
      message: err instanceof Error ? err.message : String(err),
    })
  }
})

const port = Number(process.env.PORT ?? 8787)
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`)
})

