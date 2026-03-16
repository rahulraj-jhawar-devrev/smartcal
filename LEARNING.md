# SmartCal — Build Journal & Learning Notes

A running record of every architectural decision, concept, and step taken
while building SmartCal from scratch. Written to be readable by someone
learning backend + iOS development as they go.

---

## Table of Contents

1. [What We Are Building](#1-what-we-are-building)
2. [The Backend Stack](#2-the-backend-stack)
3. [Setting Up AWS EC2](#3-setting-up-aws-ec2)
4. [Building the REST API](#4-building-the-rest-api)
5. [Connecting to Claude (the AI brain)](#5-connecting-to-claude-the-ai-brain)
6. [GitHub + Auto-Deploy (CI/CD)](#6-github--auto-deploy-cicd)
7. [Migrating to TypeScript](#7-migrating-to-typescript)
8. [HTTPS with nginx + Let's Encrypt](#8-https-with-nginx--lets-encrypt)
9. [Monolith vs Microservices](#9-monolith-vs-microservices)
10. [iOS App — Coming Next](#10-ios-app--coming-next)

---

## 1. What We Are Building

SmartCal is an AI-powered calendar iOS app. You give it your tasks and
personal constraints (when you wake up, gym schedule, deep work window etc.)
and it uses Claude to generate a time-blocked schedule for your day.

```
User adds tasks
       +
User sets constraints (wake 7am, gym at 6pm, deep work 9-12)
       │
       ▼
POST /plan/today  →  Claude thinks  →  returns time-blocked schedule
       │
       ▼
iOS app renders it as a Google Calendar-style timeline
```

---

## 2. The Backend Stack

| Layer       | Technology          | Why                                          |
|-------------|---------------------|----------------------------------------------|
| Runtime     | Node.js             | Fast to write, great ecosystem               |
| Framework   | Express             | Minimal HTTP framework, industry standard    |
| Database    | SQLite (better-sqlite3) | No separate DB server needed, fast for single-user app |
| Language    | TypeScript          | Type safety, catches bugs at compile time    |
| AI          | Claude Haiku + extended thinking | Cheap, fast, good reasoning |
| Server      | AWS EC2 t3.small (Mumbai) | $15/month, always-on                  |
| Process mgr | systemd             | Keeps the Node process alive, auto-restarts  |

### Why SQLite instead of PostgreSQL?
For a single-user personal app, SQLite is perfect — it's a file on disk, no
separate database server to manage, and better-sqlite3 is synchronous
(simpler code). PostgreSQL makes sense when you have multiple users or need
concurrent writes at scale.

---

## 3. Setting Up AWS EC2

### What is EC2?
EC2 (Elastic Compute Cloud) is just a virtual machine in AWS's data centre.
You rent it by the hour. We picked Mumbai (ap-south-1) for low latency from India.

### What we did step by step:
1. Created an IAM user `smartcal-api` with only EC2 permissions (least privilege)
2. Launched a `t3.small` instance with Amazon Linux 2023
3. Created a security group (firewall) opening ports: 22 (SSH), 80 (HTTP), 443 (HTTPS), 3001 (API)
4. Downloaded the `.pem` keypair — this is your password to SSH into the server

### Connecting to the server:
```bash
ssh -i ~/Downloads/smartcal-key.pem ec2-user@43.205.131.137
```

### What is a .pem file?
It's a private SSH key. AWS puts the matching public key on the server when
you create the instance. SSH uses asymmetric cryptography — your private key
proves your identity without sending a password over the wire.

### Running the app persistently with systemd:
Without a process manager, your Node app dies when you close the SSH session.
systemd is Linux's built-in service manager. We created a service file at:
`~/.config/systemd/user/smartcal.service`

```ini
[Service]
WorkingDirectory=/home/ec2-user/smartcal
ExecStart=/usr/bin/node dist/index.js
Restart=always          ← restarts if it crashes
Environment=PORT=3001
Environment=ANTHROPIC_API_KEY=...
```

Key commands:
```bash
systemctl --user start smartcal    # start
systemctl --user stop smartcal     # stop
systemctl --user restart smartcal  # restart
systemctl --user status smartcal   # check if running + see logs
```

---

## 4. Building the REST API

### What is a REST API?
A set of URLs your app can call to create, read, update, delete data.
Each URL is a "resource". HTTP methods say what you want to do with it.

```
GET    /tasks         → read all tasks
POST   /tasks         → create a task
PATCH  /tasks/5       → update task with id=5
DELETE /tasks/5       → delete task with id=5
```

### Our full API surface:

| Method | Path               | What it does                              |
|--------|--------------------|-------------------------------------------|
| GET    | /health            | Check server is alive                     |
| GET    | /tasks             | List pending tasks (ordered by deadline)  |
| POST   | /tasks             | Add a task                                |
| PATCH  | /tasks/:id         | Update / mark complete                    |
| DELETE | /tasks/:id         | Delete a task                             |
| GET    | /constraints       | Get schedule constraints (wake time etc.) |
| PUT    | /constraints       | Update constraints                        |
| POST   | /plan/today        | Generate today's schedule via Claude      |
| GET    | /plan/:date        | Retrieve a saved schedule                 |
| POST   | /plan/:date/replan | Delete + regenerate a schedule            |

### File structure:
```
src/
  types.ts      ← TypeScript interfaces (Task, Constraint, ScheduleBlock...)
  db.ts         ← SQLite connection + table setup + seed data
  planner.ts    ← Claude API call + prompt logic
  index.ts      ← Express app + all route handlers
dist/           ← compiled JavaScript (TypeScript compiles here, gitignored)
```

---

## 5. Connecting to Claude (the AI brain)

### What is extended thinking?
Claude has a "thinking" mode where it reasons internally before answering,
like showing its work. This makes scheduling much better — it considers
deadlines, priorities, and constraints before placing blocks.

We use `claude-haiku-4-5-20251001` — the cheapest model that supports
extended thinking. Each planning call costs a fraction of a cent.

### The prompt strategy:
We give Claude:
- Fixed anchors: wake time, sleep time, gym, lunch
- Pending tasks: title, duration, priority, deadline (in days remaining)
- Rules: put urgent tasks in deep work window, add buffers, don't overpack

Claude returns a JSON schedule:
```json
{
  "blocks": [
    { "start": "09:00", "end": "11:00", "type": "task", "label": "Write report", "task_id": 3, "priority": 1 },
    { "start": "11:00", "end": "11:15", "type": "buffer", "label": "Break", "task_id": null, "priority": 0 }
  ],
  "reasoning": "Placed the report in the deep work window as it has a 1-day deadline..."
}
```

### Why parse with stripFences()?
LLMs sometimes wrap JSON in markdown code fences (```json ... ```) even when
told not to. `stripFences()` strips those before `JSON.parse()` so we never
crash on that.

---

## 6. GitHub + Auto-Deploy (CI/CD)

### What is CI/CD?
CI = Continuous Integration (automated checks on every push)
CD = Continuous Deployment (automatically ship passing code to production)

### Our setup:
```
git push origin main
        │
        ▼
GitHub Actions wakes up (reads .github/workflows/deploy.yml)
        │
        ▼
GitHub spins up a fresh Ubuntu VM
        │
        ▼
VM SSHes into our EC2 using stored secrets
        │
        ▼
Runs on EC2:
  git pull origin main
  npm install
  npm run build        ← compile TypeScript
  systemctl --user restart smartcal
```

### GitHub Secrets:
Credentials stored encrypted in GitHub, only accessible during workflow runs.
We use two:
- `EC2_HOST` = `43.205.131.137`
- `EC2_SSH_KEY` = contents of `smartcal-key.pem`

Find them at: Repo → Settings → Secrets and variables → Actions

### Why is this secure?
- Secrets are encrypted at rest by GitHub
- Never visible in logs or to other repos
- The SSH key was designed for exactly this use (EC2 keypair auth)

### How to add a test stage later:
Add a `test` job before `deploy` with `needs: test` on the deploy job.
Deploy only runs if tests pass.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm run build
      - run: npm test

  deploy:
    needs: test          ← this is the gate
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        ...
```

---

## 7. Migrating to TypeScript

### What is TypeScript?
TypeScript is JavaScript with types. You annotate variables and function
parameters with types (`string`, `number`, custom interfaces). A compiler
(`tsc`) checks everything is consistent before producing plain JavaScript.

### Why bother?
- Catches entire classes of bugs at compile time (wrong field name, missing property)
- Your editor can autocomplete properly because it knows the shape of every object
- Makes refactoring safe — if you rename a field, TypeScript shows you every
  place that breaks

### What we changed:
```
Before:                          After:
db.js                            src/db.ts
planner.js                       src/planner.ts
index.js                         src/index.ts
                                 src/types.ts  (new — shared interfaces)
                                 tsconfig.json (new — compiler config)
```

### The compile step:
```bash
npm run build   →   tsc   →   produces dist/ folder with plain .js files
npm start       →   node dist/index.js
```

`dist/` is gitignored — we never commit compiled output, only source.
The deploy workflow runs `npm run build` on the server after pulling.

### tsconfig highlights:
```json
{
  "strict": true,       ← maximum type checking
  "outDir": "./dist",   ← compiled files go here
  "rootDir": "./src"    ← source files are here
}
```

---

## 8. HTTPS with nginx + Let's Encrypt

### Why HTTPS?
iOS blocks plain HTTP (`http://`) calls to remote servers by default.
Without HTTPS, the iOS app can't talk to our backend.

### What is nginx?
nginx is a web server we put in front of our Node app. It handles:
- SSL termination (HTTPS → decrypts → forwards as plain HTTP to Node)
- Can later handle rate limiting, caching, load balancing

```
Internet  →  HTTPS :443  →  nginx  →  HTTP :3001  →  Node.js app
```

### What is Let's Encrypt?
A free Certificate Authority. It issues SSL certificates that browsers and
iOS trust. Certificates expire every 90 days but certbot auto-renews them.

### What is nip.io?
Let's Encrypt needs a domain name (not a bare IP). nip.io is a free wildcard
DNS service: `43.205.131.137.nip.io` automatically resolves to `43.205.131.137`.
This gives us a valid domain without buying one.

### What we did:
```bash
# Install nginx + certbot
sudo dnf install -y nginx certbot python3-certbot-nginx

# Configure nginx as reverse proxy (port 443 → port 3001)
# Created /etc/nginx/conf.d/smartcal.conf

# Get free SSL cert + auto-configure nginx
sudo certbot --nginx -d 43.205.131.137.nip.io

# Result:
https://43.205.131.137.nip.io/health  ✓
```

### The API base URL for the iOS app:
```
https://43.205.131.137.nip.io
```

---

## 9. Monolith vs Microservices

### Monolith (what we have):
Everything in one process, one codebase, one deployment.

```
┌─────────────────────────────────────┐
│         SmartCal Node process        │
│  tasks | constraints | planner      │
│              SQLite DB              │
└─────────────────────────────────────┘
         one EC2 instance
```

Pros: Simple to build, debug, deploy. Right choice for small teams + early stage.
Cons: You deploy everything even when only one part changed.

### Microservices (what large companies do):
Each responsibility is its own service, deployed independently.

```
API Gateway → Task Service → Tasks DB
           → Planner Service → Schedules DB
           → Constraint Service → Constraints DB
```

Pros: Scale individual services, independent deployments, team isolation.
Cons: Complex — distributed tracing, service discovery, network failures.

### When to split?
Only when a specific pain forces you to:
- The planner is slow and you want to scale it without scaling CRUD
- Separate teams working on separate features
- Different language needed for one service (e.g. Python for ML)

Rule: start monolith, split only when pain is real.

---

## 10. iOS App — Coming Next

### Plan:
```
Step 1 — NetworkClient.swift + Models.swift   (API layer)
Step 2 — Tasks tab                            (add / complete / delete)
Step 3 — Settings tab                         (constraints form)
Step 4 — Today tab                            (Google Calendar-style timeline)
Step 5 — Notifications                        (local, scheduled when plan arrives)
Step 6 — Polish
```

### The calendar view:
A custom SwiftUI ScrollView with time blocks rendered as colored rectangles.
Block height = duration. Block position = start time offset from top.
No third-party library needed — built with ZStack + GeometryReader.

### Notifications:
Local notifications via `UNUserNotificationCenter` — entirely on-device,
no extra backend. Scheduled when the plan is generated.

Two types:
1. Block reminder — "Deep Work starts in 10 minutes"
2. Morning briefing — "Your day is planned. 6 tasks, first block at 9am"

### API base URL:
```
https://43.205.131.137.nip.io
```

### Prerequisite:
Xcode installed from the Mac App Store (~10GB download).
