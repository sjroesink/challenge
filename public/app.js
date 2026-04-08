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
  let selectedDay = null; // null = default (today)
  let latestData = null;
  let checkinBtnBound = false;

  async function init() {
    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register('/sw.js');
      } catch (err) {
        console.error('SW registration failed:', err);
      }
    }

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
    setInterval(loadProgress, 60000);
  }

  function setupNotifications() {
    const btn = document.getElementById('notify-btn');
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!code) return;
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
      headers: { 'Content-Type': 'application/json', 'X-Participant-Code': code },
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
    latestData = data;
    renderBadge(myName);
    renderDayView();
    renderTable(data);
  }

  function getMyCheckin(day) {
    if (!latestData || !myName) return null;
    return latestData.checkins.find(c => c.name === myName && c.day === day) || null;
  }

  function renderBadge(name) {
    const badge = document.getElementById('user-badge');
    if (!name) return;
    badge.innerHTML = `Ingelogd als <strong>${name}</strong>`;
    badge.classList.remove('hidden');
  }

  /**
   * Decide what to show in the check-in/gimmick area:
   * - Past day selected + done → show stored gimmick (with back button)
   * - Past day selected + not done → show check-in form for that day
   * - No selection (default) → today: show gimmick if done, else form
   */
  function renderDayView() {
    const checkinSection = document.getElementById('checkin-section');
    const gimmickEl = document.getElementById('gimmick');
    if (!myName || !latestData) {
      checkinSection.classList.add('hidden');
      gimmickEl.classList.add('hidden');
      return;
    }

    const today = latestData.today;
    const day = selectedDay ?? today;
    const mine = getMyCheckin(day);

    if (mine) {
      checkinSection.classList.add('hidden');
      showGimmickView(day, mine.gimmickText, mine.gimmickVideo, day !== today);
    } else {
      gimmickEl.classList.add('hidden');
      showCheckinForm(day, day === today);
    }
  }

  function showCheckinForm(day, isToday) {
    const section = document.getElementById('checkin-section');
    document.getElementById('checkin-label').textContent =
      isToday ? `Vandaag \u2014 Dag ${day}` : `Inhalen \u2014 Dag ${day}`;
    document.getElementById('checkin-day').textContent =
      `${day} push-up${day === 1 ? '' : 's'}`;
    section.classList.remove('hidden');
    bindCheckinBtn();
  }

  function showGimmickView(day, text, videoId, showBack) {
    const el = document.getElementById('gimmick');
    const isToday = latestData && day === latestData.today;
    const label = isToday ? `Vandaag \u2014 Dag ${day}` : `Dag ${day}`;
    const safeText = text ? escapeHtml(text) : 'Gehaald! 💪';
    const videoHtml = videoId
      ? `<div class="gimmick-video"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}" title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
      : '';
    const backHtml = showBack
      ? `<button type="button" class="gimmick-back" id="gimmick-back-btn">\u2190 Terug naar vandaag</button>`
      : '';
    el.innerHTML = `
      <div class="gimmick-label">${label} \u2014 Gehaald ✅</div>
      <div class="gimmick-text">${safeText}</div>
      ${videoHtml}
      ${backHtml}
    `;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight;
    el.style.animation = '';

    if (showBack) {
      document.getElementById('gimmick-back-btn').addEventListener('click', () => {
        selectedDay = null;
        renderDayView();
      });
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function bindCheckinBtn() {
    if (checkinBtnBound) return;
    checkinBtnBound = true;
    const btn = document.getElementById('checkin-btn');
    const input = document.getElementById('sets-input');

    btn.addEventListener('click', async () => {
      const sets = parseInt(input.value, 10);
      if (!sets || sets < 1) return;
      const today = latestData ? latestData.today : null;
      const day = selectedDay ?? today;
      if (day === null) return;

      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'Bezig...';

      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Participant-Code': code },
        body: JSON.stringify({ sets, day }),
      });

      btn.disabled = false;
      btn.textContent = originalText;

      if (res.ok) {
        // After submission, go back to default view (today). renderDayView
        // will show today's gimmick if the submitted day was today, or the
        // form for today if the submission was a backfill.
        selectedDay = null;
        await loadProgress();
      } else {
        const err = await res.json();
        alert(err.error || 'Er ging iets mis');
      }
    });
  }

  function renderTable(data) {
    const head = document.getElementById('progress-head');
    const body = document.getElementById('progress-body');

    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th>Dag</th>';
    data.participants.forEach(name => {
      const th = document.createElement('th');
      th.textContent = name;
      headerRow.appendChild(th);
    });
    head.innerHTML = '';
    head.appendChild(headerRow);

    // Lookup by "name:day" → checkin object (not just sets)
    const lookup = {};
    data.checkins.forEach(c => {
      lookup[`${c.name}:${c.day}`] = c;
    });

    body.innerHTML = '';
    for (let day = data.today; day >= 1; day--) {
      const tr = document.createElement('tr');
      if (day === data.today) tr.classList.add('day-today');

      const dayTd = document.createElement('td');
      dayTd.innerHTML = `<span class="day-num">Dag ${day}</span>${day === data.today ? '<span class="today-label">vandaag</span>' : ''}`;
      tr.appendChild(dayTd);

      data.participants.forEach(name => {
        const td = document.createElement('td');
        const key = `${name}:${day}`;
        const entry = lookup[key];
        if (entry) {
          td.innerHTML = `<span class="cell-done">\u2713</span> <span class="cell-sets">${entry.sets}s</span>`;
        } else if (day < data.today) {
          td.innerHTML = '<span class="cell-missed">\u2717</span>';
        } else {
          td.innerHTML = '<span class="cell-pending">\u2014</span>';
        }
        // Own cells are clickable: either backfill (not done) or re-view gimmick (done)
        if (name === myName) {
          td.classList.add('cell-clickable');
          td.title = entry ? `Bekijk dag ${day}` : `Inchecken voor dag ${day}`;
          td.addEventListener('click', () => {
            selectedDay = day === data.today ? null : day;
            renderDayView();
            const target = entry
              ? document.getElementById('gimmick')
              : document.getElementById('checkin-section');
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (!entry) document.getElementById('sets-input').focus();
          });
        }
        tr.appendChild(td);
      });

      body.appendChild(tr);
    }
  }

  init();
})();
