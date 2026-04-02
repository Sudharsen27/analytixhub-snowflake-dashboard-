import { execute } from './snowflake.js'

function fq(env, tableName) {
  return `${env.SNOWFLAKE_DATABASE}.${env.SNOWFLAKE_SCHEMA}.${tableName}`
}

async function listColumns(conn, env, tableName) {
  const rows = await execute(
    conn,
    `
      SELECT COLUMN_NAME
      FROM ${env.SNOWFLAKE_DATABASE}.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `,
    [env.SNOWFLAKE_SCHEMA, tableName.toUpperCase()],
  )
  return rows.map((r) => String(r.COLUMN_NAME))
}

function pickColumn(columns, candidates) {
  const upper = new Set(columns.map((c) => c.toUpperCase()))
  for (const c of candidates) {
    if (upper.has(c.toUpperCase())) return columns.find((x) => x.toUpperCase() === c.toUpperCase())
  }
  return null
}

export async function fetchKpis(conn, env) {
  const tenderTable = env.KPI_TENDER_TABLE ?? 'TENDER_2025'
  const statusTable = env.KPI_STATUS_TABLE ?? 'TENDER_STATUS'

  // Auto-detect join column in TENDER_2025 that references TENDER_STATUS.CODE
  const tenderCols = await listColumns(conn, env, tenderTable)
  const statusCodeCol =
    env.KPI_TENDER_STATUS_CODE_COLUMN ??
    pickColumn(tenderCols, [
      'STATUS_CODE',
      'TENDER_STATUS_CODE',
      'TENDERSTATUS',
      'STATUS',
      'TENDER_STATUS',
      'STATUSID',
      'STATUS_ID',
      'CODE',
    ])

  // Auto-detect a tender value column for "Total/Active Value"
  const valueCol =
    env.KPI_TENDER_VALUE_COLUMN ??
    pickColumn(tenderCols, [
      'TENDERVALUE',
      'TENDER_VALUE',
      'ESTIMATEDVALUE',
      'ESTIMATED_VALUE',
      'VALUE',
      'AMOUNT',
    ])

  // Active statuses (based on your `TENDER_STATUS` screenshot)
  const activeStatuses = (env.ACTIVE_TENDER_STATUSES ??
    'Open,Technical Bid,Financial Bid (L1)')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Status breakdown (useful for the UI later)
  let statusBreakdown = []
  let activeTendersRaw = 0
  let activeValueRaw = 0

  if (statusCodeCol) {
    statusBreakdown = await execute(
      conn,
      `
        SELECT s.STATUS AS status, COUNT(*) AS value
        FROM ${fq(env, tenderTable)} t
        JOIN ${fq(env, statusTable)} s
          ON t.${statusCodeCol} = s.CODE
        GROUP BY s.STATUS
        ORDER BY value DESC
      `,
    )

    const activeSet = new Set(activeStatuses.map((s) => s.toLowerCase()))
    for (const row of statusBreakdown) {
      const st = String(row.STATUS ?? row.status ?? '').toLowerCase()
      const v = Number(row.VALUE ?? row.value ?? 0)
      if (activeSet.has(st)) activeTendersRaw += v
    }

    if (valueCol) {
      const rows = await execute(
        conn,
        `
          SELECT COALESCE(SUM(t.${valueCol}), 0) AS value
          FROM ${fq(env, tenderTable)} t
          JOIN ${fq(env, statusTable)} s
            ON t.${statusCodeCol} = s.CODE
          WHERE s.STATUS IN (${activeStatuses.map(() => '?').join(', ')})
        `,
        activeStatuses,
      )
      activeValueRaw = Number(rows?.[0]?.VALUE ?? rows?.[0]?.value ?? 0)
    }
  }

  // Tender Owners (using production agency from your schema)
  const [tenderOwners] = await execute(
    conn,
    `
      SELECT COUNT(DISTINCT PRODUCTION_AGENCY_NAME) AS value
      FROM ${fq(env, tenderTable)}
      WHERE PRODUCTION_AGENCY_NAME IS NOT NULL
    `,
  )

  // Total Value (sum of all tenders)
  let totalValueRaw = 0
  if (valueCol) {
    const [totalValue] = await execute(
      conn,
      `
        SELECT COALESCE(SUM(${valueCol}), 0) AS value
        FROM ${fq(env, tenderTable)}
      `,
    )
    totalValueRaw = Number(totalValue?.VALUE ?? 0)
  }

  return {
    meta: {
      tenderTable,
      statusTable,
      detectedStatusCodeColumn: statusCodeCol,
      detectedTenderValueColumn: valueCol,
      activeStatuses,
    },
    statusBreakdown: statusBreakdown.map((r) => ({
      status: String(r.STATUS ?? r.status),
      value: Number(r.VALUE ?? r.value ?? 0),
    })),
    activeTendersRaw,
    tenderOwnersRaw: Number(tenderOwners?.VALUE ?? 0),
    totalValueRaw,
    activeValueRaw,
  }
}

function formatCompact(n) {
  // Indian-style compact (K/L/Cr). Assumes the number itself is already in desired unit.
  const num = Number(n ?? 0)
  const abs = Math.abs(num)
  if (abs >= 1e7) return `${(num / 1e7).toFixed(2).replace(/\.00$/, '')}Cr`
  if (abs >= 1e5) return `${(num / 1e5).toFixed(2).replace(/\.00$/, '')}L`
  if (abs >= 1e3) return `${(num / 1e3).toFixed(2).replace(/\.00$/, '')}K`
  return `${num}`
}

export function formatKpiResult(rawNumber) {
  const n = Number(rawNumber ?? 0)
  return {
    raw: n,
    display: n.toLocaleString('en-IN'),
    compact: formatCompact(n),
  }
}

