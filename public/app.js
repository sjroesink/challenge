(function () {
  // Pick up code from path (/sander) once and persist.
  const path = window.location.pathname.slice(1);
  if (path && !path.includes('.') && !path.startsWith('api')) {
    localStorage.setItem('participant-code', path);
    window.history.replaceState({}, '', '/');
  }

  const code = localStorage.getItem('participant-code');
  let myName = null;
  let swRegistration = null;

  let progressData = null;       // latest /api/progress payload
  let viewState = null;          // { name, day } currently shown in cell-section
  let currentCell = null;        // latest /api/sets/:name/:day payload
  let editingSetId = null;       // id of set currently being inline-edited

  // ── Motion recording state (only meaningful while a set is being added) ──
  // 'unsupported' | 'idle' | 'recording' | 'captured'
  let recordState = 'idle';
  let recordBtnBound = false;
  let motionPermissionGranted = false;
  let motionListener = null;
  let recordStartedAt = null;
  let recordTimer = null;
  let wakeLock = null;
  let buf = null;
  let capturedMotion = null;
  const MAX_SAMPLES = 100000; // ~27 min @ 60 Hz

  async function init() {
    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register('/sw.js');
      } catch (err) {
        console.error('SW registration failed:', err);
      }
    }

    if (code) {
      const meRes = await fetch('/api/me', { headers: { 'X-Participant-Code': code } });
      if (meRes.ok) {
        const me = await meRes.json();
        myName = me.name;
      }
    }

    setupNotifications();
    bindCellClose();
    bindAddSet();
    bindMotionClose();
    setupRecordControllerOnce();

    await loadProgress();
    if (myName && progressData) {
      await openCell(myName, progressData.today, { silent: true });
    }
    setInterval(refreshAll, 60000);
  }

  // ── Notifications (unchanged from prior implementation) ─────────────────

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

  // ── Loading ─────────────────────────────────────────────────────────────

  async function loadProgress() {
    const res = await fetch('/api/progress');
    progressData = await res.json();
    renderBadge(myName);
    renderTable(progressData);
  }

  async function loadCurrentCell() {
    if (!viewState || !code) {
      currentCell = null;
      return;
    }
    const url = `/api/sets/${encodeURIComponent(viewState.name)}/${viewState.day}`;
    const res = await fetch(url, { headers: { 'X-Participant-Code': code } });
    if (!res.ok) {
      currentCell = null;
      return;
    }
    currentCell = await res.json();
  }

  async function refreshAll() {
    await loadProgress();
    if (viewState) {
      await loadCurrentCell();
      renderCellSection();
    }
  }

  function renderBadge(name) {
    const badge = document.getElementById('user-badge');
    if (!name) return;
    badge.innerHTML = `Ingelogd als <strong>${escapeHtml(name)}</strong>`;
    badge.classList.remove('hidden');
  }

  // ── Cell view ───────────────────────────────────────────────────────────

  async function openCell(name, day, { silent } = {}) {
    if (!code) return;
    viewState = { name, day };
    editingSetId = null;
    clearCapturedRecording();
    document.getElementById('motion-view').classList.add('hidden');
    await loadCurrentCell();
    renderCellSection();
    if (!silent) {
      document.getElementById('cell-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function closeCell() {
    if (!myName || !progressData) {
      viewState = null;
      document.getElementById('cell-section').classList.add('hidden');
      return;
    }
    openCell(myName, progressData.today, { silent: false });
  }

  function bindCellClose() {
    document.getElementById('cell-close-btn').addEventListener('click', closeCell);
  }

  function isDefaultView() {
    return viewState && progressData && viewState.name === myName && viewState.day === progressData.today;
  }

  function renderCellSection() {
    const section = document.getElementById('cell-section');
    if (!viewState || !currentCell || !progressData) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');

    const today = progressData.today;
    const isToday = viewState.day === today;
    const isOwn = currentCell.isOwn;
    const target = currentCell.target;
    const totalReps = currentCell.totalReps;
    const reached = totalReps >= target;

    const labelEl = document.getElementById('cell-label');
    labelEl.textContent = isOwn
      ? (isToday ? `Vandaag — Dag ${viewState.day}` : `Inhalen — Dag ${viewState.day}`)
      : `${viewState.name} — Dag ${viewState.day}${isToday ? ' (vandaag)' : ''}`;

    const metaEl = document.getElementById('cell-meta');
    metaEl.textContent = `Doel: ${target} reps`;

    const tallyEl = document.getElementById('cell-tally');
    const status = reached ? '✓ Gehaald' : `nog ${target - totalReps} te gaan`;
    tallyEl.innerHTML = `<strong>${totalReps}</strong> / ${target} reps · ${currentCell.numSets} ${currentCell.numSets === 1 ? 'set' : 'sets'} · ${status}`;
    tallyEl.classList.toggle('reached', reached);

    const fillEl = document.getElementById('cell-bar-fill');
    const pct = Math.min(100, target > 0 ? Math.round(100 * totalReps / target) : 0);
    fillEl.style.width = `${pct}%`;
    fillEl.classList.toggle('reached', reached);

    document.getElementById('cell-close-btn').classList.toggle('hidden', isDefaultView());

    renderSetsList();

    const addArea = document.getElementById('add-set-area');
    if (isOwn) {
      addArea.classList.remove('hidden');
      updateRecordVisibility(isToday);
    } else {
      addArea.classList.add('hidden');
      updateRecordVisibility(false);
    }
  }

  function renderSetsList() {
    const ul = document.getElementById('sets-list');
    ul.innerHTML = '';
    if (!currentCell) return;
    const { sets, isOwn } = currentCell;

    if (sets.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'sets-empty';
      const isToday = progressData && viewState && viewState.day === progressData.today;
      empty.textContent = isOwn
        ? `Nog geen setjes ${isToday ? 'vandaag' : 'voor deze dag'} — voeg er eentje toe.`
        : 'Nog geen setjes voor deze dag.';
      ul.appendChild(empty);
      return;
    }

    sets.forEach((s, idx) => {
      const li = document.createElement('li');
      li.className = 'set-item';
      li.dataset.id = String(s.id);

      const editing = editingSetId === s.id;
      const time = formatHHMM(s.recordedAt);
      const motionBtn = s.hasMotion
        ? `<button type="button" class="set-action set-motion" data-id="${s.id}" title="Bekijk beweging">📊</button>`
        : '';
      const ownActions = isOwn && !editing
        ? `<button type="button" class="set-action set-edit" data-id="${s.id}" title="Wijzig reps">✎</button>
           <button type="button" class="set-action set-delete" data-id="${s.id}" title="Verwijder">🗑️</button>`
        : '';
      const repsCell = editing
        ? `<span class="set-reps-edit">
             <input type="number" min="1" id="set-reps-input-${s.id}" value="${s.reps}" />
             <button type="button" class="set-action set-save" data-id="${s.id}" title="Opslaan">✓</button>
             <button type="button" class="set-action set-cancel" data-id="${s.id}" title="Annuleren">✕</button>
           </span>`
        : `<span class="set-reps"><strong>${s.reps}</strong> reps</span>`;

      li.innerHTML = `
        <span class="set-num">#${idx + 1}</span>
        ${repsCell}
        <span class="set-time">${time}</span>
        <span class="set-actions">${motionBtn}${ownActions}</span>
      `;
      ul.appendChild(li);
    });

    ul.querySelectorAll('.set-motion').forEach(btn => {
      btn.addEventListener('click', () => showMotionView(Number(btn.dataset.id)));
    });
    ul.querySelectorAll('.set-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        editingSetId = Number(btn.dataset.id);
        renderSetsList();
        const input = document.getElementById(`set-reps-input-${editingSetId}`);
        if (input) { input.focus(); input.select(); }
      });
    });
    ul.querySelectorAll('.set-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        editingSetId = null;
        renderSetsList();
      });
    });
    ul.querySelectorAll('.set-save').forEach(btn => {
      btn.addEventListener('click', () => handleSaveEdit(Number(btn.dataset.id)));
    });
    ul.querySelectorAll('.set-delete').forEach(btn => {
      btn.addEventListener('click', () => handleDeleteSet(Number(btn.dataset.id)));
    });
  }

  async function handleSaveEdit(id) {
    const input = document.getElementById(`set-reps-input-${id}`);
    if (!input) return;
    const reps = parseInt(input.value, 10);
    if (!Number.isInteger(reps) || reps < 1) {
      alert('Reps moet een positief getal zijn.');
      return;
    }
    const res = await fetch(`/api/sets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Participant-Code': code },
      body: JSON.stringify({ reps }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Wijzigen mislukt');
      return;
    }
    editingSetId = null;
    await refreshAll();
  }

  async function handleDeleteSet(id) {
    if (!confirm('Dit setje verwijderen? Bijbehorende opname gaat ook weg.')) return;
    const res = await fetch(`/api/sets/${id}`, {
      method: 'DELETE',
      headers: { 'X-Participant-Code': code },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Verwijderen mislukt');
      return;
    }
    await refreshAll();
  }

  function bindAddSet() {
    const btn = document.getElementById('add-set-btn');
    btn.addEventListener('click', handleAddSet);
  }

  async function handleAddSet() {
    if (!viewState || !currentCell?.isOwn) return;
    const input = document.getElementById('reps-input');
    const reps = parseInt(input.value, 10);
    if (!Number.isInteger(reps) || reps < 1) {
      alert('Vul een geldig aantal reps in.');
      return;
    }
    const btn = document.getElementById('add-set-btn');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Bezig...';

    const motion = capturedMotion;
    const payload = motion
      ? { day: viewState.day, reps, motion }
      : { day: viewState.day, reps };
    const res = await fetch('/api/sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Participant-Code': code },
      body: JSON.stringify(payload),
    });
    btn.disabled = false;
    btn.textContent = originalText;

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Toevoegen mislukt');
      return;
    }
    clearCapturedRecording();
    await refreshAll();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function formatHHMM(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Motion recording controller ─────────────────────────────────────────

  function setupRecordControllerOnce() {
    if (recordBtnBound) return;
    recordBtnBound = true;

    if (typeof DeviceMotionEvent === 'undefined') {
      recordState = 'unsupported';
      return;
    }

    const btn = document.getElementById('record-btn');
    btn.addEventListener('click', async () => {
      if (recordState === 'idle') await beginRecording();
      else if (recordState === 'recording') finishRecording();
      else if (recordState === 'captured') {
        clearCapturedRecording();
        await beginRecording();
      }
    });
    renderRecordUI();
  }

  function updateRecordVisibility(isToday) {
    const area = document.getElementById('record-area');
    if (!area) return;
    if (recordState === 'unsupported' || !isToday) {
      area.classList.add('hidden');
    } else {
      area.classList.remove('hidden');
    }
  }

  async function beginRecording() {
    try {
      if (!motionPermissionGranted &&
          typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function') {
        const result = await DeviceMotionEvent.requestPermission();
        if (result !== 'granted') {
          showRecordError('Geen toestemming voor bewegingssensoren');
          return;
        }
        motionPermissionGranted = true;
      } else {
        motionPermissionGranted = true;
      }
    } catch (err) {
      showRecordError('Bewegingssensoren niet beschikbaar');
      return;
    }

    buf = { t: [], ax: [], ay: [], az: [], lax: [], lay: [], laz: [], rx: [], ry: [], rz: [] };
    recordStartedAt = performance.now();
    motionListener = (e) => {
      if (buf.t.length >= MAX_SAMPLES) {
        finishRecording();
        return;
      }
      const t = Math.round(performance.now() - recordStartedAt);
      const ag = e.accelerationIncludingGravity || {};
      const a = e.acceleration || {};
      const r = e.rotationRate || {};
      buf.t.push(t);
      buf.ax.push(ag.x ?? 0);
      buf.ay.push(ag.y ?? 0);
      buf.az.push(ag.z ?? 0);
      buf.lax.push(a.x ?? 0);
      buf.lay.push(a.y ?? 0);
      buf.laz.push(a.z ?? 0);
      buf.rx.push(r.alpha ?? 0);
      buf.ry.push(r.beta ?? 0);
      buf.rz.push(r.gamma ?? 0);
    };
    window.addEventListener('devicemotion', motionListener);

    recordState = 'recording';
    requestWakeLock();
    startRecordTimer();
    renderRecordUI();
  }

  function finishRecording() {
    if (recordState !== 'recording') return;
    if (motionListener) {
      window.removeEventListener('devicemotion', motionListener);
      motionListener = null;
    }
    stopRecordTimer();
    releaseWakeLock();

    const durationMs = Math.max(0, Math.round(performance.now() - recordStartedAt));
    const sampleCount = buf ? buf.t.length : 0;

    if (!buf || sampleCount < 5) {
      showRecordError('Geen bewegingsdata ontvangen — sensor toegang geweigerd?');
      buf = null;
      capturedMotion = null;
      recordState = 'idle';
      renderRecordUI();
      return;
    }

    capturedMotion = {
      ...roundMotion(buf),
      durationMs,
      sampleCount,
      startedAt: new Date(Date.now() - durationMs).toISOString(),
      userAgent: navigator.userAgent,
    };
    buf = null;
    recordState = 'captured';
    renderRecordUI();
  }

  function clearCapturedRecording() {
    capturedMotion = null;
    if (recordState === 'captured') recordState = 'idle';
    renderRecordUI();
  }

  function roundMotion(b) {
    const round = (arr) => arr.map(v => Math.round(v * 10000) / 10000);
    return {
      t: b.t,
      ax: round(b.ax), ay: round(b.ay), az: round(b.az),
      lax: round(b.lax), lay: round(b.lay), laz: round(b.laz),
      rx: round(b.rx), ry: round(b.ry), rz: round(b.rz),
    };
  }

  function startRecordTimer() {
    stopRecordTimer();
    recordTimer = setInterval(renderRecordUI, 250);
  }

  function stopRecordTimer() {
    if (recordTimer) {
      clearInterval(recordTimer);
      recordTimer = null;
    }
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (err) {
      // Non-fatal — recording still works.
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function showRecordError(message) {
    const status = document.getElementById('record-status');
    if (!status) return;
    status.textContent = message;
    status.classList.remove('hidden');
    status.classList.add('error');
  }

  function renderRecordUI() {
    const btn = document.getElementById('record-btn');
    const status = document.getElementById('record-status');
    if (!btn || !status) return;

    btn.classList.remove('recording', 'captured');
    status.classList.remove('error');

    if (recordState === 'idle') {
      btn.textContent = '🎙️ Opname starten';
      btn.disabled = false;
      status.classList.add('hidden');
      status.textContent = '';
    } else if (recordState === 'recording') {
      const ms = performance.now() - recordStartedAt;
      const samples = buf ? buf.t.length : 0;
      btn.textContent = '⏹ Stop opname';
      btn.classList.add('recording');
      btn.disabled = false;
      status.textContent = `${formatDuration(ms)} · ${samples} samples`;
      status.classList.remove('hidden');
    } else if (recordState === 'captured') {
      const ms = capturedMotion?.durationMs ?? 0;
      const samples = capturedMotion?.sampleCount ?? 0;
      btn.textContent = '↺ Opnieuw opnemen';
      btn.classList.add('captured');
      btn.disabled = false;
      status.textContent = `Opname klaar · ${formatDuration(ms)} · ${samples} samples`;
      status.classList.remove('hidden');
    }
  }

  // ── Progress table ──────────────────────────────────────────────────────

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

    // Lookup by "name:day" → cell aggregate
    const lookup = {};
    data.cells.forEach(c => { lookup[`${c.name}:${c.day}`] = c; });

    body.innerHTML = '';
    for (let day = data.today; day >= 1; day--) {
      const tr = document.createElement('tr');
      if (day === data.today) tr.classList.add('day-today');

      const dayTd = document.createElement('td');
      dayTd.title = `doel: ${day} reps`;
      dayTd.innerHTML = `<span class="day-num">Dag ${day}</span>${day === data.today ? '<span class="today-label">vandaag</span>' : ''}`;
      tr.appendChild(dayTd);

      data.participants.forEach(name => {
        const td = document.createElement('td');
        const entry = lookup[`${name}:${day}`];
        td.title = `doel: ${day} reps`;
        if (entry && entry.numSets > 0) {
          const reached = entry.totalReps >= day;
          const motionIcon = entry.hasMotionCount > 0
            ? ' <span class="cell-motion" title="Beweging opgenomen">📊</span>'
            : '';
          td.innerHTML = `<span class="cell-reps ${reached ? 'cell-done' : 'cell-partial'}">${entry.totalReps}r</span> <span class="cell-sets">${entry.numSets}s</span>${motionIcon}`;
        } else if (day < data.today) {
          td.innerHTML = '<span class="cell-missed">✗</span>';
        } else {
          td.innerHTML = '<span class="cell-pending">–</span>';
        }
        if (myName) {
          td.classList.add('cell-clickable');
          td.addEventListener('click', () => openCell(name, day));
        }
        tr.appendChild(td);
      });

      body.appendChild(tr);
    }
  }

  // ── Motion view (drill-in chart for one set) ────────────────────────────

  let plotlyPromise = null;
  function loadPlotly() {
    if (plotlyPromise) return plotlyPromise;
    plotlyPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.plot.ly/plotly-2.35.2.min.js';
      script.onload = () => resolve(window.Plotly);
      script.onerror = () => {
        plotlyPromise = null;
        reject(new Error('Kon Plotly niet laden'));
      };
      document.head.appendChild(script);
    });
    return plotlyPromise;
  }

  function bindMotionClose() {
    document.getElementById('motion-close-btn').addEventListener('click', () => {
      document.getElementById('motion-view').classList.add('hidden');
      if (viewState) renderCellSection();
    });
  }

  async function showMotionView(setId) {
    const section = document.getElementById('motion-view');
    const labelEl = document.getElementById('motion-label');
    const titleEl = document.getElementById('motion-title');
    const summaryEl = document.getElementById('motion-summary');
    const statusEl = document.getElementById('motion-status');
    const chartEl = document.getElementById('motion-chart');

    section.classList.remove('hidden');
    labelEl.textContent = 'Beweging';
    titleEl.textContent = 'Bezig met laden…';
    summaryEl.innerHTML = '';
    chartEl.innerHTML = '';
    statusEl.classList.remove('error');
    statusEl.textContent = 'Bezig met laden…';
    section.scrollIntoView({ behavior: 'smooth', block: 'center' });

    try {
      const [data, Plotly] = await Promise.all([
        fetchMotion(setId),
        loadPlotly(),
      ]);
      labelEl.textContent = `Beweging — Dag ${data.day} (${data.reps} reps)`;
      titleEl.textContent = data.name;
      renderMotionSummary(summaryEl, data);
      renderMotionChart(Plotly, chartEl, data);
      statusEl.textContent = '';
    } catch (err) {
      statusEl.classList.add('error');
      statusEl.textContent = err.message || 'Iets ging mis bij het laden van de beweging.';
    }
  }

  async function fetchMotion(setId) {
    const url = `/api/motion/${setId}`;
    const res = await fetch(url, { headers: { 'X-Participant-Code': code } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function renderMotionSummary(el, data) {
    const meta = data.analysisMeta || {};
    const sampleHz = (data.sampleCount && data.durationMs)
      ? Math.round(1000 * data.sampleCount / data.durationMs)
      : '?';
    const items = [
      ['Reps geregistreerd', `<strong>${data.reps}</strong>`],
      ['Push-ups gedetecteerd', `<strong>${meta.pushups ?? data.analyzedPushups ?? '?'}</strong>`],
      ['Duur', `${(data.durationMs / 1000).toFixed(2)} s`],
      ['Samples', `${data.sampleCount} (~${sampleHz} Hz)`],
      ['Dominante as', meta.dominantAxis ?? '?'],
      ['Drempel', meta.threshold?.toFixed(2) ?? '?'],
      ['Algoritme', `v${meta.algorithmVersion ?? '?'}`],
    ];
    el.innerHTML = items.map(([k, v]) =>
      `<div><div class="label">${k}</div><div class="value">${v}</div></div>`
    ).join('');
  }

  function renderMotionChart(Plotly, el, data) {
    const raw = data.raw;
    const meta = data.analysisMeta || {};
    const t = raw.t;
    const peakTs = meta.peakTimestamps || [];
    const dominant = meta.dominantAxis || 'z';

    const peakIdx = peakTs.map(pt => {
      let best = 0, bestDiff = Infinity;
      for (let i = 0; i < t.length; i++) {
        const diff = Math.abs(t[i] - pt);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      }
      return best;
    });

    const isDark = !window.matchMedia('(prefers-color-scheme: light)').matches;
    const palette = isDark
      ? { paper: '#1e293b', plot: '#0f172a', text: '#f1f5f9', grid: '#334155', x: '#ef4444', y: '#22c55e', z: '#38bdf8', peak: '#fbbf24' }
      : { paper: '#f1f5f9', plot: '#ffffff', text: '#0f172a', grid: '#cbd5e1', x: '#dc2626', y: '#16a34a', z: '#0284c7', peak: '#d97706' };
    const colors = { x: palette.x, y: palette.y, z: palette.z };

    const lineTrace = (name, x, y, color, axis) => ({
      x, y, type: 'scattergl', mode: 'lines', name,
      line: { color, width: 1.5 },
      xaxis: 'x' + axis, yaxis: 'y' + axis,
    });
    const dominantArr = raw['a' + dominant];
    const peakMarkers = {
      x: peakIdx.map(i => t[i]),
      y: peakIdx.map(i => dominantArr[i]),
      type: 'scatter', mode: 'markers',
      name: `peaks (${dominant})`,
      marker: { color: palette.peak, size: 9, symbol: 'circle-open', line: { width: 2 } },
      xaxis: 'x', yaxis: 'y',
    };

    const traces = [
      lineTrace('ax',  t, raw.ax,  colors.x, ''),
      lineTrace('ay',  t, raw.ay,  colors.y, ''),
      lineTrace('az',  t, raw.az,  colors.z, ''),
      peakMarkers,
      lineTrace('lax', t, raw.lax, colors.x, '2'),
      lineTrace('lay', t, raw.lay, colors.y, '2'),
      lineTrace('laz', t, raw.laz, colors.z, '2'),
      lineTrace('rx',  t, raw.rx,  colors.x, '3'),
      lineTrace('ry',  t, raw.ry,  colors.y, '3'),
      lineTrace('rz',  t, raw.rz,  colors.z, '3'),
    ];

    const layout = {
      paper_bgcolor: palette.paper,
      plot_bgcolor: palette.plot,
      font: { color: palette.text, size: 11 },
      margin: { t: 24, r: 18, b: 40, l: 56 },
      legend: { orientation: 'h', y: 1.08, font: { size: 10 } },
      grid: { rows: 3, columns: 1, pattern: 'independent' },
      xaxis:  { matches: 'x3', showticklabels: false, gridcolor: palette.grid },
      xaxis2: { matches: 'x3', showticklabels: false, gridcolor: palette.grid },
      xaxis3: { title: 'Tijd (ms)', gridcolor: palette.grid },
      yaxis:  { title: 'Accel',        gridcolor: palette.grid },
      yaxis2: { title: 'Linear accel', gridcolor: palette.grid },
      yaxis3: { title: 'Rotation',     gridcolor: palette.grid },
      hovermode: 'x unified',
    };

    Plotly.react(el, traces, layout, { responsive: true, displaylogo: false });
  }

  init();
})();
