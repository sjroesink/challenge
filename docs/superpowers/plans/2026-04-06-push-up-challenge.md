# Push-Up Challenge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web app where 4-8 participants track daily push-up completions, with per-day check-ins showing sets used.

**Architecture:** Fastify monolith serving a vanilla HTML/CSS/JS frontend. SQLite via better-sqlite3 for check-in storage. Participant list loaded from a JSON config file. Single Docker container deployment.

**Tech Stack:** Node.js, Fastify, better-sqlite3, vanilla HTML/CSS/JS, Docker

---

## File Structure

```
push-up-challenge/
  package.json
  participants.json          # Participant config (code + name)
  src/
    server.js                # Fastify setup, static serving, route registration
    db.js                    # SQLite init + query helpers
    routes.js                # API routes + code redirect
    day.js                   # Day number calculation (Amsterdam timezone)
  public/
    index.html               # Single page frontend
    style.css                # Dark/light theme styles
    app.js                   # Frontend logic (fetch, render, check-in)
  test/
    day.test.js              # Day calculation tests
    routes.test.js           # API endpoint tests
  Dockerfile
  .dockerignore
```

---

### Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `participants.json`
- Create: `.dockerignore`
- Create: `.gitignore`

- [ ] **Step 1: Initialize project**

```bash
cd D:/Projects/push-up-challenge
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "push-up-challenge",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "fastify": "^5.0.0",
    "@fastify/static": "^8.0.0"
  }
}
```

- [ ] **Step 3: Create participants.json**

```json
[
  { "code": "sander", "name": "Sander" },
  { "code": "deelnemer2", "name": "Deelnemer 2" }
]
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
data/
.superpowers/
```

- [ ] **Step 5: Create .dockerignore**

```
node_modules/
data/
.git/
.superpowers/
docs/
test/
```

- [ ] **Step 6: Install dependencies**

```bash
npm install
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json participants.json .gitignore .dockerignore
git commit -m "chore: initialize project with dependencies"
```

---

### Task 2: Day Calculation Module

**Files:**
- Create: `src/day.js`
- Create: `test/day.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/day.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentDay, START_DATE } from '../src/day.js';

describe('getCurrentDay', () => {
  it('returns 1 on April 1 2026', () => {
    const april1 = new Date('2026-04-01T12:00:00+02:00');
    assert.equal(getCurrentDay(april1), 1);
  });

  it('returns 6 on April 6 2026', () => {
    const april6 = new Date('2026-04-06T15:00:00+02:00');
    assert.equal(getCurrentDay(april6), 6);
  });

  it('returns 1 on April 1 at midnight Amsterdam time', () => {
    const midnight = new Date('2026-04-01T00:00:00+02:00');
    assert.equal(getCurrentDay(midnight), 1);
  });

  it('returns 2 on April 2 at 00:01 Amsterdam time', () => {
    const justAfterMidnight = new Date('2026-04-02T00:01:00+02:00');
    assert.equal(getCurrentDay(justAfterMidnight), 2);
  });

  it('handles late night UTC that is next day in Amsterdam (CEST)', () => {
    // April 5 at 23:00 UTC = April 6 at 01:00 CEST
    const lateUtc = new Date('2026-04-05T23:00:00Z');
    assert.equal(getCurrentDay(lateUtc), 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — `src/day.js` does not exist.

- [ ] **Step 3: Write implementation**

Create `src/day.js`:

```javascript
const START_DATE = '2026-04-01';

function getCurrentDay(now = new Date()) {
  // Get the date in Amsterdam timezone
  const amsterdamDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
  const startDate = new Date(`${START_DATE}T00:00:00`);

  // Calculate Amsterdam-local start of day for both
  const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const currentDay = new Date(amsterdamDate.getFullYear(), amsterdamDate.getMonth(), amsterdamDate.getDate());

  const diffMs = currentDay - startDay;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return diffDays + 1;
}

