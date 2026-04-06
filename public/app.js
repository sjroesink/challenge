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
