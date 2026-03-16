# SmartCal Backend

AI-powered smart calendar API. Uses Claude (extended thinking) to generate time-blocked schedules from your task list and personal constraints.

## Stack
- Node.js + Express
- SQLite (better-sqlite3)
- Claude Haiku with extended thinking (Anthropic SDK)

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /tasks | List pending tasks |
| POST | /tasks | Add a task |
| PATCH | /tasks/:id | Update / complete a task |
| DELETE | /tasks/:id | Delete a task |
| GET | /constraints | Get schedule constraints |
| PUT | /constraints | Update constraints |
| POST | /plan/today | Generate today's schedule via LLM |
| GET | /plan/:date | Get saved schedule for a date |
| POST | /plan/:date/replan | Delete + regenerate a schedule |

## Deploy

Pushes to `main` auto-deploy to EC2 via GitHub Actions (SSH).

### Required GitHub Secrets
- `EC2_HOST` — public IP of the EC2 instance
- `EC2_SSH_KEY` — contents of the `.pem` private key file

## Environment Variables
- `ANTHROPIC_API_KEY` — set in systemd service on the server
- `PORT` — defaults to 3001