export { getCurrentDay, START_DATE };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/day.js test/day.test.js
git commit -m "feat: add day calculation with Amsterdam timezone support"
```

---

### Task 3: Database Module

**Files:**
- Create: `src/db.js`

- [ ] **Step 1: Create database module**

Create `src/db.js`:

```javascript
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

let db;

function getDb() {
  if (db) return db;

  const dbPath = join(process.cwd(), 'data', 'challenge.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS checkins (
      code TEXT NOT NULL,
      day INTEGER NOT NULL,
      sets INTEGER NOT NULL,
      checked_at TEXT NOT NULL,
      PRIMARY KEY (code, day)
    )
  `);

  return db;
}

function getAllCheckins() {
  return getDb().prepare('SELECT code, day, sets, checked_at FROM checkins ORDER BY day DESC').all();
}

function getCheckin(code, day) {
  return getDb().prepare('SELECT code, day, sets, checked_at FROM checkins WHERE code = ? AND day = ?').get(code, day);
}

function insertCheckin(code, day, sets) {
  const checked_at = new Date().toISOString();
  getDb().prepare('INSERT INTO checkins (code, day, sets, checked_at) VALUES (?, ?, ?, ?)').run(code, day, sets, checked_at);
  return { code, day, sets, checked_at };
}

export { getDb, getAllCheckins, getCheckin, insertCheckin };
```

- [ ] **Step 2: Commit**

```bash
git add src/db.js
git commit -m "feat: add SQLite database module with checkin queries"
```

---

### Task 4: API Routes

**Files:**
- Create: `src/routes.js`
- Create: `test/routes.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/routes.test.js`:

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import Fastify from 'fastify';

// Use a test database
process.env.NODE_ENV = 'test';

// We'll test the routes by building the app
import { registerRoutes } from '../src/routes.js';
import { getCurrentDay } from '../src/day.js';

const participants = JSON.parse(readFileSync('participants.json', 'utf-8'));

describe('API Routes', () => {
  let app;

  before(async () => {
    // Clean test db
    rmSync('data/challenge-test.db', { force: true });

    app = Fastify();
    registerRoutes(app, participants);
    await app.ready();
  });

  after(async () => {
    await app.close();
    rmSync('data/challenge-test.db', { force: true });
  });

  describe('GET /api/progress', () => {
    it('returns participants and empty checkins', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/progress' });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(Array.isArray(body.participants));
      assert.ok(Array.isArray(body.checkins));
      assert.equal(typeof body.today, 'number');
    });
  });

  describe('POST /api/checkin', () => {
    it('rejects missing code header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        payload: { sets: 2 }
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects invalid code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        headers: { 'x-participant-code': 'doesnotexist' },
        payload: { sets: 2 }
      });
      assert.equal(res.statusCode, 401);
    });

    it('rejects invalid sets', async () => {
      const code = participants[0].code;
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        headers: { 'x-participant-code': code },
        payload: { sets: 0 }
      });
      assert.equal(res.statusCode, 400);
    });

    it('accepts valid checkin', async () => {
      const code = participants[0].code;
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        headers: { 'x-participant-code': code },
        payload: { sets: 3 }
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.success, true);
      assert.equal(body.sets, 3);
      assert.equal(body.day, getCurrentDay());
    });

    it('rejects duplicate checkin for same day', async () => {
      const code = participants[0].code;
      const res = await app.inject({
        method: 'POST',
        url: '/api/checkin',
        headers: { 'x-participant-code': code },
        payload: { sets: 2 }
      });
      assert.equal(res.statusCode, 409);
    });
  });

  describe('GET /:code', () => {
    it('redirects valid code to /', async () => {
      const code = participants[0].code;
      const res = await app.inject({ method: 'GET', url: `/${code}` });
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location, `/?code=${code}`);
    });

    it('returns 404 for invalid code', async () => {
      const res = await app.inject({ method: 'GET', url: '/invalidcode' });
      assert.equal(res.statusCode, 404);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — `src/routes.js` does not exist.

- [ ] **Step 3: Write implementation**

Create `src/routes.js`:

```javascript
import { getCurrentDay } from './day.js';
import { getAllCheckins, getCheckin, insertCheckin } from './db.js';

function registerRoutes(app, participants) {
  const codeSet = new Set(participants.map(p => p.code));

  // Progress endpoint — public
  app.get('/api/progress', async () => {
    const today = getCurrentDay();
    const checkins = getAllCheckins();
    return {
      participants: participants.map(p => ({ code: p.code, name: p.name })),
      checkins,
      today
    };
  });

  // Check-in endpoint — requires valid code
  app.post('/api/checkin', async (request, reply) => {
    const code = request.headers['x-participant-code'];
    if (!code || !codeSet.has(code)) {
      return reply.status(401).send({ error: 'Invalid participant code' });
    }

    const sets = request.body?.sets;
    if (!sets || typeof sets !== 'number' || sets < 1 || !Number.isInteger(sets)) {
      return reply.status(400).send({ error: 'Sets must be a positive integer' });
    }

    const today = getCurrentDay();
    const existing = getCheckin(code, today);
    if (existing) {
      return reply.status(409).send({ error: 'Already checked in today' });
    }

    insertCheckin(code, today, sets);
    return { success: true, day: today, sets };
  });

  // Code redirect — must be registered last (catch-all single segment)
  app.get('/:code', async (request, reply) => {
    const { code } = request.params;

    // Skip static files and api routes
    if (code.includes('.') || code === 'api') {
      return reply.status(404).send({ error: 'Not found' });
    }

    if (!codeSet.has(code)) {
      return reply.status(404).send({ error: 'Unknown participant code' });
    }

    return reply.redirect(`/?code=${code}`);
  });
}

export { registerRoutes };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes.js test/routes.test.js
git commit -m "feat: add API routes for progress, checkin, and code redirect"
```

---

### Task 5: Server Entry Point

**Files:**
- Create: `src/server.js`

- [ ] **Step 1: Create server**

Create `src/server.js`:

```javascript
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerRoutes } from './routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const participants = JSON.parse(readFileSync(join(__dirname, '..', 'participants.json'), 'utf-8'));

const app = Fastify({ logger: true });

// Serve static files from public/
await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  prefix: '/',
});

// Register API and redirect routes
registerRoutes(app, participants);

const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

try {
  await app.listen({ port, host });
  console.log(`Server running on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server.js
git commit -m "feat: add Fastify server entry point with static file serving"
```

---

### Task 6: Frontend — HTML + CSS

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`

- [ ] **Step 1: Create index.html**

Create `public/index.html`:

```html
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Push-Up Challenge</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>Push-Up Challenge</h1>
      <div id="user-badge" class="badge hidden"></div>
    </header>

    <section id="checkin-section" class="checkin hidden">
      <div class="checkin-info">
        <div class="checkin-label">Vandaag</div>
        <div class="checkin-day" id="checkin-day"></div>
      </div>
      <div class="checkin-action">
        <label class="sets-label">
          Sets:
          <input type="number" id="sets-input" min="1" value="1" />
        </label>
        <button id="checkin-btn" class="btn-checkin">Gehaald!</button>
      </div>
    </section>

    <section id="progress-section">
      <table id="progress-table">
        <thead id="progress-head"></thead>
        <tbody id="progress-body"></tbody>
      </table>
    </section>
  </div>

  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create style.css**

Create `public/style.css`:

```css
:root {
  --bg: #0f1117;
  --bg-surface: #1a1f2e;
  --bg-elevated: #1e293b;
  --text: #e2e8f0;
  --text-muted: #94a3b8;
  --text-dim: #64748b;
  --text-dimmer: #475569;
  --border: #1e2533;
  --accent: #38bdf8;
  --success: #22c55e;
  --danger: #ef4444;
  --checkin-bg: linear-gradient(135deg, #1e3a5f 0%, #1a2744 100%);
  --checkin-border: rgba(37, 99, 235, 0.27);
  --input-bg: #0f172a;
  --input-border: #334155;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #f8fafc;
    --bg-surface: #ffffff;
    --bg-elevated: #f1f5f9;
    --text: #0f172a;
    --text-muted: #475569;
    --text-dim: #64748b;
    --text-dimmer: #94a3b8;
    --border: #e2e8f0;
    --accent: #0284c7;
    --success: #16a34a;
    --danger: #dc2626;
    --checkin-bg: linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%);
    --checkin-border: rgba(37, 99, 235, 0.2);
    --input-bg: #ffffff;
    --input-border: #cbd5e1;
  }
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

.container {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 16px;
}

/* Header */
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 0;
  border-bottom: 1px solid var(--border);
}

header h1 {
  font-size: 20px;
  letter-spacing: -0.5px;
}

.badge {
  background: var(--bg-elevated);
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  color: var(--text-muted);
}

.badge strong {
  color: var(--accent);
  font-weight: 600;
}

/* Check-in */
.checkin {
  margin: 20px 0;
  background: var(--checkin-bg);
  border: 1px solid var(--checkin-border);
  border-radius: 12px;
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.checkin-label {
  font-size: 12px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 4px;
}

.checkin-day {
  font-size: 20px;
  font-weight: 700;
}

.checkin-action {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sets-label {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-muted);
}

.sets-label input {
  background: var(--bg-elevated);
  color: var(--text);
  border: 1px solid var(--input-border);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 15px;
  font-weight: 600;
  width: 50px;
  text-align: center;
}

.btn-checkin {
  background: var(--success);
  color: #052e16;
  font-weight: 700;
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.btn-checkin:hover {
  filter: brightness(1.1);
}

.btn-checkin:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Progress table */
#progress-section {
  margin: 20px 0 40px;
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

thead th {
  text-align: center;
  padding: 10px 12px;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 13px;
  border-bottom: 2px solid var(--border);
}

thead th:first-child {
  text-align: left;
  color: var(--text-dim);
  font-weight: 500;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

tbody tr {
  border-bottom: 1px solid var(--border);
}

tbody td {
  padding: 10px 12px;
  text-align: center;
}

tbody td:first-child {
  text-align: left;
  color: var(--text-muted);
  font-weight: 500;
}

.day-today td:first-child {
  color: var(--accent);
  font-weight: 700;
}

.day-today {
  background: rgba(30, 41, 59, 0.27);
}

.cell-done {
  color: var(--success);
}

.cell-sets {
  color: var(--text-dim);
  font-size: 12px;
  margin-left: 2px;
}

.cell-missed {
  color: var(--danger);
}

.cell-pending {
  color: var(--text-dimmer);
}

.today-label {
  color: var(--text-dimmer);
  font-size: 12px;
  margin-left: 6px;
  font-weight: 400;
}

.hidden {
  display: none !important;
}
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add HTML structure and dark/light theme CSS"
```

---

### Task 7: Frontend — JavaScript

**Files:**
- Create: `public/app.js`

- [ ] **Step 1: Create app.js**

Create `public/app.js`:

```javascript
(function () {
  // Check for code in URL query param (from redirect)
  const params = new URLSearchParams(window.location.search);
  const codeFromUrl = params.get('code');
  if (codeFromUrl) {
    localStorage.setItem('participant-code', codeFromUrl);
    // Clean URL
    window.history.replaceState({}, '', '/');
  }

  const code = localStorage.getItem('participant-code');

  async function loadProgress() {
    const res = await fetch('/api/progress');
    const data = await res.json();
    renderBadge(data, code);
    renderCheckin(data, code);
    renderTable(data, code);
  }

  function renderBadge(data, code) {
    const badge = document.getElementById('user-badge');
    if (!code) return;
    const participant = data.participants.find(p => p.code === code);
    if (!participant) return;
    badge.innerHTML = `Ingelogd als <strong>${participant.name}</strong>`;
    badge.classList.remove('hidden');
  }

  function renderCheckin(data, code) {
    const section = document.getElementById('checkin-section');
    if (!code) return;

    const participant = data.participants.find(p => p.code === code);
    if (!participant) return;

    const today = data.today;
    const alreadyDone = data.checkins.some(c => c.code === code && c.day === today);
    if (alreadyDone) return;

    document.getElementById('checkin-day').textContent =
      `Dag ${today} \u2014 ${today} push-up${today === 1 ? '' : 's'}`;

    section.classList.remove('hidden');

    const btn = document.getElementById('checkin-btn');
    const input = document.getElementById('sets-input');

    btn.addEventListener('click', async () => {
      const sets = parseInt(input.value, 10);
      if (!sets || sets < 1) return;

      btn.disabled = true;
      btn.textContent = 'Bezig...';

      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Participant-Code': code,
        },
        body: JSON.stringify({ sets }),
      });

      if (res.ok) {
        section.classList.add('hidden');
        loadProgress();
      } else {
        btn.disabled = false;
        btn.textContent = 'Gehaald!';
        const err = await res.json();
        alert(err.error || 'Er ging iets mis');
      }
    });
  }

  function renderTable(data, code) {
    const head = document.getElementById('progress-head');
    const body = document.getElementById('progress-body');

    // Build header
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th>Dag</th>';
    data.participants.forEach(p => {
      const th = document.createElement('th');
      th.textContent = p.name;
      headerRow.appendChild(th);
    });
    head.innerHTML = '';
    head.appendChild(headerRow);

    // Build checkin lookup: { "code:day": sets }
    const lookup = {};
    data.checkins.forEach(c => {
      lookup[`${c.code}:${c.day}`] = c.sets;
    });

    // Build rows (newest day first)
    body.innerHTML = '';
    for (let day = data.today; day >= 1; day--) {
      const tr = document.createElement('tr');
      if (day === data.today) tr.classList.add('day-today');

      // Day label
      const dayTd = document.createElement('td');
      dayTd.innerHTML = `Dag ${day}${day === data.today ? '<span class="today-label">vandaag</span>' : ''}`;
      tr.appendChild(dayTd);

      // Each participant
      data.participants.forEach(p => {
        const td = document.createElement('td');
        const key = `${p.code}:${day}`;
        if (lookup[key] !== undefined) {
          td.innerHTML = `<span class="cell-done">\u2713</span> <span class="cell-sets">${lookup[key]}s</span>`;
        } else if (day < data.today) {
          td.innerHTML = '<span class="cell-missed">\u2717</span>';
        } else {
          td.innerHTML = '<span class="cell-pending">\u2014</span>';
        }
        tr.appendChild(td);
      });

      body.appendChild(tr);
    }
  }

  loadProgress();
})();
```

- [ ] **Step 2: Start the server and manually test**

```bash
npm start
```

Open `http://localhost:3000` — should show the table with no check-ins.
Open `http://localhost:3000/sander` — should redirect to `/?code=sander`, store in localStorage, show check-in block.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: add frontend JavaScript for progress display and check-in"
```

---

### Task 8: Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create Dockerfile**

Create `Dockerfile`:

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ src/
COPY public/ public/
COPY participants.json .

EXPOSE 3000
ENV HOST=0.0.0.0
ENV PORT=3000

CMD ["node", "src/server.js"]
```

- [ ] **Step 2: Verify build**

```bash
docker build -t push-up-challenge .
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: add Dockerfile for single-container deployment"
```

---

### Task 9: End-to-End Smoke Test

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 2: Start server and test full flow manually**

```bash
npm start
```

1. Open `http://localhost:3000` — see empty grid, no check-in block
2. Open `http://localhost:3000/sander` — redirect to `/`, see badge + check-in block
3. Enter sets, click "Gehaald!" — check-in block disappears, grid updates
4. Refresh — still logged in, check-in block gone (already done today)
5. Check grid shows the check-in with sets count

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup and smoke test verification"
```
