import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const db = new Database('./data/pending_actions.db');

db.exec(`
CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
`);

export function insertPendingAction({ type, payload }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO pending_actions (id, type, payload, created_at, consumed) VALUES (?, ?, ?, ?, 0)').run(
    id,
    type,
    payload,
    createdAt
  );
  return id;
}

const selectPending = db.prepare('SELECT id, type, payload, created_at, consumed FROM pending_actions WHERE consumed = 0');
const markConsumed = db.prepare('UPDATE pending_actions SET consumed = 1 WHERE id = ?');

export const fetchAndClearPendingActions = db.transaction(() => {
  const rows = selectPending.all();
  for (const row of rows) markConsumed.run(row.id);
  return rows;
});
