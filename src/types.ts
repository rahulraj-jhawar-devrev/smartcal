export interface Task {
  id: number;
  title: string;
  notes: string | null;
  deadline: string | null;
  duration_mins: number;
  type: string;
  priority: string;
  status: string;
  created_at: string;
}

export interface Constraint {
  key: string;
  value: string;
}

export interface ScheduleBlock {
  start: string;
  end: string;
  type: 'fixed' | 'task' | 'buffer' | 'meal';
  label: string;
  task_id: number | null;
  priority: number;
}

export interface GeneratedSchedule {
  blocks: ScheduleBlock[];
  reasoning: string;
}

export interface SavedSchedule {
  id: number;
  date: string;
  blocks: string;
  reasoning: string;
  created_at: string;
}
