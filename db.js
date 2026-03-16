const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'smartcal.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    deadline TEXT,
    duration_mins INTEGER DEFAULT 30,
    type TEXT DEFAULT 'task',
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS constraints (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    blocks TEXT NOT NULL,
    reasoning TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed default constraints if none exist
const existing = db.prepare('SELECT count(*) as c FROM constraints').get();
if (existing.c === 0) {
  const insert = db.prepare('INSERT OR IGNORE INTO constraints (key, value) VALUES (?, ?)');
  const defaults = [
    ['wake_time', '07:00'],
    ['sleep_time', '23:00'],
    ['gym_enabled', 'false'],
    ['gym_time', '07:00'],
    ['gym_duration_mins', '60'],
    ['lunch_time', '13:00'],
    ['lunch_duration_mins', '45'],
    ['deep_work_start', '09:00'],
    ['deep_work_end', '12:00'],
  ];
  defaults.forEach(([k, v]) => insert.run(k, v));
}

module.exports = db;
