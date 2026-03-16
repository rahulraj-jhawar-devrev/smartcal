import Anthropic from '@anthropic-ai/sdk';
import type { Constraint, GeneratedSchedule, Task } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

export async function generateSchedule(
  tasks: Task[],
  constraints: Constraint[],
  date: string,
): Promise<GeneratedSchedule> {
  const c = Object.fromEntries(constraints.map(r => [r.key, r.value]));
  const today = new Date(date);

  const taskList =
    tasks.length === 0
      ? 'No pending tasks.'
      : tasks
          .map(t => {
            const daysLeft = t.deadline
              ? Math.ceil((new Date(t.deadline).getTime() - today.getTime()) / 86400000)
              : null;
            return `  - id:${t.id} | "${t.title}" | ${t.duration_mins}min | priority:${t.priority} | type:${t.type}${daysLeft !== null ? ` | deadline in ${daysLeft} day(s)` : ''}`;
          })
          .join('\n');

  const prompt = `You are a personal productivity planner. Generate a realistic, optimized time-blocked schedule for ${date}.

FIXED ANCHORS (must appear in schedule):
- Wake: ${c.wake_time}
- Sleep: ${c.sleep_time}
- Gym: ${c.gym_enabled === 'true' ? `${c.gym_time} for ${c.gym_duration_mins} mins` : 'disabled'}
- Lunch: ${c.lunch_time} for ${c.lunch_duration_mins} mins
- Deep work window: ${c.deep_work_start}–${c.deep_work_end} (reserve for focused/creative tasks)

PENDING TASKS:
${taskList}

SCHEDULING RULES:
- Put high-priority and deadline-urgent tasks in the deep work window
- Add 10–15 min buffer blocks between tasks (type: "buffer")
- Do not schedule tasks past sleep time
- Tasks with deadline in 1–2 days are urgent — schedule them first
- Group similar task types together when possible
- Be realistic about what fits — do not overpack

Return ONLY a raw JSON object with no markdown fences, no extra text. Schema:
{
  "blocks": [
    { "start": "HH:MM", "end": "HH:MM", "type": "fixed|task|buffer|meal", "label": "string", "task_id": number|null, "priority": 1 }
  ],
  "reasoning": "2-3 sentences on key scheduling decisions"
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    thinking: { type: 'enabled', budget_tokens: 5000 },
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text output from model');

  const parsed = JSON.parse(stripFences(textBlock.text)) as GeneratedSchedule;
  if (!parsed.blocks || !Array.isArray(parsed.blocks)) {
    throw new Error('Invalid schedule shape returned by model');
  }
  return parsed;
}
