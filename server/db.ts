// Postgres: one pool for the server, and the schema applied at start (db/schema.sql is safe to run again).
import { readFileSync } from 'node:fs'
import pg from 'pg'

export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
db.on('error', (err) => console.error('database pool error', err))

/** Creates the tables if they aren't there yet. False = no database (accounts are off; guests still play). */
export async function setupDatabase(): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.warn('No DATABASE_URL: accounts are off (see server/.env.example)')
    return false
  }
  try {
    await db.query(readFileSync(new URL('./db/schema.sql', import.meta.url), 'utf8'))
    return true
  } catch (err) {
    console.error('Database not reachable: accounts are off.', (err as Error).message)
    return false
  }
}

// Housekeeping (Nov 27): expired sessions are deleted. Runs at start, then hourly.
const CLEANUP_MS = 60 * 60 * 1000
export async function cleanUp() {
  try {
    const s = await db.query('DELETE FROM sessions WHERE expires_at < now()')
    if (s.rowCount) console.log(`cleanup: ${s.rowCount} expired sessions removed`)
  } catch (err) {
    console.error('cleanup failed', (err as Error).message)
  }
}
export function startCleanup() {
  void cleanUp()
  setInterval(() => void cleanUp(), CLEANUP_MS).unref()
}
