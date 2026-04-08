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
  let selectedDay = null;
  let latestData = null;
  let checkinBtnBound = false;

  const GIMMICKS = [
    'Beast mode geactiveerd! 💪',
    'Je armen huilen, maar van geluk. 😭💪',
    'Arnold Schwarzenegger is jaloers. 🏋️',
    'Nog een dag, nog een stapje dichter bij Hulk. 💚',
    'Push-up kampioen van de dag! 🏆',
    'Je borstspieren sturen hun dank. ❤️',
    'Dat was indrukwekkend, zelfs de grond is onder de indruk. 🌍',
    'Weer een dag niet opgegeven. Legend! 🔥',
    'Je lichaam: "dankjewel". Je geest: "nog één!" 🧠',
    'Ondertussen zit de bank te huilen. 🛋️😢',
    'Plank? Push-up? Gewoon lekker bezig! ⚡',
    'De zwaartekracht heeft vandaag verloren. 🌌',
    'Dit is hoe superhelden ontstaan. 🦸',
    'Chuck Norris knikt goedkeurend. 👊',
    'Spieren laden... 100% voltooid. 💪✨',
    'Jij > gisteren. Elke dag. 📈',
    'Kracht is een gewoonte. En jij bent consistent. 🎯',
    'Nog zo\'n dag en de vloer geeft zich over. 🏳️',
    'Je triceps hebben net een applausje gegeven. 👏',
    'Dit is geen push-up, dit is een statement. 📢',
    'Zweet = vloeibare trots. 💧',
    'De spiegel gaat straks knipogen. 😉',
    'Je bent letterlijk sterker dan gisteren. 📊',
    'Rocky Balboa zet zijn muts voor je af. 🥊',
    'Push-up fairy heeft je gezegend. 🧚',
    'Je ademhaling zegt "kom maar op". 🌬️',
    'De zwaartekracht had vandaag vrij genomen. Mislukt. 😤',
    'Elke rep telt. En jij telt door. 🔢',
    'Je schouders dragen nu officieel de wereld. 🌍',
    'Vandaag niet geskipt. Morgen ook niet. 🚀',
    'De challenge buigt voor jou, niet andersom. 🙇',
    'Stoere beer-energie gedetecteerd. 🐻',
    'Je lichaam is een tempel. Vandaag heb je gebeden. 🛕',
    'Push-ups: cheaper than therapy, just as effective. 🧘',
    'Dit was zo soepel, het leek wel een dans. 💃',
    'Je hartslag doet een vreugdedansje. 💓',
    'Iemand moet de legende zijn. Waarom jij niet? ✨',
    'Gainz unlocked. 🔓',
    'Je borstkas stuurt liefdesbrieven naar je armen. 💌',
    'Dat was zó goed, de tijd ging even langzamer. ⏳',
    'Spieren? Check. Discipline? Check. Held? Check. ✅',
    'De couch potato-versie van jou huilt van jaloezie. 🥔😭',
    'Respect van alle vier de muren. 🧱',
    'Je bent nu 1% dichter bij Thor. ⚡',
    'Kleine stappen, grote gains. 👣',
    'Je energielevels gaan door het dak. 🏠⬆️',
    'Elke push-up is een middelvinger naar opgeven. 🖕',
    'Vandaag was die dag. En jij was er klaar voor. 🌟',
    'Dit telt als cardio, kracht én karakter. 💯',
    'Je spieren fluisteren: "doe maar weer". 🤫',
    'Jij bent het goede voorbeeld waar mensen over praten. 🗣️',
    'Geen excuses. Alleen resultaten. 🎖️',
    'De push-up goden glimlachen vandaag. ☀️',
    'Alsof je push-ups at voor ontbijt. 🥞',
    'Je bent een wandelend motivatieposter. 📜',
    'Ja, die biceps zag ik echt. 👀',
    'Deze dag is afgevinkt. Boom. 💥',
    'Godverdomme, wat een beest ben jij. 🔥',
    'Je bent harder dan de lul van een bronstige stier. 🐂',
    'Die push-ups hadden geen schijn van kans, klootzak. 💀',
    'Shit, zelfs je zweet heeft spieren. 💦',
    'Fuck yeah, dat was pure rauwe kracht. 🤘',
    'Je bent zo sterk, de vloer vraagt om genade. 🙏',
    'Badass move, motherfucker. 😎',
    'Kanker sterk, gast. En dat is een compliment. 💪',
    'De grond likt je schoenen na die set. 👟',
    'Jezus christus, wie heeft jou losgelaten? ⛓️',
    'Zo hard dat je buurman spontaan zwanger wordt. 🤰',
    'Dat was meer bench dan een Ikea-showroom. 🛋️',
    'Je testosteron lekt uit het scherm. 🧪',
    'Alpha energy. Pure, ongefilterde alpha energy. 🐺',
    'Klotezooi wat ben jij een machine. 🤖',
    'Die push-ups zijn gesloopt zoals een ex-relatie. 💔',
    'Holy shit, de vloer heeft een kreukel. 😱',
    'Je bent zo hard, diamanten zijn jaloers. 💎',
    'Gast, zelfs Satan doet een stapje terug. 😈',
    'Fucking hell, wat een power move. ⚡',
    'Die was zo goed, ik krijg er kippenvel van. En ik ben code. 🥶',
    'Shredded als een document in een advocatenkantoor. 📄',
    'Je bent harder dan mijn wiskunde-examen. 📐',
    'Bruut. Pure bruut. Geen ander woord voor. 🦍',
    'Die push-ups smeekten om hun mama. 👶',
    'Verdomme, dat was sexy sterk. 🥵',
    'Je bent zo ripped, kleding huilt om bij je te horen. 👕',
    'Fuck cardio, dit is een executie. ☠️',
    'Beest van een mens. Mens van een beest. 🐺',
    'Die laatste rep was meer dan mijn hele jaar aan sport. 😅',
    'Kankerhard, en daar mag je trots op zijn. 🏅',
    'Je biceps hebben een eigen postcode. 📮',
    'Dat was geen push-up, dat was dominantie. 👑',
    'Godverju, wat een power. ⚡',
    'Zo sterk dat de zwaartekracht zich verontschuldigt. 🌌',
    'Je bent een lopende waarschuwing voor zwakkelingen. ⚠️',
    'Shit man, ik krijg spierpijn van kijken. 👁️',
    'Die set was vuiler dan een kroeg-wc. 🚽',
    'Je spieren hebben hun eigen zwaartekrachtsveld. 🪐',
    'Fucking legend. En dat weet je zelf ook. 🏆',
    'Je pompt harder dan een tiener met zijn eerste Pornhub-account. 🍆',
    'Die vloer is vaker geneukt dan je ex. En harder. 🛏️',
    'Zo strak dat je spieren door je shirt willen breken om hallo te zeggen. 👋',
    'Je zweet ruikt naar overwinning en slechte beslissingen. 💦',
    'Harder dan de ochtendlat van een twintiger. 🌅',
    'Die push-ups waren intiemer dan je laatste date. 💋',
    'Je bent zo ripped dat vrouwen zwanger worden van een blik alleen. 👀',
    'Fuck, je armen zijn dikker dan het IQ van je baas. 🧠',
    'Die set was zo vies dat OnlyFans geïnteresseerd is. 💸',
    'Je pompt de grond alsof het je ex-schoonmoeder is. 👵',
    'Zo hard dat God zelf even een pauze neemt. ⛪',
    'Je testosteron heeft een eigen Wikipedia-pagina. 📚',
    'Die push-ups waren zo agressief, de vloer heeft PTSD. 🪖',
    'Meer gains dan een beurshandelaar op coke. 📈',
    'Je bent zo sterk dat je scheten bulldozers wegblazen. 💨',
    'Dit was geen workout, dit was een oorlogsmisdaad tegen de zwaartekracht. ⚖️',
    'Je bent harder dan een nonnenklooster op een vrijdagavond. ⛪',
    'Shit, ik krijg een stijve van je vormbehoud. 📏',
    'Zo gespierd dat zelfs je schaduw een sixpack heeft. 🌑',
    'Die push-ups waren sneller dan je vader toen hij de melk ging halen. 🥛',
    'Je armen hebben meer definitie dan een woordenboek. 📖',
    'Fucking hardcore, zelfs Satan vraagt om autograph. ✍️',
    'Je bent zo beast dat dierenrechten-activisten je willen redden. 🐾',
    'Die vloer heeft meer klappen gehad dan je ego na een Tinder-swipe. 📱',
    'Pompen als een boormachine bij de buurvrouw. 🔧',
    'Je bent harder dan de realiteit op maandagochtend. ☕',
    'Zo strak dat je broek om genade smeekt. 👖',
    'Meer power dan een politicus met een geheim bankrekening. 💰',
    'Je kreunt harder dan de hele buurt bij een stroomuitval. 🔊',
    'Die push-ups zagen er uit alsof ze betaald werden. 💵',
    'Zo fit dat je sperma protein shakes drinkt. 🥤',
    'Je armen zijn dikker dan het strafregister van je oom. 👮',
    'Godverdomme, dat was pornografisch goed. 🎬',
    'Je bent zo sterk dat condooms spontaan scheuren van ontzag. 🎈',
    'Die set was ruwer dan een eerste keer zonder glijmiddel. 😬',
    'Meer reps dan de gemiddelde politicus leugens per dag. 🗳️',
    'Je bent een wandelend testosteron-misdrijf. 🚔',
    'Die laatste rep had meer overtuiging dan je huwelijksgeloftes. 💍',
    'Zo hard dat je spierpijn spierpijn krijgt. 🤕',
    'Fucking sloophamer van een mens ben jij. 🔨',
  ];

  function showGimmick() {
    const el = document.getElementById('gimmick');
    el.textContent = GIMMICKS[Math.floor(Math.random() * GIMMICKS.length)];
    el.classList.remove('hidden');
    // restart animation
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = '';
    setTimeout(() => el.classList.add('hidden'), 6000);
  }

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
    latestData = data;
    renderBadge(myName);
    renderCheckin(data, myName);
    renderTable(data);
  }

  function hasCheckin(day) {
    if (!latestData || !myName) return false;
    return latestData.checkins.some(c => c.name === myName && c.day === day);
  }

  function renderBadge(name) {
    const badge = document.getElementById('user-badge');
    if (!name) return;
    badge.innerHTML = `Ingelogd als <strong>${name}</strong>`;
    badge.classList.remove('hidden');
  }

  function showCheckinForm(day, isToday) {
    const section = document.getElementById('checkin-section');
    selectedDay = day;
    document.getElementById('checkin-label').textContent =
      isToday ? `Vandaag \u2014 Dag ${day}` : `Inhalen \u2014 Dag ${day}`;
    document.getElementById('checkin-day').textContent =
      `${day} push-up${day === 1 ? '' : 's'}`;
    section.classList.remove('hidden');
    bindCheckinBtn();
  }

  function renderCheckin(data, name) {
    const section = document.getElementById('checkin-section');
    if (!name) return;
    // If a past day is selected for backfill, keep that view
    if (selectedDay !== null && selectedDay !== data.today) {
      if (hasCheckin(selectedDay)) {
        selectedDay = null;
        section.classList.add('hidden');
      }
      return;
    }
    const today = data.today;
    if (hasCheckin(today)) {
      selectedDay = null;
      section.classList.add('hidden');
      return;
    }
    showCheckinForm(today, true);
  }

  function bindCheckinBtn() {
    if (checkinBtnBound) return;
    checkinBtnBound = true;
    const btn = document.getElementById('checkin-btn');
    const input = document.getElementById('sets-input');
    const section = document.getElementById('checkin-section');

    btn.addEventListener('click', async () => {
      const sets = parseInt(input.value, 10);
      if (!sets || sets < 1) return;
      if (selectedDay === null) return;

      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'Bezig...';

      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Participant-Code': code,
        },
        body: JSON.stringify({ sets, day: selectedDay }),
      });

      btn.disabled = false;
      btn.textContent = originalText;

      if (res.ok) {
        selectedDay = null;
        section.classList.add('hidden');
        showGimmick();
        loadProgress();
      } else {
        const err = await res.json();
        alert(err.error || 'Er ging iets mis');
      }
    });
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
          td.addEventListener('click', () => {
            showCheckinForm(day, day === latestData.today);
            document.getElementById('checkin-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById('sets-input').focus();
          });
        }
        tr.appendChild(td);
      });

      body.appendChild(tr);
    }
  }

  init();
})();
