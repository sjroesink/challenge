(function () {
  // Check for code in URL path (e.g. /sandoor)
  const path = window.location.pathname.slice(1);
  if (path && !path.includes('.') && !path.startsWith('api')) {
    localStorage.setItem('participant-code', path);
    window.history.replaceState({}, '', '/');
  }

  const code = localStorage.getItem('participant-code');
  let myName = null;

  async function init() {
    // Resolve own name from code
    if (code) {
      const meRes = await fetch('/api/me', {
        headers: { 'X-Participant-Code': code },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        myName = me.name;
      }
    }
    loadProgress();
  }

  async function loadProgress() {
    const res = await fetch('/api/progress');
    const data = await res.json();
    renderBadge(myName);
    renderCheckin(data, myName);
    renderTable(data);
  }

  function renderBadge(name) {
    const badge = document.getElementById('user-badge');
    if (!name) return;
    badge.innerHTML = `Ingelogd als <strong>${name}</strong>`;
    badge.classList.remove('hidden');
  }

  function renderCheckin(data, name) {
    const section = document.getElementById('checkin-section');
    if (!name) return;

    const today = data.today;
    const alreadyDone = data.checkins.some(c => c.name === name && c.day === today);
    if (alreadyDone) return;

    document.getElementById('checkin-label').textContent = `Vandaag \u2014 Dag ${today}`;
    document.getElementById('checkin-day').textContent =
      `${today} push-up${today === 1 ? '' : 's'}`;

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

  async function promptCheckin(day) {
    const setsStr = window.prompt(`In hoeveel sets heb je dag ${day} (${day} push-up${day === 1 ? '' : 's'}) gedaan?`, '1');
    if (setsStr === null) return;
    const sets = parseInt(setsStr, 10);
    if (!sets || sets < 1) {
      alert('Geef een geldig aantal sets op');
      return;
    }
    const res = await fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Participant-Code': code },
      body: JSON.stringify({ sets, day }),
    });
    if (res.ok) {
      loadProgress();
    } else {
      const err = await res.json();
      alert(err.error || 'Er ging iets mis');
    }
  }

  function renderTable(data) {
    const head = document.getElementById('progress-head');
    const body = document.getElementById('progress-body');

    // Build header
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th>Dag</th>';
    data.participants.forEach(name => {
      const th = document.createElement('th');
      th.textContent = name;
      headerRow.appendChild(th);
    });
    head.innerHTML = '';
    head.appendChild(headerRow);

    // Build checkin lookup: { "name:day": sets }
    const lookup = {};
    data.checkins.forEach(c => {
      lookup[`${c.name}:${c.day}`] = c.sets;
    });

    // Build rows (newest day first)
    body.innerHTML = '';
    for (let day = data.today; day >= 1; day--) {
      const tr = document.createElement('tr');
      if (day === data.today) tr.classList.add('day-today');

      // Day label
      const dayTd = document.createElement('td');
      dayTd.innerHTML = `<span class="day-num">Dag ${day}</span>${day === data.today ? '<span class="today-label">vandaag</span>' : ''}`;
      tr.appendChild(dayTd);

      // Each participant
      data.participants.forEach(name => {
        const td = document.createElement('td');
        const key = `${name}:${day}`;
        if (lookup[key] !== undefined) {
          td.innerHTML = `<span class="cell-done">\u2713</span> <span class="cell-sets">${lookup[key]}s</span>`;
        } else if (day < data.today) {
          td.innerHTML = '<span class="cell-missed">\u2717</span>';
        } else {
          td.innerHTML = '<span class="cell-pending">\u2014</span>';
        }
        // Make own cells clickable for backfill (today or past days, only if not done)
        if (name === myName && lookup[key] === undefined) {
          td.classList.add('cell-clickable');
          td.title = `Inchecken voor dag ${day}`;
          td.addEventListener('click', () => promptCheckin(day));
        }
        tr.appendChild(td);
      });

      body.appendChild(tr);
    }
  }

  init();
})();
