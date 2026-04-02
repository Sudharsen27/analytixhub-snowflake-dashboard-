import snowflake from 'snowflake-sdk'

export function createConnectionFromEnv(env) {
  const required = [
    'SNOWFLAKE_ACCOUNT',
    'SNOWFLAKE_USER',
    'SNOWFLAKE_PASSWORD',
    'SNOWFLAKE_WAREHOUSE',
    'SNOWFLAKE_DATABASE',
    'SNOWFLAKE_SCHEMA',
  ]
  for (const k of required) {
    if (!env[k]) throw new Error(`Missing required env var: ${k}`)
  }

  return snowflake.createConnection({
    account: env.SNOWFLAKE_ACCOUNT,
    username: env.SNOWFLAKE_USER,
    password: env.SNOWFLAKE_PASSWORD,
    warehouse: env.SNOWFLAKE_WAREHOUSE,
    database: env.SNOWFLAKE_DATABASE,
    schema: env.SNOWFLAKE_SCHEMA,
  })
}

export async function connect(conn) {
  await new Promise((resolve, reject) => {
    conn.connect((err) => (err ? reject(err) : resolve()))
  })
}

export async function execute(conn, sqlText, binds = []) {
  return await new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      binds,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows)),
    })
  })
}

