import { Pool, QueryResult, QueryResultRow } from 'pg';

// =============================================
// PostgreSQL Connection Pool (Railway Postgres)
// =============================================

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.URL_DO_BANCO_DE_DADOS,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });

    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

// =============================================
// Query Helpers
// =============================================

/**
 * Execute a SQL query and return all rows
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await getPool().query<T>(text, params);
  const duration = Date.now() - start;

  if (process.env.NODE_ENV !== 'production' && duration > 500) {
    console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 100));
  }

  return result;
}

/**
 * Execute a SQL query and return a single row or null
 */
export async function queryOne<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] || null;
}

/**
 * Execute a SQL query and return all rows as array
 */
export async function queryAll<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

/**
 * Execute an INSERT and return the inserted row
 */
export async function insertOne<T extends QueryResultRow = any>(
  table: string,
  data: Record<string, any>,
): Promise<T | null> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const columns = keys.join(', ');

  const text = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`;
  const result = await query<T>(text, values);
  return result.rows[0] || null;
}

/**
 * Execute an UPDATE and return the updated row
 */
export async function updateOne<T extends QueryResultRow = any>(
  table: string,
  data: Record<string, any>,
  where: Record<string, any>,
): Promise<T | null> {
  const dataKeys = Object.keys(data);
  const whereKeys = Object.keys(where);
  const allValues = [...Object.values(data), ...Object.values(where)];

  const setClauses = dataKeys.map((key, i) => `${key} = $${i + 1}`).join(', ');
  const whereClauses = whereKeys
    .map((key, i) => `${key} = $${dataKeys.length + i + 1}`)
    .join(' AND ');

  const text = `UPDATE ${table} SET ${setClauses} WHERE ${whereClauses} RETURNING *`;
  const result = await query<T>(text, allValues);
  return result.rows[0] || null;
}

/**
 * Execute a DELETE
 */
export async function deleteWhere(
  table: string,
  where: Record<string, any>,
): Promise<number> {
  const keys = Object.keys(where);
  const values = Object.values(where);
  const whereClauses = keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ');

  const text = `DELETE FROM ${table} WHERE ${whereClauses}`;
  const result = await query(text, values);
  return result.rowCount || 0;
}

/**
 * Count rows in a table
 */
export async function countWhere(
  table: string,
  where: Record<string, any>,
): Promise<number> {
  const keys = Object.keys(where);
  const values = Object.values(where);
  const whereClauses = keys.length
    ? keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ')
    : '1=1';

  const text = `SELECT COUNT(*)::int as count FROM ${table} WHERE ${whereClauses}`;
  const result = await queryOne<{ count: number }>(text, values);
  return result?.count || 0;
}

/**
 * Call a PostgreSQL function via RPC
 */
export async function rpc<T = any>(
  functionName: string,
  params: Record<string, any> = {},
): Promise<T | null> {
  const keys = Object.keys(params);
  const values = Object.values(params);
  const args = keys.map((_, i) => `$${i + 1}`).join(', ');

  // Named parameters style: SELECT func(p_name := $1, p_email := $2)
  const namedArgs = keys.map((key, i) => `${key} := $${i + 1}`).join(', ');

  const text = `SELECT * FROM ${functionName}(${namedArgs})`;
  const result = await query(text, values);

  // If function returns a single value (like JSONB), unwrap it
  if (result.rows.length === 1 && Object.keys(result.rows[0]).length === 1) {
    const key = Object.keys(result.rows[0])[0];
    return result.rows[0][key] as T;
  }

  return result.rows as unknown as T;
}

/**
 * Get the raw pool for transactions
 */
export function getDb(): Pool {
  return getPool();
}

export default { query, queryOne, queryAll, insertOne, updateOne, deleteWhere, countWhere, rpc, getDb };
