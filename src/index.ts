import express, { Request, Response } from 'express';
import db from './db';
import { generateSchedule } from './planner';
import type { Constraint, SavedSchedule, Task } from './types';

const app = express();
app.use(express.json());

const PORT = process.env.PORT ?? 3001;

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/tasks', (_req: Request, res: Response) => {
  const tasks = db
    .prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY deadline ASC, created_at ASC")
    .all() as Task[];
  res.json(tasks);
});

app.post('/tasks', (req: Request, res: Response) => {
  const { title, deadline, duration_mins = 30, type = 'task', priority = 'medium' } =
    req.body as Partial<Task>;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const result = db
    .prepare('INSERT INTO tasks (title, deadline, duration_mins, type, priority) VALUES (?, ?, ?, ?, ?)')
    .run(title, deadline ?? null, duration_mins, type, priority);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid) as Task;
  res.status(201).json(task);
});

app.patch('/tasks/:id', (req: Request, res: Response) => {
  const { title, deadline, duration_mins, type, priority, status } = req.body as Partial<Task>;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as Task | undefined;
  if (!task) return res.status(404).json({ error: 'task not found' });
  db.prepare(`
    UPDATE tasks SET
      title = COALESCE(?, title),
      deadline = COALESCE(?, deadline),
      duration_mins = COALESCE(?, duration_mins),
      type = COALESCE(?, type),
      priority = COALESCE(?, priority),
      status = COALESCE(?, status)
    WHERE id = ?
  `).run(title, deadline, duration_mins, type, priority, status, req.params.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as Task);
});

app.delete('/tasks/:id', (req: Request, res: Response) => {
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'task not found' });
  res.json({ deleted: true });
});

// ── Constraints ───────────────────────────────────────────────────────────────
app.get('/constraints', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM constraints').all() as Constraint[];
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

app.put('/constraints', (req: Request, res: Response) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO constraints (key, value) VALUES (?, ?)');
  const upsertMany = db.transaction((entries: [string, string][]) => {
    entries.forEach(([k, v]) => upsert.run(k, String(v)));
  });
  upsertMany(Object.entries(req.body) as [string, string][]);
  const rows = db.prepare('SELECT * FROM constraints').all() as Constraint[];
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

// ── Planning ──────────────────────────────────────────────────────────────────
app.post('/plan/today', async (_req: Request, res: Response) => {
  const date = new Date().toISOString().split('T')[0];
  return planForDate(date, res);
});

app.get('/plan/:date', (req: Request, res: Response) => {
  const schedule = db
    .prepare('SELECT * FROM schedules WHERE date = ?')
    .get(req.params.date) as SavedSchedule | undefined;
  if (!schedule) return res.status(404).json({ error: 'no plan for this date' });
  res.json({ ...schedule, blocks: JSON.parse(schedule.blocks) });
});

app.post('/plan/:date/replan', async (req: Request, res: Response) => {
  db.prepare('DELETE FROM schedules WHERE date = ?').run(req.params.date);
  return planForDate(String(req.params.date), res);
});

async function planForDate(date: string, res: Response): Promise<void> {
  try {
    const tasks = db
      .prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY deadline ASC")
      .all() as Task[];
    const constraints = db.prepare('SELECT * FROM constraints').all() as Constraint[];
    const schedule = await generateSchedule(tasks, constraints, date);
    db.prepare('INSERT OR REPLACE INTO schedules (date, blocks, reasoning) VALUES (?, ?, ?)')
      .run(date, JSON.stringify(schedule.blocks), schedule.reasoning);
    res.json({ date, blocks: schedule.blocks, reasoning: schedule.reasoning });
  } catch (err) {
    console.error('Planning error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}

app.listen(PORT, () => {
  console.log(`SmartCal API running on port ${PORT}`);
});
