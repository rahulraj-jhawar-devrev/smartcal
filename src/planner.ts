import Anthropic from '@anthropic-ai/sdk';
import type { Constraint, GeneratedSchedule, ScheduleBlock, Task } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Tool definition — forces Claude to return a validated, typed schedule
const scheduleTool: Anthropic.Tool = {
  name: 'save_schedule',
  description: 'Save the generated time-blocked schedule for the day',
  input_schema: {
    type: 'object' as const,
    properties: {
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            start:   { type: 'string', description: 'Start time HH:MM (24h)' },
            end:     { type: 'string', description: 'End time HH:MM (24h)' },
            type:    { type: 'string', enum: ['fixed', 'task', 'buffer', 'meal'] },
            label:   { type: 'string', description: 'Human-readable block name' },
            task_id: { type: ['number', 'null'] },
          },
          required: ['start', 'end', 'type', 'label', 'task_id'],
        },
      },
      reasoning: {
        type: 'string',
        description: '2-3 sentences on key scheduling decisions',
      },
    },
    required: ['blocks', 'reasoning'],
  },
};

export async function generateSchedule(
  tasks: Task[],
  constraints: Constraint[],
  date: string,
): Promise<GeneratedSchedule> {
  const c = Object.fromEntries(constraints.map(r => [r.key, r.value]));
  const today = new Date(date);

  const taskList =
    tasks.length === 0
      ? 'No pending tasks — just schedule fixed anchors and free time.'
      : tasks
          .map(t => {
            const daysLeft = t.deadline
              ? Math.ceil((new Date(t.deadline).getTime() - today.getTime()) / 86400000)
              : null;
            const urgency = daysLeft !== null
              ? (daysLeft <= 1 ? ' [DUE TODAY/TOMORROW]' : ` [due in ${daysLeft} days]`)
              : '';
            const notes = t.notes ? ` [notes: ${t.notes}]` : '';
            return `  - id:${t.id} "${t.title}" ${t.duration_mins}min priority:${t.priority}${urgency}${notes}`;
          })
          .join('\n');

  const gymLine = c.gym_enabled === 'true'
    ? `Gym: ${c.gym_time} for ${c.gym_duration_mins} mins`
    : 'Gym: not scheduled today';

  const prompt = [
    `You are a sharp personal productivity planner. Generate a realistic time-blocked schedule for ${date}.`,
    '',
    'FIXED ANCHORS (include these exactly):',
    `- Wake up: ${c.wake_time}`,
    `- Sleep: ${c.sleep_time}`,
    `- ${gymLine}`,
    `- Lunch: ${c.lunch_time} for ${c.lunch_duration_mins} mins`,
    `- Deep work window: ${c.deep_work_start}-${c.deep_work_end}`,
    '',
    'PENDING TASKS:',
    taskList,
    '',
    'RULES:',
    '1. High-priority and urgent tasks go inside the deep work window',
    '2. Low-energy tasks (admin, email) go in the afternoon',
    '3. Add a 10-min buffer block between every two tasks',
    '4. Never schedule anything after sleep time',
    '5. Be honest about capacity — if tasks do not fit today, leave them out rather than overpacking',
    '6. Every block needs a start, end, type, label, and task_id (null for non-task blocks)',
    '',
    'Call save_schedule with your answer.',
  ].join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    tools: [scheduleTool],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    const text = response.content.find(b => b.type === 'text');
    const detail = text?.type === 'text' ? text.text : 'No tool call returned';
    throw new Error(`Model did not call save_schedule: ${detail}`);
  }

  const result = toolUse.input as GeneratedSchedule;
  if (!result.blocks || !Array.isArray(result.blocks) || result.blocks.length === 0) {
    throw new Error('save_schedule returned empty blocks array');
  }

  // Validate all blocks have valid HH:MM times
  for (const block of result.blocks as ScheduleBlock[]) {
    if (!/^\d{2}:\d{2}$/.test(block.start) || !/^\d{2}:\d{2}$/.test(block.end)) {
      throw new Error(`Invalid time format in block: ${JSON.stringify(block)}`);
    }
  }

  return result;
}
