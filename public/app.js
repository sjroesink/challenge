(function () {
  // Check for code in URL path (e.g. /sandoor)
  const path = window.location.pathname.slice(1);
  if (path && !path.includes('.') && !path.startsWith('api')) {
    localStorage.setItem('participant-code', path);
    window.history.replaceState({}, '', '/');
  }

  const code = localStorage.getItem('participant-code');
  let myName = null;
  let swRegistration = null;

  async function init() {
    // Register service worker for PWA + push
    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register('/sw.js');
      } catch (err) {
        console.error('SW registration failed:', err);
      }
    }

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
    setupNotifications();
    loadProgress();
    // Light polling for UI refresh (every 60s)
    setInterval(loadProgress, 60000);
  }

  function setupNotifications() {
    const btn = document.getElementById('notify-btn');
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!code) return; // Need login to subscribe
    btn.classList.remove('hidden');
    updateNotifyBtn();
    btn.addEventListener('click', async () => {
      if (Notification.permission === 'denied') {
        alert('Notificaties zijn geblokkeerd. Sta ze toe in je browserinstellingen.');
        return;
      }
      if (Notification.permission === 'default') {
        const result = await Notification.requestPermission();
        if (result !== 'granted') return;
      }
      await subscribeToPush();
      updateNotifyBtn();
    });

    // Auto-subscribe if already granted
    if (Notification.permission === 'granted') {
      subscribeToPush().catch(err => console.error('Subscribe failed:', err));
    }
  }

  async function subscribeToPush() {
    if (!swRegistration) return;
    const keyRes = await fetch('/api/push/key');
    const { publicKey } = await keyRes.json();

    let subscription = await swRegistration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Participant-Code': code,
      },
      body: JSON.stringify({ subscription }),
    });
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  function updateNotifyBtn() {
    const btn = document.getElementById('notify-btn');
    if (Notification.permission === 'granted') {
      btn.classList.add('active');
      btn.title = 'Notificaties staan aan';
    } else {
      btn.classList.remove('active');
      btn.title = 'Notificaties inschakelen';
    }
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
