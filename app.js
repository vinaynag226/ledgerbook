/* LedgerBook v2 — race-day app. Vanilla JS, no framework (fast start, low battery). */
(function () {
  'use strict';
  var LB = window.LB;
  var SLOTS = LB.SLOTS, ENGINES = LB.ENGINES;
  var VERSION = '2.0.8';

  /* =========================================================
     STATE
     ========================================================= */
  var S = {
    races: [],            // races loaded in memory (recent window, or everything once Lab loaded it)
    allLoaded: false,
    tracks: {},           // country -> [track names used]
    set: {                // synced settings
      bank: 0, adj: [], card: 15, odds: 3, stakeLast: 100, u: 0
    },
    dev: {                // this phone only
      sound: true, vib: true, keep: true, volume: 0.8, alarmLen: 6, fire: null, lastSync: 0
    },
    ui: { view: 'home', day: LB.defaultDay(Date.now()), raceId: null, eng: 'claude', resTab: 'need', showAll: false, open: {}, labF: { country: '', period: '30', track: '' } },
    armed: false,
    alerts: [],           // queue of {id, k}
    cardBanners: [],
    kp: null,             // keypad state
    sheet: null,          // open sheet name
    sync: { state: 'off', user: null, msg: '' },
    sig: ''
  };
  var root = document.getElementById('app');

  /* =========================================================
     STORAGE — IndexedDB (unlimited history), small settings in localStorage
     ========================================================= */
  var DB = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        var rq = indexedDB.open('ledgerbook', 1);
        rq.onupgradeneeded = function () {
          var db = rq.result;
          var st = db.createObjectStore('races', { keyPath: 'id' });
          st.createIndex('day', 'day');
          db.createObjectStore('kv');
        };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
      return dbp;
    }
    function tx(store, mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(store, mode), st = t.objectStore(store), out;
          out = fn(st);
          t.oncomplete = function () { res(out instanceof IDBRequest ? out.result : out); };
          t.onerror = function () { rej(t.error); };
        });
      });
    }
    return {
      put: function (r) { return tx('races', 'readwrite', function (st) { st.put(r); }); },
      putMany: function (list) { return tx('races', 'readwrite', function (st) { list.forEach(function (r) { st.put(r); }); }); },
      del: function (id) { return tx('races', 'readwrite', function (st) { st.delete(id); }); },
      since: function (day) { return tx('races', 'readonly', function (st) { return st.index('day').getAll(IDBKeyRange.lowerBound(day)); }); },
      all: function () { return tx('races', 'readonly', function (st) { return st.getAll(); }); },
      get: function (k) { return tx('kv', 'readonly', function (st) { return st.get(k); }); },
      set: function (k, v) { return tx('kv', 'readwrite', function (st) { st.put(v, k); }); }
    };
  })();

  function saveDev() { try { localStorage.setItem('lb2_dev', JSON.stringify(S.dev)); } catch (e) { } }
  function loadDev() { try { var d = JSON.parse(localStorage.getItem('lb2_dev') || 'null'); if (d) Object.assign(S.dev, d); } catch (e) { } }

  var dirty = {}, flushT = null;
  function persist(r, opts) {
    r.u = Date.now();
    dirty[r.id] = r;
    if (r.track) noteTrack(r.country, r.track);
    clearTimeout(flushT);
    flushT = setTimeout(flush, opts && opts.now ? 0 : 250);
  }
  function flush() {
    var list = Object.keys(dirty).map(function (k) { return dirty[k]; });
    dirty = {};
    if (!list.length) return;
    DB.putMany(list).catch(function () { toast('Could not save on this phone — storage full?'); });
    Sync.push(list);
  }
  function saveSettings() {
    S.set.u = Date.now();
    DB.set('settings', S.set);
    Sync.pushSettings();
  }
  function noteTrack(country, track) {
    var l = S.tracks[country] || (S.tracks[country] = []);
    if (l.indexOf(track) < 0) { l.push(track); DB.set('tracks', S.tracks); }
  }
  function getRace(id) { for (var i = 0; i < S.races.length; i++) if (S.races[i].id === id) return S.races[i]; return null; }
  function upsertLocal(r) {
    for (var i = 0; i < S.races.length; i++) if (S.races[i].id === r.id) { S.races[i] = r; return; }
    S.races.push(r);
  }
  function removeLocal(id) { S.races = S.races.filter(function (r) { return r.id !== id; }); }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return LB.dayKey(d); }
  function loadAll() {
    if (S.allLoaded) return Promise.resolve();
    return DB.all().then(function (all) {
      var mem = {}; S.races.forEach(function (r) { mem[r.id] = r; });
      all.forEach(function (r) { if (!r.deleted && !mem[r.id]) S.races.push(r); });
      S.allLoaded = true;
    });
  }

  /* =========================================================
     HELPERS
     ========================================================= */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cfg() { return { card: S.set.card, odds: S.set.odds }; }
  function money(v, sign) {
    var n = Math.round(Number(v) || 0), a = Math.abs(n).toLocaleString('en-IN');
    if (sign) return (n > 0 ? '+₹' : n < 0 ? '−₹' : '₹') + a;
    return (n < 0 ? '−₹' : '₹') + a;
  }
  function raceName(r) { return r.track + ' R' + r.rno; }
  function ccode(c) { return c === 'GB' ? 'UK' : c === 'OT' ? '' : c; }
  function metaLine(r) {
    var bits = [ccode(r.country)];
    if (r.runners) bits.push(r.runners + ' RUN');
    bits.push('TOP ' + LB.tier(r));
    if (r.delay) bits.push('+' + r.delay + ' MIN');
    return bits.filter(Boolean).join(' · ');
  }
  function fmtDay(day) {
    var p = day.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    var dn = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()];
    var mn = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
    return dn + ' ' + d.getDate() + ' ' + mn;
  }
  function shiftDay(day, n) { var p = day.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]); d.setDate(d.getDate() + n); return LB.dayKey(d); }
  function vib(p) { var ua = navigator.userActivation; if (S.dev.vib && navigator.vibrate && (!ua || ua.hasBeenActive)) try { navigator.vibrate(p); } catch (e) { } }
  function engOf(k) { return ENGINES.filter(function (e) { return e.k === k; })[0]; }
  function slotOf(k) { return SLOTS.filter(function (s) { return s.k === k; })[0]; }
  function slotIdx(k) { for (var i = 0; i < SLOTS.length; i++) if (SLOTS[i].k === k) return i; return -1; }

  var I = {
    back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    left: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    cmd: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>',
    races: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
    flag: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 4v16M5 5h11l-2 4 2 4H5"/></svg>',
    lab: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/></svg>',
    up: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
    sound: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    bell: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    paste: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/></svg>',
    more: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    del: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12z"/><path d="M13 10l4 4M17 10l-4 4"/></svg>',
    star: '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6.2 6.6.7-4.9 4.5 1.4 6.6L12 17.2l-5.9 3.3 1.4-6.6L2.5 9.4l6.6-.7z"/></svg>',
    upload: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>',
    multi: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="8" cy="8" r="4"/><circle cx="16" cy="16" r="4"/></svg>'
  };

  /* =========================================================
     SOUND — two clearly different sounds, plus background keep-alive
     ========================================================= */
  function alarmSecs() { var n = +S.dev.alarmLen; return n === 3 || n === 6 || n === 10 ? n : 6; }
  // Vibration that lasts as long as the alarm sound
  function alarmVib() { var p = [], n = Math.round(alarmSecs() / 0.75); for (var i = 0; i < n; i++) p.push(400, 350); return p; }
  var Sound = (function () {
    var ctx = null, keep = null;
    function ac() {
      if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(f, start, dur, type, gain) {
      var c = ac(); if (!c) return;
      var o = c.createOscillator(), g = c.createGain(), v = gain * S.dev.volume;
      o.type = type; o.frequency.value = f;
      o.connect(g); g.connect(c.destination);
      var t = c.currentTime + start;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    }
    // T−15: soft, low two-note chime (bell-like)
    // T−15: soft two-note chime, 3 rounds (about 4 seconds)
    function chime() {
      if (!S.dev.sound) return;
      [0, 1.4, 2.8].forEach(function (b) {
        [[523.25, 0], [659.25, 0.28]].forEach(function (n) {
          tone(n[0], b + n[1], 0.9, 'sine', 0.45); tone(n[0] * 2, b + n[1], 0.5, 'sine', 0.08);
        });
      });
    }
    // T−3: sharp rising triple alarm, repeated for the chosen length (default 6 seconds)
    function alarm() {
      if (!S.dev.sound) return;
      var secs = alarmSecs();
      for (var b = 0; b + 0.6 <= secs; b += 0.75) {
        [880, 1174.66, 1567.98].forEach(function (f, i) { tone(f, b + i * 0.16, 0.14, 'square', 0.32); });
      }
    }
    function startKeepAlive() {
      var c = ac(); if (!c || keep) return;
      var o = c.createOscillator(), g = c.createGain();
      o.frequency.value = 30; g.gain.value = 0.0006;
      o.connect(g); g.connect(c.destination); o.start();
      keep = o;
      if ('mediaSession' in navigator) {
        try { navigator.mediaSession.metadata = new MediaMetadata({ title: 'LedgerBook race-day mode', artist: 'Alerts active' }); } catch (e) { }
      }
    }
    function stopKeepAlive() { if (keep) { try { keep.stop(); } catch (e) { } keep = null; } }
    return { arm: ac, chime: chime, alarm: alarm, secs: alarmSecs, startKeepAlive: startKeepAlive, stopKeepAlive: stopKeepAlive, running: function () { return !!ctx && ctx.state === 'running'; } };
  })();

  var wakeLock = null;
  function requestWake() {
    if (!('wakeLock' in navigator) || !S.armed) return;
    navigator.wakeLock.request('screen').then(function (w) { wakeLock = w; }).catch(function () { });
  }
  function armRaceDay() {
    Sound.arm();
    S.armed = true;
    if (S.dev.keep) Sound.startKeepAlive();
    requestWake();
    render(); // also adds the Back-button guard
  }

  /* =========================================================
     RENDER — header, view, nav. Overlays live in their own layer.
     ========================================================= */
  function wide() { return window.innerWidth >= 960; }
  // Remember what the person is typing so a redraw can never lose it
  function grabFocus() {
    var a = document.activeElement;
    if (!a || !a.id || !root.contains(a) || !/^(INPUT|TEXTAREA)$/.test(a.tagName)) return null;
    var f = { id: a.id, v: a.value, s: null, e: null };
    try { f.s = a.selectionStart; f.e = a.selectionEnd; } catch (x) { }
    return f;
  }
  function putFocus(f) {
    if (!f) return;
    var a = document.getElementById(f.id);
    if (!a) return;
    // Boxes keep their own text (data-bind); only unbound boxes need their text put back
    if (!a.dataset.bind && a.id !== 'trackSearch' && a.type !== 'file' && a.value !== f.v) a.value = f.v;
    a.focus({ preventScroll: true });
    try { if (f.s !== null) a.setSelectionRange(f.s, f.e); } catch (x) { }
  }
  function render() {
    var foc = grabFocus();
    var sc = root.querySelectorAll('.scroll'), keepScroll = [];
    for (var i = 0; i < sc.length; i++) keepScroll.push(sc[i].scrollTop);
    root.className = wide() ? 'wide' : '';
    var v = S.ui.view, html;
    if (wide()) {
      var left = v === 'race' ? 'home' : v;
      html = '<div class="cols"><div class="col col-a">' + viewHtml(left) + '</div><div class="col col-b">' +
        (S.ui.raceId && getRace(S.ui.raceId) ? raceView(getRace(S.ui.raceId)) : '<div class="empty" style="margin-top:40px"><b>Select a race</b>Tap any race on the left to open it here.</div>') +
        '</div></div>' + navHtml();
    } else {
      html = '<div class="cols"><div class="col">' + viewHtml(v) + '</div></div>' + (v === 'race' ? '' : navHtml());
    }
    html += '<div id="sheetLayer">' + sheetLayerHtml() + '</div><div id="layer">' + layerHtml() + '</div>';
    root.innerHTML = html;
    sc = root.querySelectorAll('.scroll');
    for (var j = 0; j < sc.length && j < keepScroll.length; j++) sc[j].scrollTop = keepScroll[j];
    S.sig = signature();
    putFocus(foc);
    syncHistory();
  }
  // Android Back button: steps back one layer (keypad → form → race/tab → home) instead of closing the app.
  // In race-day mode, Back on the home screen asks for a second press, because closing the app stops alerts.
  var navDepth = 0, ignorePops = 0, exitPending = 0;
  function wantDepth() { return (S.armed && !exitPending ? 1 : 0) + (S.ui.view !== 'home' ? 1 : 0) + (S.sheet ? 1 : 0) + (S.kp ? 1 : 0); }
  function syncHistory() {
    var d = wantDepth();
    while (navDepth < d) { history.pushState({ lb: navDepth + 1 }, ''); navDepth++; }
    if (navDepth > d) { ignorePops++; var n = navDepth - d; navDepth = d; history.go(-n); }
  }
  window.addEventListener('popstate', function () {
    if (ignorePops > 0) { ignorePops--; return; }
    navDepth = Math.max(0, navDepth - 1);
    if (S.kp) { if (S.kp.kind === 'slot') commitSlotField(); S.kp = null; }
    else if (S.sheet) { S.sheet = null; sheetData = {}; }
    else if (S.ui.view !== 'home') { S.ui.view = 'home'; }
    else if (S.armed) {
      exitPending = 1;
      toast('Press Back again to close LedgerBook — alerts stop when it closes');
      clearTimeout(exitPending.t);
      setTimeout(function () { exitPending = 0; syncHistory(); }, 3000);
      return;
    }
    render();
  });
  // Alerts, banners and toasts only. Never touches an open form or keypad.
  function renderLayer() {
    var l = document.getElementById('layer');
    if (l) l.innerHTML = layerHtml(); else render();
  }
  function viewHtml(v) {
    if (v === 'race') { var r = getRace(S.ui.raceId); return r ? raceView(r) : homeView(); }
    if (v === 'results') return resultsView();
    if (v === 'lab') return labView();
    return homeView();
  }
  function navHtml() {
    var need = LB.resultsNeeded(S.races, Date.now(), cfg()).length, v = S.ui.view;
    function b(k, label, icon, badge) {
      var on = v === k || (k === 'home' && v === 'race');
      return '<button class="' + (on ? 'on' : '') + '" data-act="nav" data-v="' + k + '">' + icon + label + (badge ? '<span class="badge">' + badge + '</span>' : '') + '</button>';
    }
    return '<nav class="nav">' + b('home', 'COMMAND', I.cmd) + b('results', 'RESULTS', I.flag, need) + b('lab', 'LAB', I.lab) + '</nav>';
  }
  function clockHtml() {
    var d = new Date();
    return LB.pad(d.getHours()) + ':' + LB.pad(d.getMinutes()) + '<span>:' + LB.pad(d.getSeconds()) + '</span>';
  }
  function syncLabel() {
    var s = S.sync.state;
    var cls = s === 'ok' ? 'ok' : s === 'wait' ? 'wait' : s === 'err' ? 'err' : '';
    var t = s === 'ok' ? 'SYNCED' : s === 'wait' ? 'SYNCING' : s === 'err' ? 'SYNC ERROR' : s === 'offline' ? 'OFFLINE' : 'THIS PHONE';
    return '<span class="syncdot ' + cls + '"></span>' + t;
  }

  /* ---------- HOME / COMMAND ---------- */
  // Focus = TOP + HIGH races (or any race you play / switch alerts on for). MEDIUM, WATCH and
  // races that already went by stay folded until tapped, so the screen only shows what you work on.
  function fileBar(day, now) {
    var f = (S.set.files || {})[day];
    if (!f) return '';
    var made = '', warn = '';
    if (f.at) {
      var t = Date.parse(f.at);
      if (isFinite(t)) {
        made = 'made ' + LB.hhmm(t) + (LB.dayKey(new Date(t)) !== LB.dayKey(new Date(now)) ? ' ' + fmtDay(LB.dayKey(new Date(t))) : '');
        if (LB.dayKey(new Date(t)) < shiftDay(day, -1)) warn = 'OLD FILE · ';
      }
    }
    return '<div class="filebar' + (warn ? ' warn' : '') + '">' + I.upload.replace('width="20" height="20"', 'width="13" height="13"') + '<b>' + esc(warn + (f.by || 'Race file')) + '</b><span>· ' + (made ? made + ' · ' : '') + 'loaded ' + LB.hhmm(f.t) + ' · ' + f.n + ' races</span></div>';
  }
  function foldHtml(key, label, why, list, now, c, cls) {
    if (!list.length) return '';
    var open = !!S.ui.open[key];
    var h = '<button class="fold ' + cls + (open ? ' open' : '') + '" data-act="fold" data-k="' + key + '"><b>' + label + '</b><span class="why">' + why + '</span><span class="n">' + list.length + '</span>' + I.chev + '</button>';
    if (open) h += '<div class="pad stack">' + list.map(function (r) { return raceRow(r, now, c); }).join('') + '</div>';
    return h;
  }
  function homeView() {
    var now = Date.now(), c = cfg(), day = S.ui.day;
    var dayAll = LB.dayRaces(S.races, day);
    var L = LB.lists(S.races, day, now, c), up = L.focus;
    var past = LB.passed(S.races, day, now, c);
    var dn = LB.doNow(S.races, day, now, c);
    var need = LB.resultsNeeded(S.races, now, c);
    var fin = LB.finished(S.races, day);
    var bk = LB.bankroll(S.races, S.set);
    var graded = dayAll.some(function (r) { return r.prio; });
    var h = '<header class="hdr"><div><div class="clock mono" data-clock>' + clockHtml() + '</div>' +
      '<div class="daynav"><button data-act="day" data-n="-1" aria-label="Previous day">' + I.left + '</button><span class="d' + (day === LB.defaultDay(now) ? ' today' : '') + '">' + fmtDay(day) + '</span><button data-act="day" data-n="1" aria-label="Next day">' + I.right + '</button></div></div>' +
      '<div class="spacer"></div><div style="text-align:right;margin-right:2px"><div class="cap" style="white-space:nowrap;letter-spacing:1px">' + syncLabel() + '</div><div class="cap" style="margin-top:5px;color:var(--text);white-space:nowrap;letter-spacing:1px">' + up.length + (graded ? ' FOCUS' : '') + ' LEFT</div></div>' +
      '<button class="iconbtn sm" data-act="importDay" aria-label="Load races" style="color:var(--gold);border-color:var(--gold-line)">' + I.upload + '</button>' +
      '<button class="iconbtn sm" data-act="addRace" aria-label="Add one race">' + I.plus + '</button>' +
      '<button class="iconbtn sm" data-act="settings" aria-label="Settings">' + I.gear + '</button></header>';
    h += '<div class="scroll">';
    if (!S.armed) {
      h += '<button class="arm" data-act="arm"><span style="color:var(--gold)">' + I.bell + '</span><div><b>Start race-day mode</b><span>Turns on alert sounds, keeps the screen awake and alerts running in the background. Tap once each time you open the app.</span></div></button>';
    } else {
      h += '<div class="armed">' + I.sound + '<span style="flex:1">' + (S.dev.sound ? 'SOUND ON' : 'SOUND OFF') + ' · <span class="c">T−' + c.card + ' CHIME</span> · <span class="o">T−' + c.odds + ' ALARM</span>' + (graded ? ' · FOCUS RACES' : '') + '</span></div>';
    }
    h += fileBar(day, now);
    if (!dayAll.length) {
      h += '<div class="empty"><b>No races for this day</b>Tap <b style="display:inline;font-size:inherit;color:var(--gold)">Load races</b> and pick your timetable .json file from Downloads or WhatsApp — every race comes in at once. Or add a race by hand.<div style="display:flex;flex-direction:column;gap:8px;margin-top:14px"><button class="btn gold full" data-act="importDay">' + I.upload + 'Load races</button><button class="btn ghost full" data-act="addRace">' + I.plus + 'Add one race</button></div>' + (window.LB_PREVIEW ? '<button class="btn blue sm" style="margin:12px auto 0" data-act="demo">Load a demo race day</button>' : '') + '</div>';
    }
    if (dn) h += nowCard(dn, now, c);
    else {
      var nx = up.filter(LB.followed)[0];
      if (nx) {
        var st = LB.stage(nx, now, c);
        var mins = st.k === 'card_in' || st.k === 'odds_in' ? st.inMin * 60000 : 0;
        h += '<div class="now calm"><div class="top"><span class="pill" style="background:var(--panel2);color:var(--muted)">ALL CLEAR</span><span class="job" style="color:var(--muted)">' + (st.k === 'card_in' ? 'NEXT: RACECARD' : 'NEXT: FINAL ODDS') + '</span></div>' +
          '<div class="mid"><div><div class="nm">' + esc(raceName(nx)) + '</div><div class="sub">' + metaLine(nx) + '</div></div><div class="cd" data-cdjob="' + nx.id + '">' + LB.fmtCountdown(mins) + '</div></div></div>';
      }
    }
    var cl = LB.clashes(S.races, day, now, c);
    if (cl.length) {
      var a = cl[0][0], b = cl[0][1];
      h += '<div class="clash"><span style="color:var(--orange)">' + I.warn + '</span><div><b>Clash at ' + LB.hhmm(a.t) + '.</b> ' + esc(raceName(a.r)) + ' ' + (a.k === 'odds' ? 'odds' : 'card') + ' and ' + esc(raceName(b.r)) + ' ' + (b.k === 'odds' ? 'odds' : 'card') + '. Do ' + esc(a.r.track) + ' first — it jumps sooner.</div></div>';
    }
    if (up.length) {
      var show = S.ui.showAll ? up : up.slice(0, 5);
      h += '<div class="sec"><span class="cap">' + (graded ? (S.ui.showAll ? 'FOCUS · ALL' : 'FOCUS · NEXT 5') : (S.ui.showAll ? 'ALL UPCOMING' : 'TOP 5 UPCOMING')) + '</span><span class="cap">TO JUMP</span></div><div class="pad stack">';
      show.forEach(function (r) { h += raceRow(r, now, c); });
      if (up.length > 5) h += '<button class="more" data-act="showAll">' + (S.ui.showAll ? 'SHOW NEXT 5 ONLY' : '+ ' + (up.length - 5) + (graded ? ' MORE FOCUS RACES' : ' MORE TODAY')) + '</button>';
      h += '</div>';
    } else if (dayAll.length && (L.medium.length || L.watch.length)) {
      h += '<div class="calmnote"><b style="color:var(--text)">No focus races left on this day.</b> Medium and watch races are below — tap a list to open it. Entering picks on any race brings it here with alerts.</div>';
    }
    if (dayAll.length) {
      h += '<div style="height:4px"></div>';
      h += foldHtml('med', 'MEDIUM', 'no alerts · tap to see', L.medium, now, c, 'med');
      h += foldHtml('watch', 'WATCH', 'high volatility · no alerts', L.watch, now, c, 'watch');
      h += foldHtml('past', 'GONE BY', 'not played or skipped', past, now, c, '');
    }
    if (dayAll.length || need.length) {
      h += '<div class="twin"><button class="tile' + (need.length ? ' red' : '') + '" data-act="results" data-tab="need"><b>' + need.length + '</b><span>RESULTS NEEDED</span></button>' +
        '<button class="tile" data-act="results" data-tab="fin"><b>' + fin.length + '</b><span>FINISHED</span></button></div>';
    }
    var dayPnl = 0; dayAll.forEach(function (r) { var p = LB.racePnl(r); if (p) dayPnl += p; });
    h += '<div class="bank"><div' + (!S.set.bank && !(S.set.adj || []).length ? ' data-act="setBank" style="cursor:pointer"' : '') + '><span class="cap">BALANCE' + (!S.set.bank && !(S.set.adj || []).length ? ' · SET' : '') + '</span><b>' + money(bk.balance) + '</b></div><div><span class="cap">IN PLAY</span><b style="color:var(--gold)">' + money(bk.inPlay) + '</b></div><div><span class="cap">DAY P&amp;L</span><b class="' + (dayPnl > 0 ? 'ok' : dayPnl < 0 ? 'bad' : '') + '">' + money(dayPnl, true) + '</b></div></div>';
    if (dayAll.length) h += '<div style="display:flex;gap:8px;padding:12px 12px 0"><button class="btn gold sm" style="flex:1.4" data-act="importDay">' + I.upload + 'Load races</button><button class="btn ghost sm" style="flex:1" data-act="addRace">' + I.plus + 'Add race</button></div>';
    h += '</div>';
    return h;
  }
  function nowCard(r, now, c) {
    var st = LB.stage(r, now, c), odds = st.k === 'odds_now';
    var cls = odds ? 'red' : 'blue';
    var job = odds ? 'FINAL ODDS CHECK' : (st.overdue ? 'RACECARD OVERDUE' : 'UPLOAD RACECARD');
    var ag = LB.agreement(r).filter(function (x) { return x.n === 3; });
    var miss = ENGINES.filter(function (e) { return !LB.hasPicks(r, e.k); });
    var h = '<div class="now ' + cls + '"><div class="top"><div style="display:flex;align-items:center;gap:8px"><span class="pill">DO NOW</span><span class="job">' + job + '</span></div>' +
      (ag.length ? '<span class="chip gold">' + I.star + ' ' + ag.map(function (x) { return '#' + x.h; }).join(' ') + ' ALL 3</span>' : '') + '</div>' +
      '<div class="mid"><div style="min-width:0"><div class="nm">' + esc(raceName(r)) + '</div><div class="sub">' + metaLine(r) + ' · JUMP ' + LB.hhmm(LB.jumpAt(r)) + '</div></div><div class="cd" data-cd="' + r.id + '">' + LB.fmtCountdown(LB.jumpAt(r) - now) + '</div></div>';
    if (odds && miss.length && miss.length < 3) h += '<div class="chips">' + miss.map(function (e) { return '<span class="chip redsoft">' + e.s + ' PICKS MISSING</span>'; }).join('') + '</div>';
    h += '<button class="btn ' + cls + ' full" data-act="open" data-id="' + r.id + '">' + I.up + (odds ? 'Open race · final odds' : 'Open race · enter picks') + '</button></div>';
    return h;
  }
  function stageChips(r, st) {
    var out = [];
    if (r.prio === 'TOP') out.push('<span class="chip gold">TOP</span>');
    else if (r.prio === 'HIGH') out.push('<span class="chip silver">HIGH</span>');
    else if (r.prio && LB.inFocus(r)) out.push('<span class="chip dim">' + esc(r.prio) + '</span>');
    if (r.abandoned) { out.push('<span class="chip orange">ABANDONED</span>'); return out.join(''); }
    if (r.skipped) out.push('<span class="chip dim">SKIPPED</span>');
    else if (st.k === 'result' && !LB.played(r)) out.push('<span class="chip dim">NOT PLAYED</span>');
    if (st.k === 'odds_now') out.push('<span class="chip red">ODDS NOW</span>');
    else if (st.k === 'card_now') out.push('<span class="chip ' + (st.overdue ? 'red' : 'blue') + '">' + (st.overdue ? 'CARD OVERDUE' : 'CARD NOW') + '</span>');
    else if (st.k === 'card_in') out.push('<span class="chip blue">CARD IN ' + LB.fmtCountdown(st.inMin * 60000) + '</span>');
    else if (st.k === 'odds_in') out.push('<span class="chip ' + (st.inMin < 5 ? 'orange' : 'dim') + '">ODDS IN ' + LB.fmtCountdown(st.inMin * 60000) + '</span>');
    var eng = LB.enginesWithPicks(r);
    if (eng.length && eng.length < 3) out.push('<span class="chip dim">' + eng.length + '/3 ENGINES</span>');
    var ag = LB.agreement(r), g3 = ag.filter(function (x) { return x.n === 3; }).length, g2 = ag.filter(function (x) { return x.n === 2; }).length;
    if (g3) out.push('<span class="chip gold">' + I.star + ' ' + g3 + ' ALL-AGREE</span>');
    else if (g2) out.push('<span class="chip silver">' + g2 + ' PART-AGREE</span>');
    if (r.bets && r.bets.length) {
      var live = r.bets.filter(function (b) { return !(LB.betPnl(b, r) === 0 && !LB.resultOk(r)); });
      out.push(live.length ? '<span class="chip green">BET ' + money(live.reduce(function (a, b) { return a + LB.num(b.stake); }, 0)) + '</span>' : '<span class="chip dim">BET VOID</span>');
    }
    if (r.nr && r.nr.length) out.push('<span class="chip orange">NR #' + r.nr.join(' #') + '</span>');
    if (LB.inFocus(r) && !LB.followed(r) && !r.skipped && st.k !== 'result' && st.k !== 'done') out.push('<span class="chip dim">ALERTS OFF</span>');
    return out.join('');
  }
  function raceRow(r, now, c) {
    var st = LB.stage(r, now, c), hot = st.k === 'odds_now' ? ' hot' : st.k === 'card_now' ? ' due' : '';
    return '<button class="row' + hot + '" data-act="open" data-id="' + r.id + '"><span class="t">' + LB.hhmm(LB.jumpAt(r)) + '</span>' +
      '<span class="main"><span class="nm">' + esc(raceName(r)) + '<small>' + ccode(r.country) + '</small></span><span class="chips">' + stageChips(r, st) + '</span></span>' +
      (st.k === 'result' || st.k === 'skip' && LB.jumpAt(r) < now ? '<span class="cd" style="color:var(--faint);font-size:12px">RAN</span>' :
      '<span class="cd' + (st.k === 'odds_now' ? ' red' : '') + '" data-cd="' + r.id + '">' + LB.fmtCountdown(LB.jumpAt(r) - now) + '</span>') + '</button>';
  }

  /* ---------- RACE ---------- */
  function raceView(r) {
    var now = Date.now(), st = LB.stage(r, now, cfg()), tierN = LB.tier(r), n = LB.slotCount(r);
    var h = '<header class="rhead">' + (wide() ? '' : '<button class="iconbtn sm" data-act="back" aria-label="Back">' + I.back + '</button>') +
      '<div class="ttl"><b>' + esc(raceName(r)) + '</b><span class="cap">' + esc(metaLine(r)) + '</span>' + (r.name ? '<div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">' + esc(r.name) + '</div>' : '') + '</div>' +
      '<div class="cd mono' + (st.k === 'odds_now' ? '" style="color:var(--red)' : '') + '"><span data-cd="' + r.id + '">' + LB.fmtCountdown(LB.jumpAt(r) - now) + '</span><small>JUMP ' + LB.hhmm(LB.jumpAt(r)) + '</small></div>' +
      '<button class="iconbtn sm" data-act="raceMenu" aria-label="Race options">' + I.more + '</button></header><div class="scroll">';
    // quick meta
    h += '<div class="meta"><button class="mbtn gold" data-act="tier">PAY TOP ' + tierN + (r.pay ? ' · SET' : ' · AUTO') + '</button>' +
      '<button class="mbtn" data-act="runners">' + (r.runners ? r.runners + ' RUNNERS' : 'SET RUNNERS') + '</button>' +
      (r.skipped ? '<button class="mbtn red" data-act="skip">SKIPPED · UNDO</button>' : '') +
      (r.abandoned || LB.resultOk(r) ? '' : '<button class="mbtn' + (LB.followed(r) ? ' on' : '') + '" data-act="follow">' + (LB.followed(r) ? '🔔 ALERTS ON' : '🔕 ALERTS OFF') + '</button>') +
      (r.prio ? '<span class="mbtn" style="pointer-events:none">' + esc(r.prio) + '</span>' : '') +
      (r.nr || []).map(function (h) { return '<button class="mbtn nr" data-act="nrDel" data-h="' + esc(h) + '">NR #' + esc(h) + ' ✕</button>'; }).join('') + '</div>';
    if (r.abandoned) h += '<div class="voidbar">' + I.warn + '<div><b>ABANDONED</b><div style="font-size:12px;color:var(--muted);margin-top:2px">All bets void — stakes back in your balance. Not counted in stats.</div></div><button data-act="abandon">UNDO</button></div>';
    // agreement tiles
    var ag = LB.agreement(r).filter(function (x) { return x.n >= 2; });
    if (ag.length) {
      h += '<div class="agree">' + ag.map(function (x) {
        var names = x.engines.map(function (k) { return engOf(k).s; }).join(' · ');
        return '<div class="ag t' + x.n + '"><span class="n">' + esc(x.h) + '</span><div><b>' + esc(x.nm || 'Horse ' + x.h) + '</b><small>' + (x.n === 3 ? 'ALL 3 AGREE' : names + ' AGREE') + '</small></div></div>';
      }).join('') + '</div>';
    }
    // engine tabs
    h += '<div class="tabs">' + ENGINES.map(function (e) {
      var c = 0; SLOTS.forEach(function (s, i) { if (i < n && r.picks[e.k][s.k].h) c++; });
      return '<button class="' + e.k + (S.ui.eng === e.k ? ' on' : '') + '" data-act="eng" data-e="' + e.k + '">' + e.n.toUpperCase() + '<small>' + c + '/' + n + '</small></button>';
    }).join('') + '<button class="cmp' + (S.ui.eng === 'grid' ? ' on' : '') + '" data-act="eng" data-e="grid">COMPARE<small>ALL 3</small></button></div>';
    if (S.ui.eng === 'grid') h += gridHtml(r);
    else h += engineHtml(r, S.ui.eng);
    h += resultHtml(r);
    h += '<div style="height:20px"></div></div>';
    return h;
  }
  function fieldClass(r, d, f) {
    var cls = 'fld' + (f === 'h' ? '' : ' o');
    var v = d[f];
    if (!v) cls += ' ph';
    if (f === 'h' && v) { if (LB.isNR(r, v)) cls += ' nr'; else { var lv = LB.agreeLevel(r, v); if (lv >= 2) cls += ' ag' + lv; } }
    if (S.kp && S.kp.kind === 'slot' && S.kp.raceId === r.id) {
      var cur = S.kp.fields[S.kp.i];
      if (cur && cur.eng === S.kp.eng && cur.slot === d._k && cur.f === f) cls += ' focus';
    }
    return cls;
  }
  function engineHtml(r, ek) {
    var n = LB.slotCount(r), e = engOf(ek);
    var h = '<div class="tools"><button class="btn ghost sm" style="flex:1" data-act="paste">' + I.paste + 'Paste ' + e.n + '</button>' +
      '<button class="btn ghost sm" style="flex:1" data-act="multi">' + I.multi + 'Any-wins multi</button></div>';
    h += '<div class="colhd"><span>SLOT</span><span>HORSE</span><span>WIN ODDS</span><span>PLACE</span></div>';
    SLOTS.forEach(function (s, i) {
      var d = r.picks[ek][s.k]; d._k = s.k;
      var off = i >= n, out = LB.outcome(r, ek, i);
      var bets = (r.bets || []).filter(function (b) { return b.type !== 'ANY' && b.eng === ek && b.slot === s.k; });
      h += '<div class="slot' + (off ? ' off' : '') + '"><div class="ln"><div class="lb">' + s.n + (d.nm ? '<small>' + esc(d.nm) + '</small>' : off ? '<small>NOT USED · TOP ' + LB.tier(r) + '</small>' : '') + '</div>' +
        ['h', 'wo', 'po'].map(function (f) {
          var val = d[f] || (f === 'h' ? '#' : '—');
          return '<button class="' + fieldClass(r, d, f) + '" data-act="fld" data-e="' + ek + '" data-s="' + s.k + '" data-f="' + f + '"' + (off ? ' disabled' : '') + '>' + esc(val) + '</button>';
        }).join('') + '</div>';
      if (!off) {
        h += '<div class="bets">';
        if (bets.length) {
          bets.forEach(function (b) {
            var p = LB.betPnl(b, r), vd = p === 0 && (r.abandoned || LB.isNR(r, b.h)), cls = vd ? ' void' : p === null ? '' : p > 0 ? ' win' : ' loss';
            h += '<button class="placed' + cls + '" data-act="bet" data-b="' + b.id + '">' + b.type + ' ' + money(b.stake) + (vd ? ' · VOID' : p !== null ? ' · ' + money(p, true) : b.wo || b.po ? ' @ ' + esc(b.type === 'PLACE' ? b.po : b.wo) : '') + '</button>';
          });
        }
        ['WIN', 'PLACE', 'EW'].forEach(function (t) {
          h += '<button class="bb" data-act="newBet" data-e="' + ek + '" data-s="' + s.k + '" data-t="' + t + '"' + (d.h ? '' : ' disabled') + '>' + t + '</button>';
        });
        if (out && out !== 'X') h += '<span class="oc ' + out + '">' + (out === 'W' ? 'WON' : out === 'P' ? 'PLACED' : out === 'N' ? 'NON-RUNNER · VOID' : 'MISS') + '</span>';
        h += '</div>';
      }
      h += '</div>';
      delete d._k;
    });
    if (n < 5) h += '<div class="offnote">TOP ' + LB.tier(r) + ' RACE: ' + (5 - n) + ' SLOT' + (5 - n > 1 ? 'S' : '') + ' NOT USED. EMPTY SLOTS NEVER COUNT AS A MISS.</div>';
    var multis = (r.bets || []).filter(function (b) { return b.type === 'ANY'; });
    if (multis.length) {
      h += '<div class="pad stack" style="margin-top:4px">' + multis.map(function (b) {
        var p = LB.betPnl(b, r), vd = p === 0 && (r.abandoned || b.legs.every(function (l) { return LB.isNR(r, l.h); }));
        return '<button class="placed' + (vd ? ' void' : p === null ? '' : p > 0 ? ' win' : ' loss') + '" style="min-height:44px" data-act="bet" data-b="' + b.id + '">ANY-WINS MULTI ' + b.legs.map(function (l) { return (LB.isNR(r, l.h) ? 'NR' : '#') + l.h; }).join(' ') + ' · ' + money(b.stake) + ' @ ' + esc(b.co || '?') + (vd ? ' · VOID' : p !== null ? ' · ' + money(p, true) : '') + '</button>';
      }).join('') + '</div>';
    }
    return h;
  }
  function gridHtml(r) {
    var n = LB.slotCount(r);
    var h = '<div class="grid"><div class="gr hd"><span style="text-align:left;color:var(--dim)">SLOT</span>' + ENGINES.map(function (e) { return '<span style="color:var(--c-' + e.k + ')">' + e.n + '</span>'; }).join('') + '</div>';
    SLOTS.forEach(function (s, i) {
      h += '<div class="gr' + (i >= n ? ' off' : '') + '"><span class="sl">' + s.n + '</span>' + ENGINES.map(function (e) {
        var d = r.picks[e.k][s.k], lv = d.h && i < n ? LB.agreeLevel(r, d.h) : 0, out = LB.outcome(r, e.k, i);
        if (d.h && LB.isNR(r, d.h)) lv = -1;
        return '<div class="c"><button class="h ' + (d.h ? (lv === -1 ? 'nr' : lv >= 2 ? 'ag' + lv : '') : 'e') + '" data-act="fld" data-e="' + e.k + '" data-s="' + s.k + '" data-f="h"' + (i >= n ? ' disabled' : '') + '>' + (d.h ? esc(d.h) : '·') + '</button>' +
          '<span class="o">' + (out && out !== 'X' ? (out === 'W' ? 'WON' : out === 'P' ? 'PLACED' : out === 'N' ? 'NR' : 'MISS') : (d.wo ? esc(d.wo) : '')) + '</span></div>';
      }).join('') + '</div>';
    });
    h += '</div><div class="legend"><span><i style="background:var(--gold)"></i>All 3 agree</span><span><i style="background:var(--silver)"></i>2 agree</span><span><i style="background:var(--panel2);border:1px solid var(--line2)"></i>Single pick</span></div>';
    return h;
  }
  function resultHtml(r) {
    var st = LB.stage(r, Date.now(), cfg());
    if (r.abandoned) return '';
    if (!LB.resultOk(r)) {
      if (st.k !== 'result') return '<div class="pad" style="margin-top:12px"><button class="btn ghost full" data-act="result">Enter result early</button></div>';
      return '<div class="resbox need"><div style="display:flex;justify-content:space-between;align-items:center"><span class="cap" style="color:var(--red-soft)">RESULT NEEDED</span><span class="cap">TOP ' + LB.tier(r) + ' PAYS</span></div><button class="btn gold full" data-act="result">Enter finishing order</button></div>';
    }
    var o = r.result.order;
    var h = '<div class="resbox"><div style="display:flex;justify-content:space-between;align-items:center"><span class="cap">RESULT</span><button class="cap" style="color:var(--gold);padding:6px 0" data-act="result">EDIT</button></div>';
    h += '<div class="order">' + [0, 1, 2, 3].map(function (i) {
      var hn = o[i];
      return '<div class="' + (i === 0 ? 'first' : '') + '"><span>' + ['1ST', '2ND', '3RD', '4TH'][i] + '</span><b>' + (hn ? esc(hn) : '–') + '</b></div>';
    }).join('') + '</div>';
    ENGINES.forEach(function (e) {
      if (!LB.hasPicks(r, e.k)) return;
      var tot = 0, cnt = 0;
      h += '<div class="score"><span class="e" style="color:var(--c-' + e.k + ')">' + e.n + '</span><span class="cells">' + SLOTS.map(function (s, i) {
        var oc = LB.outcome(r, e.k, i), d = r.picks[e.k][s.k];
        if (oc && oc !== 'X' && oc !== 'N') { cnt++; if (oc !== 'L') tot++; }
        return '<span class="' + (oc || '') + '">' + (d.h && oc !== 'X' ? esc(oc === 'N' ? 'NR' : d.h) : '') + '</span>';
      }).join('') + '</span><span class="tot">' + tot + '/' + cnt + '</span></div>';
    });
    var ag = LB.agreement(r).filter(function (x) { return x.n >= 2; });
    var notes = [];
    if (ag.length) {
      var g3 = ag.filter(function (x) { return x.n === 3; }), g2 = ag.filter(function (x) { return x.n === 2; });
      var placed = function (x) { var p = LB.position(r, x.h); return p > 0 && p <= LB.tier(r); };
      if (g3.length) notes.push('ALL-3 PICKS: ' + g3.filter(placed).length + ' OF ' + g3.length + ' PLACED');
      if (g2.length) notes.push('2-AGREE PICKS: ' + g2.filter(placed).length + ' OF ' + g2.length + ' PLACED');
    }
    var picked = {}; ENGINES.forEach(function (e) { SLOTS.forEach(function (s, i) { if (LB.slotActive(r, i) && r.picks[e.k][s.k].h) picked[r.picks[e.k][s.k].h] = 1; }); });
    var missed = o.slice(0, LB.tier(r)).filter(function (x) { return !picked[x]; });
    if (missed.length) notes.push('PLACED, NO ENGINE HAD IT: #' + missed.join(' #'));
    if (r.swaps && r.swaps.length) notes.push('SWAPS AFTER ODDS CHECK: ' + r.swaps.map(function (w) { return engOf(w.eng).s + ' ' + slotOf(w.slot).s + ' ' + w.from + '→' + w.to; }).join(', '));
    var pnl = LB.racePnl(r);
    if (pnl !== null) notes.push('RACE P&L: ' + money(pnl, true));
    if (notes.length) h += '<div class="note">' + notes.map(esc).join('<br>') + '</div>';
    h += '</div>';
    return h;
  }

  /* ---------- RESULTS ---------- */
  function resultsView() {
    var now = Date.now(), need = LB.resultsNeeded(S.races, now, cfg()), fin = LB.finished(S.races, S.ui.day), tab = S.ui.resTab;
    var h = '<header class="hdr"><div><div class="cap">RESULTS</div><div class="daynav" style="margin-top:2px"><button data-act="day" data-n="-1" aria-label="Previous day">' + I.left + '</button><span class="d">' + fmtDay(S.ui.day) + '</span><button data-act="day" data-n="1" aria-label="Next day">' + I.right + '</button></div></div><div class="spacer"></div><div class="clock mono" data-clock style="font-size:20px">' + clockHtml() + '</div></header><div class="scroll">';
    h += '<div class="seg"><button class="' + (tab === 'need' ? 'on red' : '') + '" data-act="resTab" data-t="need">NEEDED · ' + need.length + '</button><button class="' + (tab === 'fin' ? 'on' : '') + '" data-act="resTab" data-t="fin">FINISHED · ' + fin.length + '</button></div>';
    if (tab === 'need') {
      if (!need.length) h += '<div class="empty"><b>All results entered</b>Races you played (picks or bets) appear here as soon as they jump. Races you didn\'t play never ask for a result.</div>';
      else {
        h += '<div class="sec"><span class="cap">NOT ENTERED YET · OLDEST FIRST</span></div><div class="pad stack">';
        need.forEach(function (r) {
          var ago = Math.round((now - LB.jumpAt(r)) / 60000);
          h += '<div class="need"><div class="top"><div style="min-width:0"><b style="font-size:15px">' + esc(raceName(r)) + '</b><div class="ago">OFF ' + LB.hhmm(LB.jumpAt(r)) + ' · ' + (ago < 120 ? ago + ' MIN AGO' : Math.round(ago / 60) + ' H AGO') + (r.day !== S.ui.day ? ' · ' + r.day.slice(5) : '') + '</div></div><span class="cap">TOP ' + LB.tier(r) + '</span></div>' +
            '<div style="display:flex;gap:8px"><button class="btn gold" style="flex:1" data-act="resultFor" data-id="' + r.id + '">Enter finishing order</button><button class="btn ghost" data-act="open" data-id="' + r.id + '">Open</button></div></div>';
        });
        h += '</div>';
      }
    } else {
      if (!fin.length) h += '<div class="empty"><b>No finished races for this day</b>Use the arrows above to look at other days.</div>';
      else {
        h += '<div class="sec"><span class="cap">NEWEST FIRST</span><span class="cap">HITS</span></div><div class="pad stack">';
        fin.forEach(function (r) {
          if (!LB.resultOk(r)) { h += '<button class="fin" data-act="open" data-id="' + r.id + '"><span class="main"><b>' + esc(raceName(r)) + '</b><span style="color:var(--orange)">ABANDONED · BETS VOID</span></span></button>'; return; }
          h += '<button class="fin" data-act="open" data-id="' + r.id + '"><span class="main"><b>' + esc(raceName(r)) + '</b><span>' + esc(r.result.order.join('-')) + ' · TOP ' + LB.tier(r) + '</span></span>' +
            ENGINES.map(function (e) {
              if (!LB.hasPicks(r, e.k)) return '';
              var t = 0, c = 0; SLOTS.forEach(function (s, i) { var o = LB.outcome(r, e.k, i); if (o && o !== 'X' && o !== 'N') { c++; if (o !== 'L') t++; } });
              return '<span class="eh" style="color:var(--c-' + e.k + ')">' + e.s + ' ' + t + '/' + c + '</span>';
            }).join('') + '</button>';
        });
        h += '</div>';
      }
    }
    h += '</div>';
    return h;
  }

  /* ---------- LAB ---------- */
  function labView() {
    var f = S.ui.labF, from = '';
    if (f.period !== 'all') from = daysAgo(parseInt(f.period, 10));
    var S2 = LB.stats(S.races, { country: f.country, from: from, track: f.track });
    var h = '<header class="hdr"><div><div class="cap">THE LAB</div><div style="font-size:18px;font-weight:700;margin-top:2px">Engine performance</div></div><div class="spacer"></div><button class="iconbtn sm" data-act="settings" aria-label="Settings">' + I.gear + '</button></header><div class="scroll">';
    if (!S.allLoaded) h += '<div class="empty"><b>Loading full history…</b></div>';
    var countries = {}; S.races.forEach(function (r) { if (LB.resultOk(r)) countries[r.country] = 1; });
    h += '<div class="filters">' + [['7', '7 DAYS'], ['30', '30 DAYS'], ['90', '90 DAYS'], ['all', 'ALL TIME']].map(function (p) {
      return '<button class="fbtn' + (f.period === p[0] ? ' on' : '') + '" data-act="labPeriod" data-p="' + p[0] + '">' + p[1] + '</button>';
    }).join('') + '</div>';
    h += '<div class="filters"><button class="fbtn' + (!f.country ? ' on' : '') + '" data-act="labCountry" data-c="">ALL COUNTRIES</button>' + LB.COUNTRIES.filter(function (c) { return countries[c.k]; }).map(function (c) {
      return '<button class="fbtn' + (f.country === c.k ? ' on' : '') + '" data-act="labCountry" data-c="' + c.k + '">' + c.n.toUpperCase() + '</button>';
    }).join('') + '</div>';
    if (f.track) h += '<div class="filters"><button class="fbtn on" data-act="labTrack" data-t="">' + esc(f.track.split('|')[1]) + ' ✕</button></div>';
    if (!S2.races) { h += '<div class="empty"><b>No settled races here yet</b>Stats fill in as you enter results.</div></div>'; return h; }
    function pc(t, k) { return t.n ? LB.pct(t[k], t.n) + '%' : '—'; }
    // engines
    var rank = ENGINES.slice().sort(function (a, b) { var A = S2.eng[a.k], B = S2.eng[b.k]; return (B.n ? B.p / B.n : -1) - (A.n ? A.p / A.n : -1); });
    h += '<div class="card"><h3><span>LEADERBOARD</span><span>' + S2.races + ' RACES</span></h3><table class="lt"><tr><th>ENGINE</th><th>PICKS</th><th>WIN</th><th>PLACE</th></tr>' +
      rank.map(function (e) { var t = S2.eng[e.k]; return '<tr><td style="color:var(--c-' + e.k + ')">' + e.n + '</td><td>' + t.n + '</td><td>' + pc(t, 'w') + '</td><td>' + pc(t, 'p') + '</td></tr>'; }).join('') + '</table></div>';
    // agreement
    h += '<div class="card"><h3><span>DOES AGREEMENT PAY?</span><span>PLACE %</span></h3>' + [[3, 'All 3 agree', 'var(--gold)'], [2, '2 agree', 'var(--silver)'], [1, 'Single pick', 'var(--dim)']].map(function (a) {
      var t = S2.agree[a[0]], p = t.n ? LB.pct(t.p, t.n) : 0;
      return '<div class="bar"><span class="l" style="color:' + a[2] + '">' + a[1] + '</span><span class="t"><i style="width:' + p + '%;background:' + a[2] + '"></i></span><span class="v">' + (t.n ? p + '%' : '—') + ' <small style="color:var(--dim)">n' + t.n + '</small></span></div>';
    }).join('') + '<div class="hint" style="margin-top:6px">Each horse counted once per race. Small samples (n under 30) move a lot.</div></div>';
    // slot heat
    h += '<div class="card"><h3><span>SLOT × ENGINE</span><span>PLACE %</span></h3><div class="heat"><span></span>' + ENGINES.map(function (e) { return '<span class="hh" style="color:var(--c-' + e.k + ')">' + e.s + '</span>'; }).join('');
    SLOTS.forEach(function (s) {
      h += '<span>' + s.n + '</span>' + ENGINES.map(function (e) {
        var t = S2.slot[e.k][s.k], p = t.n ? t.p / t.n : 0;
        var bg = t.n ? 'rgba(242,193,78,' + (0.08 + p * 0.62).toFixed(2) + ')' : 'var(--panel2)';
        return '<span class="v" style="background:' + bg + ';color:' + (p > 0.55 ? 'var(--gold-ink)' : 'var(--text)') + '">' + (t.n ? Math.round(p * 100) + '%' : '—') + '</span>';
      }).join('');
    });
    h += '</div><div class="hint" style="margin-top:8px">Brighter = places more often for that slot.</div></div>';
    // ROI
    var roiRows = ENGINES.map(function (e) { return [e.n, S2.roi[e.k], 'var(--c-' + e.k + ')']; }).concat([['Any-wins multi', S2.roi.multi, 'var(--text)']]).filter(function (x) { return x[1].stake; });
    if (roiRows.length) {
      h += '<div class="card"><h3><span>BETTING ROI</span><span>SETTLED BETS</span></h3><table class="lt"><tr><th>BETS ON</th><th>STAKED</th><th>P&amp;L</th><th>ROI</th></tr>' + roiRows.map(function (x) {
        var roi = x[1].stake ? Math.round(x[1].pnl / x[1].stake * 100) : 0;
        return '<tr><td style="color:' + x[2] + '">' + x[0] + '</td><td>' + money(x[1].stake) + '</td><td class="' + (x[1].pnl >= 0 ? 'ok' : 'bad') + '">' + money(x[1].pnl, true) + '</td><td class="' + (roi >= 0 ? 'ok' : 'bad') + '">' + (roi > 0 ? '+' : '') + roi + '%</td></tr>';
      }).join('') + '</table></div>';
    }
    // countries
    var cks = Object.keys(S2.country);
    if (cks.length > 1) {
      h += '<div class="card"><h3><span>BY COUNTRY</span><span>PLACE %</span></h3><table class="lt"><tr><th>COUNTRY</th>' + ENGINES.map(function (e) { return '<th style="color:var(--c-' + e.k + ')">' + e.s + '</th>'; }).join('') + '</tr>' +
        cks.map(function (k) { return '<tr><td>' + esc((LB.COUNTRIES.filter(function (c) { return c.k === k; })[0] || {}).n || k) + '</td>' + ENGINES.map(function (e) { return '<td>' + pc(S2.country[k][e.k], 'p') + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>';
    }
    // tracks
    var tracks = Object.keys(S2.track).map(function (k) { return { k: k, t: S2.track[k] }; }).sort(function (a, b) { return b.t.races - a.t.races; });
    h += '<div class="card"><h3><span>TRACKS</span><span>PLACE % · TAP TO FILTER</span></h3><input class="search" id="trackSearch" placeholder="Search track…" autocomplete="off" inputmode="search" value="' + esc(S.ui.labQ || '') + '"><div id="trackTable" style="margin-top:8px">' + trackTable(tracks, S.ui.labQ || '') + '</div></div>';
    h += '</div>';
    return h;
  }
  function trackTable(tracks, q) {
    q = (q || '').toLowerCase();
    var list = tracks.filter(function (x) { return !q || x.t.track.toLowerCase().indexOf(q) > -1; }).slice(0, 40);
    if (!list.length) return '<div class="hint">No tracks match.</div>';
    return '<table class="lt"><tr><th>TRACK</th><th>RACES</th>' + ENGINES.map(function (e) { return '<th style="color:var(--c-' + e.k + ')">' + e.s + '</th>'; }).join('') + '</tr>' +
      list.map(function (x) {
        return '<tr data-act="labTrack" data-t="' + esc(x.k) + '" style="cursor:pointer"><td>' + esc(x.t.track) + '<small>' + ccode(x.t.country) + '</small></td><td>' + x.t.races + '</td>' + ENGINES.map(function (e) { var t = x.t[e.k]; return '<td>' + (t.n ? LB.pct(t.p, t.n) + '%' : '—') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table>';
  }
  var labTracksCache = null;

  /* =========================================================
     LAYER — keypad, sheets, alerts, toasts
     ========================================================= */
  var toastState = null;
  function sheetLayerHtml() {
    var h = '';
    if (S.sheet) { h += '<div class="scrim' + (sheetData._shown ? '' : ' in') + '" data-act="scrim">' + sheetHtml() + '</div>'; sheetData._shown = true; }
    if (S.kp) { h += '<div class="scrim' + (S.kp.shown ? '' : ' in') + '" data-act="kpClose" style="z-index:60">' + kpHtml() + '</div>'; S.kp.shown = true; }
    return h;
  }
  function layerHtml() {
    var h = '';
    var a = currentAlert();
    if (a) { h += alertHtml(a).replace('class="alert odds"', 'class="alert odds' + (a.shown ? '' : ' in') + '"'); a.shown = true; }
    var bh = '';
    if (!a && S.cardBanners.length && !S.sheet && !S.kp) bh = bannerHtml(); // chime still plays; banner waits until the form/keypad closes
    h += bh;
    // Messages sit above the banner, never on top of its buttons
    var tpos = a ? ' top' : !bh ? '' : (bh.indexOf('banner mini') > -1 ? ' abmini' : ' ab') + (bh.indexOf(' low') > -1 ? 'low' : '');
    if (toastState) h += '<div class="toast' + tpos + (toastState.shown ? '' : ' in') + '"><span>' + esc(toastState.msg) + '</span>' + (toastState.undo ? '<button data-act="undo">UNDO</button>' : '') + '</div>';
    return h;
  }
  function toast(msg, undo) {
    toastState = { msg: msg, undo: undo || null };
    renderLayer(); toastState.shown = true;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { toastState = null; renderLayer(); }, undo ? 5000 : 2600);
  }

  /* ---------- KEYPAD ---------- */
  // kinds: slot (sequence of fields), stake, num (generic), result
  function openSlotKp(r, ek, sk, f) {
    var n = LB.slotCount(r), fields = [];
    SLOTS.forEach(function (s, i) { if (i < n) ['h', 'wo', 'po'].forEach(function (x) { fields.push({ eng: ek, slot: s.k, f: x }); }); });
    var i = 0;
    fields.forEach(function (x, j) { if (x.slot === sk && x.f === f) i = j; });
    S.kp = { kind: 'slot', raceId: r.id, eng: ek, fields: fields, i: i, fresh: true, startH: r.picks[ek][sk].h };
    if (S.ui.eng === 'grid') { S.kp.fields = fields.filter(function (x) { return x.f === 'h'; }); S.kp.i = Math.max(0, S.kp.fields.findIndex(function (x) { return x.slot === sk; })); }
    render();
  }
  function kpField() { var k = S.kp; return k.fields[k.i]; }
  function kpValue() {
    var k = S.kp;
    if (k.kind === 'slot') { var r = getRace(k.raceId), fd = kpField(); return String(r.picks[fd.eng][fd.slot][fd.f] || ''); }
    return String(k.value || '');
  }
  function kpSet(v) {
    var k = S.kp;
    if (k.kind === 'slot') {
      var r = getRace(k.raceId), fd = kpField();
      r.picks[fd.eng][fd.slot][fd.f] = v;
      if (fd.f === 'h' && !v) r.picks[fd.eng][fd.slot].nm = '';
      persist(r);
    } else k.value = v;
  }
  function kpMode() {
    var k = S.kp;
    if (k.kind === 'slot') return kpField().f === 'h' ? 'int' : 'dec';
    return k.mode || 'int';
  }
  function kpHtml() {
    var k = S.kp, mode = kpMode(), v = kpValue(), label, what;
    if (k.kind === 'slot') {
      var fd = kpField(), r = getRace(k.raceId);
      label = engOf(fd.eng).n.toUpperCase() + ' · ' + slotOf(fd.slot).n + ' · ' + (fd.f === 'h' ? 'HORSE #' : fd.f === 'wo' ? 'WIN ODDS' : 'PLACE ODDS');
      what = raceName(r) + (r.picks[fd.eng][fd.slot].nm ? ' · ' + r.picks[fd.eng][fd.slot].nm : '');
    } else { label = k.label; what = k.what || ''; }
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    var special = mode === 'dec' ? '.' : mode === 'result' ? '-' : mode === 'time' ? ':' : mode === 'sign' ? '−' : '';
    var h = '<div class="kp" data-stop>';
    if (k.quick && k.quick.length) h += '<div class="quick">' + k.quick.map(function (q) { return '<button data-act="kpQuick" data-v="' + esc(q.v) + '">' + esc(q.l) + '</button>'; }).join('') + '</div>';
    h += '<div class="disp"><div class="what"><span>' + esc(label) + '</span><b>' + esc(what) + '</b></div><div class="val' + (v ? '' : ' empty') + '">' + (v ? esc(v) : (mode === 'result' ? '12-3-7' : '—')) + '</div></div><div class="keys">';
    keys.forEach(function (d) { h += '<button class="k" data-act="key" data-k="' + d + '">' + d + '</button>'; });
    h += special ? '<button class="k dot" data-act="key" data-k="' + special + '" aria-label="' + (special === '.' ? 'Decimal point' : special === '-' ? 'Dash' : special) + '">' + special + '</button>' : '<button class="k alt" data-act="key" data-k="C">CLR</button>';
    h += '<button class="k" data-act="key" data-k="0">0</button><button class="k alt" data-act="key" data-k="B" aria-label="Delete">' + I.del + '</button></div>';
    if (k.kind === 'slot') {
      var last = k.i >= k.fields.length - 1;
      h += '<div class="nav2"><button class="prev" data-act="kpPrev"' + (k.i === 0 ? ' disabled' : '') + '>Prev</button><button class="clr" data-act="kpDone">Done</button><button class="next" data-act="kpNext">' + (last ? 'Finish' : 'Next') + '</button></div>';
    } else {
      h += '<div class="nav2" style="grid-template-columns:1fr 1.6fr"><button class="prev" data-act="kpClose">Cancel</button><button class="next" data-act="kpOk">' + esc(k.ok || 'Save') + '</button></div>';
    }
    return h + '</div>';
  }
  function kpKey(key) {
    var k = S.kp, v = kpValue(), mode = kpMode();
    if (k.fresh && key !== 'B' && key !== 'C') { v = ''; }
    k.fresh = false;
    if (key === 'B') v = v.slice(0, -1);
    else if (key === 'C') v = '';
    else if (key === '.') { if (v.indexOf('.') < 0) v = (v || '0') + '.'; }
    else if (key === '-') { if (v && v.slice(-1) !== '-') v += '-'; }
    else if (key === ':') { if (v && v.indexOf(':') < 0) v += ':'; }
    else if (key === '−') { v = v.charAt(0) === '-' ? v.slice(1) : '-' + v; }
    else {
      if (mode === 'int' && k.kind === 'slot' && v.length >= 2) v = '';
      if (mode === 'dec') { var p = v.split('.'); if (p[1] !== undefined && p[1].length >= 2) return; if (p[0].length >= 4 && p[1] === undefined) return; }
      if (mode === 'time') { if (v.replace(':', '').length >= 4) return; if (v.length === 2 && v.indexOf(':') < 0) v += ':'; }
      if (mode === 'int' && v.length >= 7) return;
      v += key;
    }
    kpSet(v);
    vib(8);
    // auto-advance horse number when it cannot get another digit
    if (k.kind === 'slot' && mode === 'int' && key >= '0' && key <= '9') {
      var r = getRace(k.raceId), runners = parseInt(r.runners, 10) || 24;
      if (v.length >= 2 || parseInt(v, 10) * 10 > runners) { kpNext(); return; }
    }
    render();
  }
  function commitSlotField() {
    var k = S.kp; if (!k || k.kind !== 'slot') return;
    var r = getRace(k.raceId), fd = kpField(); if (!r || !fd) return;
    var d = r.picks[fd.eng][fd.slot];
    if (fd.f === 'h') {
      d.h = d.h ? String(parseInt(d.h, 10)) : '';
      if (k.startH && d.h && k.startH !== d.h) {
        d.nm = '';
        if (r.fired && r.fired.o) { r.swaps = r.swaps || []; r.swaps.push({ eng: fd.eng, slot: fd.slot, from: k.startH, to: d.h, t: Date.now() }); }
      }
    } else if (d[fd.f]) {
      var x = parseFloat(d[fd.f]); d[fd.f] = isFinite(x) && x > 0 ? String(d[fd.f]).replace(/\.$/, '') : '';
    }
    persist(r);
  }
  function kpMove(step) {
    var k = S.kp;
    commitSlotField();
    k.i = Math.max(0, Math.min(k.fields.length - 1, k.i + step));
    var r = getRace(k.raceId), fd = kpField();
    k.startH = r.picks[fd.eng][fd.slot].h;
    k.fresh = true;
    render();
  }
  function kpNext() {
    var k = S.kp;
    if (k.i >= k.fields.length - 1) { commitSlotField(); S.kp = null; render(); return; }
    kpMove(1);
  }
  function openNumKp(o) { S.kp = Object.assign({ kind: 'num', value: o.value || '', fresh: !!o.value }, o); render(); }

  /* ---------- SHEETS ---------- */
  var sheetData = {};
  function openSheet(name, data) { S.sheet = name; sheetData = data || {}; render(); }
  function closeSheet() { S.sheet = null; sheetData = {}; render(); }
  // A box's value: what the person typed (kept in sheetData as they type), else the default
  function sv(k, dflt) { return sheetData[k] !== undefined ? sheetData[k] : (dflt === undefined || dflt === null ? '' : String(dflt)); }
  function sheetWrap(title, body, foot) {
    return '<div class="sheet" data-stop><div class="sh"><b>' + title + '</b><button class="iconbtn sm" data-act="closeSheet" aria-label="Close">✕</button></div><div class="sb">' + body + '</div>' + (foot ? '<div class="sf">' + foot + '</div>' : '') + '</div>';
  }
  function sheetHtml() {
    var d = sheetData, r = d.raceId ? getRace(d.raceId) : null;
    switch (S.sheet) {
      case 'addRace': return addRaceSheet(d);
      case 'paste': return pasteSheet(d, r);
      case 'tier':
        return sheetWrap('Payout tier · ' + esc(raceName(r)), '<div class="hint">Auto works it out from country and runners (' + ccode(r.country) + ', ' + (r.runners || '?') + ' runners → top ' + LB.autoTier(r.country, r.runners) + '). Set it by hand only if TABtouch pays differently.</div><div class="opts">' +
          [[0, 'AUTO · TOP ' + LB.autoTier(r.country, r.runners)], [1, 'WIN ONLY'], [2, 'TOP 2'], [3, 'TOP 3'], [4, 'TOP 4']].map(function (o) { return '<button class="opt' + ((r.pay || 0) === o[0] ? ' on' : '') + '" data-act="setTier" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>');
      case 'raceMenu': return raceMenuSheet(r);
      case 'editRace': return editRaceSheet(r);
      case 'bet': return betSheet(r, d.betId);
      case 'multi': return multiSheet(r, d);
      case 'settings': return settingsSheet();
      case 'sync': return syncSheet();
    }
    return '';
  }
  function addRaceSheet(d) {
    var c = d.country || S.dev.lastCountry || 'AU';
    var body = '<div><span class="lbl">COUNTRY</span><div class="opts">' + LB.COUNTRIES.map(function (x) { return '<button class="opt' + (x.k === c ? ' on' : '') + '" data-act="arCountry" data-c="' + x.k + '">' + (x.k === 'GB' ? 'UK' : x.k) + '</button>'; }).join('') + '</div></div>' +
      '<div><span class="lbl">TRACK</span><input class="inp" id="arTrack" data-bind="track" autocomplete="off" placeholder="Type first letters…" value="' + esc(d.track || '') + '"><div class="ac" id="arAc"></div></div>' +
      '<div class="g3"><div><span class="lbl">RACE NO.</span><input class="inp mono" id="arRno" data-bind="rno" inputmode="numeric" placeholder="5" value="' + esc(d.rno || '') + '"></div>' +
      '<div><span class="lbl">TIME (IST)</span><input class="inp mono" id="arTime" data-bind="time" inputmode="numeric" placeholder="10:40" value="' + esc(d.time || '') + '"></div>' +
      '<div><span class="lbl">RUNNERS</span><input class="inp mono" id="arRun" data-bind="runners" inputmode="numeric" placeholder="12" value="' + esc(d.runners || '') + '"></div></div>' +
      '<div class="hint">Race day: ' + fmtDay(S.ui.day) + '. Times before 05:00 count as after midnight (UK evening races).</div><div id="arErr" class="hint bad"></div>';
    return sheetWrap('Add race', body, '<button class="btn ghost" style="flex:1" data-act="arSave" data-next="1">Save + next</button><button class="btn gold" style="flex:1" data-act="arSave">Save</button>');
  }
  function pasteSheet(d, r) {
    var e = engOf(d.eng || S.ui.eng);
    var body = '<div class="opts">' + ENGINES.map(function (x) { return '<button class="opt' + (x.k === e.k ? ' on' : '') + '" data-act="pasteEng" data-e="' + x.k + '">' + x.n + '</button>'; }).join('') + '</div>' +
      '<textarea class="inp" id="pasteText" data-bind="text" placeholder="Paste ' + e.n + '\'s prediction table here">' + esc(d.text || '') + '</textarea><div id="pastePreview">' + pastePreview(r, d.text || '') + '</div>';
    return sheetWrap('Paste picks · ' + esc(raceName(r)), body, '<button class="btn ghost" style="flex:1" data-act="pasteClip">Paste from clipboard</button><button class="btn gold" style="flex:1" data-act="pasteApply">Fill ' + e.n + '</button>');
  }
  function pastePreview(r, text) {
    if (!text.trim()) return '<div class="hint">Works with Claude\'s table and any line like “WIN: Fenlander (2) 7.8/2.66”. You\'ll see what was found before it fills.</div>';
    var p = LB.parsePicks(text), n = LB.slotCount(r), found = 0;
    var h = '<div class="stack">' + SLOTS.map(function (s, i) {
      var x = p[s.k]; if (x) found++;
      return '<div style="display:flex;gap:10px;align-items:center;font-size:13px;' + (i >= n ? 'opacity:.4' : '') + '"><span class="mono" style="width:86px;font-size:11px;font-weight:600">' + s.n + '</span>' +
        (x ? '<b class="mono" style="width:30px">' + esc(x.h) + '</b><span style="flex:1">' + esc(x.nm) + '</span><span class="mono" style="color:var(--muted);font-size:12px">' + esc(x.wo || '') + (x.po ? ' / ' + esc(x.po) : '') + '</span>' : '<span class="bad mono" style="font-size:11px">NOT FOUND</span>') + '</div>';
    }).join('') + '</div>';
    if (!found) h = '<div class="hint bad">Nothing recognised. The table needs slot names (WIN, FAV KILLER…) and horse numbers.</div>';
    return h;
  }
  function raceMenuSheet(r) {
    var on = LB.followed(r);
    var body = '<div><span class="lbl">RACE DELAYED? MOVE JUMP TIME</span><div class="opts">' + [-1, 1, 2, 5].map(function (n) { return '<button class="opt" data-act="delay" data-n="' + n + '">' + (n > 0 ? '+' : '−') + Math.abs(n) + ' MIN</button>'; }).join('') + (r.delay ? '<button class="opt" data-act="delay" data-n="0">RESET</button>' : '') + '</div>' + (r.delay ? '<div class="hint" style="margin-top:6px">Currently +' + r.delay + ' min. Alerts move with it.</div>' : '') + '</div>' +
      '<div class="setrow"><div class="t"><b>Alerts for this race</b><span>' + (on ? 'On — chime at T−' + S.set.card + ', alarm at T−' + S.set.odds + '.' : 'Off — no sounds. ' + (LB.group(r) !== 'focus' ? 'Turn on to move it into your focus list.' : '')) + '</span></div><button class="tog' + (on ? ' on' : '') + '" data-act="follow" aria-label="Alerts for this race"></button></div>' +
      '<div class="setrow"><div class="t"><b>Alerts off for the whole meeting</b><span>All of this day\'s ' + esc(r.track) + ' races.</span></div><button class="btn ghost sm" data-act="muteMeeting">Turn off</button></div>' +
      '<span class="lbl" style="margin-top:6px">CHANGES ON THE DAY</span>' +
      '<div class="setrow"><div class="t"><b>Non-runner</b><span>' + (r.nr && r.nr.length ? 'Scratched: #' + r.nr.join(' #') + '. ' : '') + 'Bets on it are void, its slots don\'t count as a miss.</span></div><button class="btn ghost sm" data-act="nrAdd">Add</button></div>' +
      '<div class="setrow"><div class="t"><b>Race abandoned</b><span>All bets void, stakes back. Not counted in stats.</span></div><button class="tog' + (r.abandoned ? ' on' : '') + '" data-act="abandon" aria-label="Race abandoned"></button></div>' +
      '<div class="setrow"><div class="t"><b>Whole meeting abandoned</b><span>This race and every ' + esc(r.track) + ' race still to run today.</span></div><button class="btn ghost sm" data-act="abandonMeeting">Abandon</button></div>' +
      '<div class="setrow"><div class="t"><b>Skip this race</b><span>Not playing it. Moves to “Gone by”, no alerts.</span></div><button class="tog' + (r.skipped ? ' on' : '') + '" data-act="skip" aria-label="Skip race"></button></div>';
    return sheetWrap(esc(raceName(r)), body, '<button class="btn ghost" style="flex:1" data-act="editRace">Edit race</button><button class="btn ghost" style="flex:1;color:var(--red-soft)" data-act="delRace">Delete</button>');
  }
  function editRaceSheet(r) {
    var body = '<div><span class="lbl">COUNTRY</span><div class="opts">' + LB.COUNTRIES.map(function (x) { return '<button class="opt' + (x.k === (sheetData.country || r.country) ? ' on' : '') + '" data-act="erCountry" data-c="' + x.k + '">' + (x.k === 'GB' ? 'UK' : x.k) + '</button>'; }).join('') + '</div></div>' +
      '<div><span class="lbl">TRACK</span><input class="inp" id="erTrack" data-bind="erTrack" value="' + esc(sv('erTrack', r.track)) + '"></div>' +
      '<div class="g3"><div><span class="lbl">RACE NO.</span><input class="inp mono" id="erRno" data-bind="erRno" inputmode="numeric" value="' + esc(sv('erRno', r.rno)) + '"></div><div><span class="lbl">TIME</span><input class="inp mono" id="erTime" data-bind="erTime" inputmode="numeric" value="' + esc(sv('erTime', LB.hhmm(r.at))) + '"></div><div><span class="lbl">RUNNERS</span><input class="inp mono" id="erRun" data-bind="erRun" inputmode="numeric" value="' + esc(sv('erRun', r.runners || '')) + '"></div></div><div id="erErr" class="hint bad"></div>';
    return sheetWrap('Edit race', body, '<button class="btn ghost" style="flex:1" data-act="closeSheet">Cancel</button><button class="btn gold" style="flex:1.6" data-act="erSave">Save</button>');
  }
  function betSheet(r, id) {
    var b = (r.bets || []).filter(function (x) { return x.id === id; })[0];
    if (!b) return sheetWrap('Bet', '<div class="hint">Bet not found.</div>');
    var p = LB.betPnl(b, r);
    var desc = b.type === 'ANY' ? 'Any-wins multi · ' + b.legs.map(function (l) { return '#' + l.h; }).join(' ') : b.type + ' · ' + engOf(b.eng).n + ' ' + slotOf(b.slot).n + ' · #' + b.h;
    var rows = [['STAKE ₹', 'stake', b.stake]];
    if (b.type === 'ANY') rows.push(['COMBINED ODDS', 'co', b.co]);
    else { if (b.type !== 'PLACE') rows.push(['WIN ODDS', 'wo', b.wo]); if (b.type !== 'WIN') rows.push(['PLACE ODDS', 'po', b.po]); }
    rows.push(['ACTUAL RETURN ₹ (OPTIONAL)', 'ret', b.ret]);
    var body = '<div class="hint">' + esc(desc) + '</div>' + rows.map(function (x) {
      return '<div class="setrow"><div class="t"><b class="mono" style="font-size:12px;letter-spacing:.6px">' + x[0] + '</b>' + (x[1] === 'ret' ? '<span>Only if the payout differed from the odds (dead heat, deductions).</span>' : '') + '</div><button class="fld' + (x[2] === '' || x[2] == null ? ' ph' : '') + '" style="width:120px" data-act="betField" data-f="' + x[1] + '">' + (x[2] === '' || x[2] == null ? '—' : esc(x[2])) + '</button></div>';
    }).join('') + '<div class="hint">' + (p === null ? (LB.resultOk(r) ? '<span class="warn">Add the odds to settle this bet.</span>' : 'Settles automatically when you enter the result.') : 'Settled: <b class="' + (p >= 0 ? 'ok' : 'bad') + '">' + money(p, true) + '</b>') + '</div>';
    return sheetWrap('Bet', body, '<button class="btn ghost" style="flex:1;color:var(--red-soft)" data-act="delBet">Delete bet</button><button class="btn gold" style="flex:1" data-act="closeSheet">Done</button>');
  }
  function multiSheet(r, d) {
    var sel = d.sel || {}, n = LB.slotCount(r), horses = {};
    ENGINES.forEach(function (e) { SLOTS.forEach(function (s, i) { var x = r.picks[e.k][s.k]; if (i < n && x.h) { if (!horses[x.h]) horses[x.h] = { h: x.h, nm: x.nm, eng: e.k, slot: s.k }; } }); });
    var list = Object.keys(horses).sort(function (a, b) { return a - b; }).map(function (k) { return horses[k]; });
    var body = '<div class="hint">Pays if <b>any</b> selected horse wins, at the combined odds your betting site shows.</div>' +
      (list.length ? '<div class="opts">' + list.map(function (x) { var lv = LB.agreeLevel(r, x.h); return '<button class="opt' + (sel[x.h] ? ' on' : '') + '" data-act="multiPick" data-h="' + esc(x.h) + '">#' + esc(x.h) + (x.nm ? ' ' + esc(x.nm) : '') + (lv === 3 ? ' ★' : '') + '</button>'; }).join('') + '</div>' : '<div class="hint bad">Enter picks first.</div>') +
      '<div class="g2"><div><span class="lbl">COMBINED ODDS</span><button class="fld' + (d.co ? '' : ' ph') + '" data-act="multiField" data-f="co">' + esc(d.co || '—') + '</button></div><div><span class="lbl">STAKE ₹</span><button class="fld' + (d.stake ? '' : ' ph') + '" data-act="multiField" data-f="stake">' + esc(d.stake || '—') + '</button></div></div>' +
      (d.co && d.stake ? '<div class="hint">If any wins: <b class="ok">' + money(LB.num(d.stake) * (LB.num(d.co) - 1), true) + '</b></div>' : '');
    return sheetWrap('Any-wins multi', body, '<button class="btn ghost" style="flex:1" data-act="closeSheet">Cancel</button><button class="btn gold" style="flex:1.6" data-act="multiPlace">Place multi</button>');
  }
  function settingsSheet() {
    var bk = LB.bankroll(S.races, S.set);
    function tg(k, label, sub) { return '<div class="setrow"><div class="t"><b>' + label + '</b><span>' + sub + '</span></div><button class="tog' + (S.dev[k] ? ' on' : '') + '" data-act="devTog" data-k="' + k + '" aria-label="' + label + '"></button></div>'; }
    function stp(k, label, sub, min, max) { return '<div class="setrow"><div class="t"><b>' + label + '</b><span>' + sub + '</span></div><div class="step"><button data-act="step" data-k="' + k + '" data-n="-1" data-min="' + min + '" data-max="' + max + '">−</button><b>' + S.set[k] + 'm</b><button data-act="step" data-k="' + k + '" data-n="1" data-min="' + min + '" data-max="' + max + '">+</button></div></div>'; }
    var body = '<span class="lbl">RACE-DAY ALERTS</span>' +
      stp('card', 'Racecard alert', 'Soft chime this many minutes before the jump.', 5, 30) +
      stp('odds', 'Final odds alarm', 'Urgent alarm, repeats every 30 s until you act.', 1, 10) +
      tg('sound', 'Sounds', 'Alert sounds on this phone.') +
      tg('vib', 'Vibration', 'Different patterns for chime and alarm.') +
      tg('keep', 'Background mode', 'Keeps alerts running while you use TABtouch, Claude or the exchange. Uses a little more battery.') +
      '<div class="setrow"><div class="t"><b>Alarm length</b><span>How long the final odds alarm plays each time. It repeats every 30 s until you act.</span></div><div class="opts" style="flex-wrap:nowrap">' +
      [3, 6, 10].map(function (n) { return '<button class="opt' + (alarmSecs() === n ? ' on' : '') + '" data-act="alarmLen" data-n="' + n + '">' + n + 's</button>'; }).join('') + '</div></div>' +
      '<div class="g2" style="margin:4px 0 8px"><button class="btn ghost sm" data-act="testChime">Test chime</button><button class="btn ghost sm" data-act="testAlarm">Test alarm</button></div>' +
      '<span class="lbl" style="margin-top:8px">BANKROLL</span>' +
      '<div class="setrow"><div class="t"><b>Starting bankroll</b><span>Balance now: ' + money(bk.balance) + ' · in play ' + money(bk.inPlay) + '</span></div><button class="fld" style="width:120px" data-act="setBank">' + money(S.set.bank) + '</button></div>' +
      '<div class="setrow"><div class="t"><b>Deposit or withdraw</b><span>' + ((S.set.adj || []).length ? (S.set.adj || []).slice(-3).map(function (a) { return money(a.amt, true) + ' ' + a.d; }).join(' · ') : 'None yet') + '</span></div><button class="btn ghost sm" data-act="adjBank">Add</button></div>' +
      '<span class="lbl" style="margin-top:8px">SYNC</span>' +
      '<div class="setrow"><div class="t"><b>' + (S.sync.user ? 'Synced as ' + esc(S.sync.user) : 'Phone sync') + '</b><span>' + (S.sync.user ? 'Changes reach your other phones in about 1–2 seconds.' : 'Off — data stays on this phone only.') + '</span></div><button class="btn ghost sm" data-act="openSync">' + (S.sync.user ? 'Manage' : 'Set up') + '</button></div>' +
      '<span class="lbl" style="margin-top:8px">DATA</span>' +
      '<div class="g2"><button class="btn ghost sm" data-act="importDay">Load races</button><button class="btn ghost sm" data-act="pickLegacy">Import old LedgerBook</button>' +
      '<button class="btn ghost sm" data-act="exportAll">Download backup</button><button class="btn ghost sm" data-act="pickRestore">Restore backup</button></div>' +
      '<span class="lbl" style="margin-top:12px">MOTO G64 — ONE-TIME SETUP FOR RELIABLE ALERTS</span>' +
      '<div class="hint">1. Settings › Apps › Chrome › App battery usage › <b>Unrestricted</b>, and allow background usage.<br>2. Settings › Battery › turn <b>Adaptive Battery off</b>.<br>3. Search settings for “Improve battery while inactive” and turn it off if present.<br>4. Keep media volume up — alerts play through it.</div>' +
      '<div class="hint" style="margin-top:8px;color:var(--faint)">LedgerBook ' + VERSION + '</div>';
    return sheetWrap('Settings', body);
  }
  function syncSheet() {
    var body;
    if (S.sync.user) {
      body = '<div class="hint">Signed in as <b>' + esc(S.sync.user) + '</b>. Status: ' + esc(S.sync.state) + (S.sync.msg ? ' — ' + esc(S.sync.msg) : '') + '</div><button class="btn ghost" data-act="syncNow">Sync now</button><button class="btn ghost" style="color:var(--red-soft)" data-act="syncOut">Sign out on this phone</button>';
    } else {
      var hasCfg = !!S.dev.fire;
      body = '<div class="hint">Step 1 (once): paste the Firebase web config from the setup guide. Step 2: create your account on the first phone, then sign in with the same email on every other phone.</div>' +
        '<span class="lbl">FIREBASE CONFIG</span><textarea class="inp" id="fireCfg" data-bind="fireCfg" style="min-height:110px" placeholder="const firebaseConfig = { apiKey: ..., projectId: ... }">' + esc(sv('fireCfg', hasCfg ? JSON.stringify(S.dev.fire, null, 1) : '')) + '</textarea>' +
        '<span class="lbl">EMAIL</span><input class="inp" id="syncEmail" data-bind="email" type="email" autocomplete="email" placeholder="you@gmail.com" value="' + esc(sheetData.email || '') + '">' +
        '<span class="lbl">PASSWORD</span><input class="inp" id="syncPass" data-bind="pass" type="password" autocomplete="current-password" placeholder="At least 6 characters" value="' + esc(sheetData.pass || '') + '">' +
        '<div id="syncErr" class="hint bad">' + esc(S.sync.msg || '') + '</div>';
    }
    return sheetWrap('Phone sync', body, S.sync.user ? '' : '<button class="btn ghost" style="flex:1" data-act="syncUp">Create account</button><button class="btn gold" style="flex:1" data-act="syncIn">Sign in</button>');
  }

  /* ---------- ALERTS ---------- */
  function currentAlert() {
    S.alerts = S.alerts.filter(function (a) { var r = getRace(a.id); return r && LB.followed(r) && !LB.resultOk(r) && LB.jumpAt(r) - Date.now() > -60000; });
    S.alerts.sort(function (a, b) { return LB.jumpAt(getRace(a.id)) - LB.jumpAt(getRace(b.id)); });
    return S.alerts[0] || null;
  }
  function alertHtml(a) {
    var r = getRace(a.id), now = Date.now();
    var miss = ENGINES.filter(function (e) { return !LB.hasPicks(r, e.k); });
    var ag = LB.agreement(r).filter(function (x) { return x.n >= 2; });
    var nextUp = LB.upcoming(S.races, S.ui.day, now, cfg()).filter(function (x) { return x.id !== r.id && LB.followed(x); })[0];
    var h = '<div class="alert odds"><div class="ah"><span>ALERT · T−' + S.set.odds + '</span><span>' + (S.alerts.length > 1 ? (S.alerts.length - 1) + ' MORE WAITING' : 'REPEATS EVERY 30 S') + '</span></div>' +
      '<div class="ring"><small>TO JUMP</small><div class="cd" data-cd="' + r.id + '">' + LB.fmtCountdown(LB.jumpAt(r) - now) + '</div><small>' + LB.hhmm(LB.jumpAt(r)) + ' IST</small></div>' +
      '<div class="what"><div class="job">FINAL ODDS CHECK</div><b>' + esc(raceName(r)) + '</b><span>' + esc(metaLine(r)) + '</span></div>' +
      '<div class="info"><div><span>Picks entered</span><b class="mono" style="font-size:12px">' + ENGINES.map(function (e) { var ok = LB.hasPicks(r, e.k); return '<span style="color:' + (ok ? 'var(--c-' + e.k + ')' : 'var(--red)') + '">' + e.s + (ok ? ' ✓' : ' ✗') + '</span>'; }).join('  ') + '</b></div>' +
      '<div><span>Engines agree</span><b class="mono" style="font-size:12px;color:' + (ag.length ? 'var(--gold)' : 'var(--muted)') + '">' + (ag.length ? ag.map(function (x) { return '#' + x.h + (x.n === 3 ? '★' : ''); }).join(' ') : 'none yet') + '</b></div>' +
      (nextUp ? '<div><span>After this</span><b class="mono" style="font-size:12px">' + esc(raceName(nextUp)) + '</b></div>' : '') + '</div>' +
      '<div class="acts"><button class="btn red" data-act="alertOpen">Open race · enter odds</button><div class="g2"><button class="btn ghost" data-act="alertSnooze">Snooze 1 min</button><button class="btn ghost" style="color:var(--muted)" data-act="alertSkip">Skip race</button></div>' +
      (miss.length === 3 ? '' : '') + '</div></div>';
    return h;
  }
  function bannerHtml() {
    var id = S.cardBanners[0], r = getRace(id);
    if (!r) { S.cardBanners.shift(); return ''; }
    if (!S.bannerAt || S.bannerId !== id) { S.bannerAt = Date.now(); S.bannerId = id; }
    var more = S.cardBanners.length > 1 ? '<span class="cap">+' + (S.cardBanners.length - 1) + '</span>' : '';
    var pos = (S.ui.view === 'race' && !wide()) ? ' low' : '';
    if (Date.now() - S.bannerAt > 20000) {
      return '<div class="banner mini' + pos + '"><button class="bmini" data-act="bannerOpen"><span class="pill">T−' + S.set.card + '</span><b>' + esc(raceName(r)) + '</b><span class="cd" data-cd="' + r.id + '">' + LB.fmtCountdown(LB.jumpAt(r) - Date.now()) + '</span>' + more + '</button><button class="bx" data-act="bannerDismiss" aria-label="Dismiss">✕</button></div>';
    }
    return '<div class="banner' + pos + '"><div class="now blue" style="margin:0;box-shadow:0 14px 34px rgba(0,0,0,.7)">' +
      '<div class="top"><div style="display:flex;align-items:center;gap:8px"><span class="pill">T−' + S.set.card + '</span><span class="job">UPLOAD RACECARD</span></div>' + more + '</div>' +
      '<div class="mid"><div><div class="nm">' + esc(raceName(r)) + '</div><div class="sub">' + esc(metaLine(r)) + '</div></div><div class="cd" data-cd="' + r.id + '">' + LB.fmtCountdown(LB.jumpAt(r) - Date.now()) + '</div></div>' +
      '<div class="g2"><button class="btn ghost" data-act="bannerDismiss">Dismiss</button><button class="btn blue" data-act="bannerOpen">Open race</button></div></div></div>';
  }
  function checkAlerts() {
    var now = Date.now(), due = LB.dueAlerts(S.races, S.ui.day, now, cfg());
    if (S.ui.day !== LB.defaultDay(now)) due = due.concat(LB.dueAlerts(S.races, LB.defaultDay(now), now, cfg()));
    var changed = false, wantAlarm = false, wantChime = false;
    due.forEach(function (x) {
      var r = x.r;
      if (x.k === 'odds') {
        r.fired.o = now; r.fired.c = r.fired.c || now;
        if (!S.alerts.some(function (a) { return a.id === r.id; })) S.alerts.push({ id: r.id, k: 'odds', last: now });
        S.cardBanners = S.cardBanners.filter(function (id) { return id !== r.id; });
        wantAlarm = true;
      } else {
        r.fired.c = now;
        if (S.cardBanners.indexOf(r.id) < 0) S.cardBanners.push(r.id);
        wantChime = true;
      }
      persist(r); changed = true;
    });
    // Several races due together (opening the app late, busy Saturday) → one sound, not a pile-up
    if (wantAlarm) { Sound.alarm(); vib(alarmVib()); }
    else if (wantChime) { Sound.chime(); vib([120, 90, 120, 1100, 120, 90, 120, 1100, 120, 90, 120]); }
    if (wantAlarm) { var cur = currentAlert(); if (cur) cur.last = now; }
    // repeat alarm every 30 s while the odds alert is up
    var a = currentAlert();
    if (a && now - a.last >= 30000) { a.last = now; Sound.alarm(); vib(alarmVib()); }
    if (!a && S.alerts.length === 0 && changed === false) { /* nothing */ }
    // drop card banners once picks are in or race moved on
    var before = S.cardBanners.length;
    S.cardBanners = S.cardBanners.filter(function (id) { var r = getRace(id); return r && !LB.hasPicks(r) && LB.followed(r) && LB.stage(r, now, cfg()).k === 'card_now'; });
    var shrink = S.cardBanners.length && S.bannerAt && !S.bannerMini && now - S.bannerAt > 20000;
    if (shrink) S.bannerMini = true;
    if (!S.cardBanners.length) S.bannerMini = false;
    if (changed || shrink || before !== S.cardBanners.length) renderLayer();
  }

  /* =========================================================
     ACTIONS
     ========================================================= */
  var undoFn = null;
  var acts = {
    noop: function () { },
    arm: armRaceDay,
    nav: function (el) { S.ui.view = el.dataset.v; if (el.dataset.v === 'lab') loadAll().then(render); render(); },
    day: function (el) { S.ui.day = shiftDay(S.ui.day, +el.dataset.n); S.ui.showAll = false; S.ui.open = {}; render(); },
    showAll: function () { S.ui.showAll = !S.ui.showAll; render(); },
    fold: function (el) { var k = el.dataset.k; S.ui.open[k] = !S.ui.open[k]; render(); },
    open: function (el) { S.ui.raceId = el.dataset.id; S.ui.view = 'race'; var r = getRace(el.dataset.id); if (r && S.ui.eng !== 'grid' && LB.enginesWithPicks(r).length === 3) S.ui.eng = 'grid'; else if (S.ui.eng === 'grid' && r && LB.enginesWithPicks(r).length < 3) S.ui.eng = 'claude'; render(); var sc = root.querySelector(wide() ? '.col-b .scroll' : '.scroll'); if (sc) sc.scrollTop = 0; },
    back: function () { S.ui.view = 'home'; render(); },
    results: function (el) { S.ui.view = 'results'; S.ui.resTab = el.dataset.tab; render(); },
    resTab: function (el) { S.ui.resTab = el.dataset.t; render(); },
    eng: function (el) { S.ui.eng = el.dataset.e; render(); },
    fld: function (el) { var r = getRace(S.ui.raceId); if (!r) return; if (wide() && S.ui.view !== 'race') { } openSlotKp(r, el.dataset.e, el.dataset.s, el.dataset.f); },
    key: function (el) { kpKey(el.dataset.k); },
    kpNext: kpNext,
    kpPrev: function () { kpMove(-1); },
    kpDone: function () { commitSlotField(); S.kp = null; render(); },
    kpClose: function (el, ev) { if (ev && ev.target.closest('[data-stop]') && el.dataset.act === 'kpClose' && el.classList.contains('scrim')) return; if (S.kp && S.kp.kind === 'slot') commitSlotField(); S.kp = null; render(); },
    kpQuick: function (el) { S.kp.value = el.dataset.v; S.kp.fresh = false; render(); },
    kpOk: function () { var k = S.kp; S.kp = null; k.done(k.value || ''); },
    scrim: function (el, ev) {
      if (ev.target !== el) return;
      var forms = { addRace: 1, editRace: 1, paste: 1, sync: 1, multi: 1 };
      if (forms[S.sheet]) return; // forms with typing boxes close only with ✕ / Cancel / Save
      closeSheet();
    },
    closeSheet: closeSheet,
    // race tools
    paste: function () { openSheet('paste', { raceId: S.ui.raceId, eng: S.ui.eng === 'grid' ? 'claude' : S.ui.eng, text: '' }); },
    pasteEng: function (el) { sheetData.eng = el.dataset.e; var t = document.getElementById('pasteText'); sheetData.text = t ? t.value : ''; render(); },
    pasteClip: function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) { toast('Long-press the box and choose Paste'); return; }
      navigator.clipboard.readText().then(function (t) { sheetData.text = t; render(); }).catch(function () { toast('Long-press the box and choose Paste'); });
    },
    pasteApply: function () {
      var r = getRace(sheetData.raceId), t = document.getElementById('pasteText'), text = t ? t.value : sheetData.text || '';
      var p = LB.parsePicks(text), ek = sheetData.eng, n = 0;
      SLOTS.forEach(function (s, i) {
        if (!p[s.k] || i >= LB.slotCount(r)) return;
        var d = r.picks[ek][s.k], old = d.h;
        d.h = p[s.k].h; d.nm = p[s.k].nm || ''; if (p[s.k].wo) d.wo = p[s.k].wo; if (p[s.k].po) d.po = p[s.k].po;
        if (old && old !== d.h && r.fired && r.fired.o) { r.swaps = r.swaps || []; r.swaps.push({ eng: ek, slot: s.k, from: old, to: d.h, t: Date.now() }); }
        n++;
      });
      if (!n) { toast('Nothing recognised — check the pasted text'); return; }
      persist(r); S.ui.eng = ek; S.sheet = null; render(); toast(engOf(ek).n + ': ' + n + ' slots filled');
    },
    tier: function () { openSheet('tier', { raceId: S.ui.raceId }); },
    setTier: function (el) { var r = getRace(sheetData.raceId); r.pay = +el.dataset.v; persist(r); closeSheet(); },
    runners: function () {
      var r = getRace(S.ui.raceId);
      openNumKp({ label: 'RUNNERS (AFTER SCRATCHINGS)', what: raceName(r), mode: 'int', value: String(r.runners || ''), ok: 'Save', done: function (v) { var before = LB.tier(r); r.runners = parseInt(v, 10) || ''; persist(r); render(); if (LB.tier(r) !== before) toast('Payout tier changed to top ' + LB.tier(r)); } });
    },
    raceMenu: function () { openSheet('raceMenu', { raceId: S.ui.raceId }); },
    delay: function (el) { var r = getRace(sheetData.raceId || S.ui.raceId), n = +el.dataset.n; r.delay = n === 0 ? 0 : (r.delay || 0) + n; r.fired = { c: 0, o: 0 }; persist(r); render(); toast(n === 0 ? 'Time reset' : 'Jump moved to ' + LB.hhmm(LB.jumpAt(r))); },
    skip: function () { var r = getRace(sheetData.raceId || S.ui.raceId); r.skipped = !r.skipped; persist(r); S.alerts = S.alerts.filter(function (a) { return a.id !== r.id; }); render(); },
    follow: function () {
      var r = getRace(sheetData.raceId || S.ui.raceId); if (!r) return;
      var was = LB.followed(r);
      r.follow = !was; r.muted = false; if (!was) r.skipped = false;
      if (was) { S.alerts = S.alerts.filter(function (a) { return a.id !== r.id; }); S.cardBanners = S.cardBanners.filter(function (id) { return id !== r.id; }); }
      persist(r); render(); toast(was ? 'Alerts off for ' + raceName(r) : 'Alerts on for ' + raceName(r) + (LB.group(r) !== 'focus' ? ' — now in your focus list' : ''));
    },
    muteMeeting: function () { var r = getRace(sheetData.raceId); LB.dayRaces(S.races, r.day).forEach(function (x) { if (x.track === r.track && x.country === r.country) { x.follow = false; persist(x); S.alerts = S.alerts.filter(function (a) { return a.id !== x.id; }); } }); closeSheet(); toast('Alerts off for all ' + r.track + ' races'); },
    nrAdd: function () {
      var r = getRace(sheetData.raceId || S.ui.raceId); if (!r) return;
      S.sheet = null; sheetData = {};
      openNumKp({ label: 'NON-RUNNER · HORSE NUMBER', what: raceName(r), mode: 'int', value: '', ok: 'Mark non-runner', done: function (v) {
        var h = String(parseInt(v, 10) || ''); if (!h) return;
        r.nr = r.nr || []; if (r.nr.indexOf(h) > -1) { render(); return; }
        var before = LB.tier(r);
        r.nr.push(h); r.nr.sort(function (a, b) { return a - b; });
        if (r.runners) r.runners = Math.max(1, r.runners - 1);
        persist(r); render();
        var voids = (r.bets || []).filter(function (b) { return b.type === 'ANY' ? b.legs.some(function (l) { return l.h === h; }) : b.h === h; }).length;
        toast('#' + h + ' non-runner' + (voids ? ' · ' + voids + ' bet' + (voids > 1 ? 's' : '') + ' void' : '') + (LB.tier(r) !== before ? ' · now pays top ' + LB.tier(r) : '') + (r.runners ? ' · ' + r.runners + ' runners' : ''));
      } });
    },
    nrDel: function (el) {
      var r = getRace(S.ui.raceId), h = el.dataset.h; if (!r || !r.nr) return;
      r.nr = r.nr.filter(function (x) { return x !== h; }); if (r.runners) r.runners++;
      persist(r); render(); toast('#' + h + ' back in the race');
    },
    abandon: function () {
      var r = getRace(sheetData.raceId || S.ui.raceId); if (!r) return;
      r.abandoned = !r.abandoned;
      S.alerts = S.alerts.filter(function (a) { return a.id !== r.id; }); S.cardBanners = S.cardBanners.filter(function (id) { return id !== r.id; });
      persist(r); render();
      if (r.abandoned) toast(raceName(r) + ' abandoned · bets void', function () { r.abandoned = false; persist(r); render(); });
    },
    abandonMeeting: function () {
      var r = getRace(sheetData.raceId); if (!r) return;
      // Only races that haven't run yet (plus this one): races already run earlier on the card stand
      var now = Date.now();
      var hit = LB.dayRaces(S.races, r.day).filter(function (x) { return x.track === r.track && x.country === r.country && !LB.resultOk(x) && !x.abandoned && (x.id === r.id || LB.jumpAt(x) > now - 60000); });
      hit.forEach(function (x) { x.abandoned = true; persist(x); S.alerts = S.alerts.filter(function (a) { return a.id !== x.id; }); });
      closeSheet();
      toast(hit.length + ' ' + r.track + ' races abandoned', function () { hit.forEach(function (x) { x.abandoned = false; persist(x); }); render(); });
    },
    editRace: function () { openSheet('editRace', { raceId: sheetData.raceId || S.ui.raceId }); },
    erCountry: function (el) { sheetData.country = el.dataset.c; render(); },
    erSave: function () {
      var r = getRace(sheetData.raceId), track = val('erTrack').trim(), rno = parseInt(val('erRno'), 10), at = LB.makeAt(r.day, fixTime(val('erTime')));
      if (!track || !rno || !at) { document.getElementById('erErr').textContent = 'Check track, race number and time (e.g. 10:40).'; return; }
      r.track = track; r.rno = rno; r.at = at; r.runners = parseInt(val('erRun'), 10) || ''; if (sheetData.country) r.country = sheetData.country; r.fired = { c: 0, o: 0 };
      persist(r); closeSheet(); toast('Race updated');
    },
    delRace: function () {
      var r = getRace(sheetData.raceId); if (!r) return;
      removeLocal(r.id); S.sheet = null; S.ui.view = 'home'; S.ui.raceId = null;
      var copy = JSON.parse(JSON.stringify(r));
      DB.del(r.id); Sync.remove(r);
      render();
      toast('Deleted ' + raceName(r), function () { delete copy.deleted; upsertLocal(copy); persist(copy, { now: true }); render(); });
    },
    // bets
    newBet: function (el) {
      var r = getRace(S.ui.raceId), ek = el.dataset.e, sk = el.dataset.s, t = el.dataset.t, d = r.picks[ek][sk];
      var last = S.set.stakeLast || 100;
      openNumKp({
        label: t + ' BET · STAKE ₹', what: '#' + d.h + (d.nm ? ' ' + d.nm : '') + ' · ' + engOf(ek).s + ' ' + slotOf(sk).s + (t === 'PLACE' ? (d.po ? ' @ ' + d.po : ' · no place odds yet') : (d.wo ? ' @ ' + d.wo : ' · no win odds yet')),
        mode: 'int', value: String(last), ok: 'Place ' + t,
        quick: [100, 200, 500, 1000, 2000].map(function (v) { return { v: String(v), l: '₹' + v }; }),
        done: function (v) {
          var st = parseInt(v, 10); if (!st) return;
          r.bets = r.bets || [];
          r.bets.push({ id: LB.uid(), type: t, eng: ek, slot: sk, h: d.h, stake: st, wo: d.wo || '', po: d.po || '', ret: null, t: Date.now() });
          S.set.stakeLast = st; saveSettings(); persist(r); render();
          toast(t + ' ₹' + st + ' on #' + d.h + (t !== 'PLACE' && !d.wo || t !== 'WIN' && !d.po ? ' — add odds later to settle' : ''));
        }
      });
    },
    bet: function (el) { openSheet('bet', { raceId: S.ui.raceId, betId: el.dataset.b }); },
    betField: function (el) {
      var r = getRace(sheetData.raceId), b = r.bets.filter(function (x) { return x.id === sheetData.betId; })[0], f = el.dataset.f;
      openNumKp({ label: el.closest('.setrow').querySelector('b').textContent, what: raceName(r), mode: f === 'stake' || f === 'ret' ? 'int' : 'dec', value: b[f] == null ? '' : String(b[f]), ok: 'Save', done: function (v) { b[f] = f === 'stake' ? (parseInt(v, 10) || b.stake) : (v === '' ? (f === 'ret' ? null : '') : v); persist(r); render(); } });
    },
    delBet: function () {
      var r = getRace(sheetData.raceId), id = sheetData.betId, b = r.bets.filter(function (x) { return x.id === id; })[0];
      r.bets = r.bets.filter(function (x) { return x.id !== id; }); persist(r); closeSheet();
      toast('Bet deleted', function () { r.bets.push(b); persist(r); render(); });
    },
    multi: function () { openSheet('multi', { raceId: S.ui.raceId, sel: {}, co: '', stake: String(S.set.stakeLast || '') }); },
    multiPick: function (el) { var h = el.dataset.h; sheetData.sel[h] = !sheetData.sel[h]; render(); },
    multiField: function (el) { var f = el.dataset.f; openNumKp({ label: f === 'co' ? 'COMBINED ODDS' : 'STAKE ₹', what: 'Any-wins multi', mode: f === 'co' ? 'dec' : 'int', value: sheetData[f] || '', ok: 'OK', done: function (v) { sheetData[f] = v; render(); } }); },
    multiPlace: function () {
      var r = getRace(sheetData.raceId), hs = Object.keys(sheetData.sel).filter(function (k) { return sheetData.sel[k]; });
      if (hs.length < 2) { toast('Select at least 2 horses'); return; }
      if (!LB.num(sheetData.stake)) { toast('Enter a stake'); return; }
      if (!(LB.num(sheetData.co) > 1)) { toast('Enter the combined odds'); return; }
      r.bets = r.bets || [];
      r.bets.push({ id: LB.uid(), type: 'ANY', stake: LB.num(sheetData.stake), co: sheetData.co, legs: hs.map(function (h) { return { h: h }; }), ret: null, t: Date.now() });
      S.set.stakeLast = LB.num(sheetData.stake); saveSettings(); persist(r); closeSheet(); toast('Any-wins multi placed');
    },
    // results
    result: function () { openResultKp(getRace(S.ui.raceId)); },
    resultFor: function (el) { openResultKp(getRace(el.dataset.id)); },
    // add race
    addRace: function () { openSheet('addRace', { country: S.dev.lastCountry || 'AU' }); setTimeout(function () { var t = document.getElementById('arTrack'); if (t && !t.value) t.focus(); }, 60); },
    arCountry: function (el) { saveArInputs(); sheetData.country = el.dataset.c; S.dev.lastCountry = el.dataset.c; saveDev(); render(); },
    arPick: function (el) { var t = document.getElementById('arTrack'); t.value = el.dataset.t; sheetData.track = el.dataset.t; document.getElementById('arAc').innerHTML = ''; var n = document.getElementById('arRno'); if (n) n.focus(); },
    arSave: function (el) {
      saveArInputs();
      var d = sheetData, err = document.getElementById('arErr');
      var at = LB.makeAt(S.ui.day, fixTime(d.time)), rno = parseInt(d.rno, 10);
      if (!d.track || !d.track.trim()) { err.textContent = 'Enter a track.'; return; }
      if (!rno) { err.textContent = 'Enter the race number.'; return; }
      if (!at) { err.textContent = 'Enter the time like 10:40.'; return; }
      var r = LB.newRace({ day: S.ui.day, at: at, country: d.country, track: tidyTrack(d.track, d.country), rno: rno, runners: d.runners });
      if (S.races.some(function (x) { return LB.raceKey(x) === LB.raceKey(r); })) { err.textContent = raceName(r) + ' is already on this day.'; return; }
      S.races.push(r); persist(r, { now: true });
      if (el.dataset.next) { sheetData = { country: d.country, track: r.track, rno: String(rno + 1), time: '', runners: '' }; render(); var tm = document.getElementById('arTime'); if (tm) tm.focus(); toast('Saved ' + raceName(r)); }
      else { closeSheet(); toast('Saved ' + raceName(r)); }
    },
    // One tap: opens the phone's file picker straight away
    importDay: function () { pickFile('day'); },
    pickLegacy: function () { pickFile('legacy'); },
    pickRestore: function () { pickFile('restore'); },
    // settings
    settings: function () { openSheet('settings'); },
    devTog: function (el) { var k = el.dataset.k; S.dev[k] = !S.dev[k]; saveDev(); if (k === 'keep') { if (S.dev.keep && S.armed) Sound.startKeepAlive(); else Sound.stopKeepAlive(); } render(); },
    step: function (el) { var k = el.dataset.k; S.set[k] = Math.max(+el.dataset.min, Math.min(+el.dataset.max, S.set[k] + +el.dataset.n)); if (S.set.card <= S.set.odds) S.set.card = S.set.odds + 1; saveSettings(); render(); },
    alarmLen: function (el) { S.dev.alarmLen = +el.dataset.n; saveDev(); render(); Sound.arm(); Sound.alarm(); vib(alarmVib()); },
    testChime: function () { Sound.arm(); Sound.chime(); vib([120, 90, 120, 1100, 120, 90, 120, 1100, 120, 90, 120]); },
    testAlarm: function () { Sound.arm(); Sound.alarm(); vib(alarmVib()); },
    setBank: function () { openNumKp({ label: 'STARTING BANKROLL ₹', what: 'Your bankroll before tracked bets', mode: 'int', value: String(S.set.bank || ''), ok: 'Save', done: function (v) { S.set.bank = parseInt(v, 10) || 0; saveSettings(); render(); } }); },
    adjBank: function () {
      openNumKp({ label: 'DEPOSIT (+) OR WITHDRAW (−) ₹', what: 'Tap ± to make it a withdrawal', mode: 'sign', value: '', ok: 'Add', done: function (v) { var n = parseInt(v, 10); if (!n) return; S.set.adj = S.set.adj || []; S.set.adj.push({ amt: n, d: LB.defaultDay(Date.now()).slice(5) }); saveSettings(); render(); } });
    },
    exportAll: function () { loadAll().then(function () { download('ledgerbook-backup-' + LB.dayKey(new Date()) + '.json', JSON.stringify({ app: 'ledgerbook2', v: 1, settings: S.set, races: S.races }, null, 1)); toast('Backup downloaded'); }); },
    openSync: function () { openSheet('sync'); },
    syncUp: function () { Sync.login(true); },
    syncIn: function () { Sync.login(false); },
    syncOut: function () { Sync.logout(); },
    syncNow: function () { Sync.pushAll(); toast('Sending everything…'); },
    // lab
    labPeriod: function (el) { S.ui.labF.period = el.dataset.p; render(); },
    labCountry: function (el) { S.ui.labF.country = el.dataset.c; S.ui.labF.track = ''; render(); },
    labTrack: function (el) { S.ui.labF.track = el.dataset.t; render(); var sc = root.querySelector('.scroll'); if (sc) sc.scrollTop = 0; },
    // alerts
    alertOpen: function () { var a = currentAlert(); if (!a) return; if (S.kp) { if (S.kp.kind === 'slot') commitSlotField(); S.kp = null; } S.sheet = null; S.alerts = S.alerts.filter(function (x) { return x.id !== a.id; }); S.ui.raceId = a.id; S.ui.view = 'race'; render(); },
    alertSnooze: function () { var a = currentAlert(); if (!a) return; S.alerts = S.alerts.filter(function (x) { return x.id !== a.id; }); setTimeout(function () { var r = getRace(a.id); if (r && !LB.resultOk(r) && !r.skipped && LB.jumpAt(r) > Date.now()) { S.alerts.push({ id: a.id, k: 'odds', last: Date.now() }); Sound.alarm(); vib(alarmVib()); renderLayer(); } }, 60000); renderLayer(); },
    alertSkip: function () { var a = currentAlert(); if (!a) return; var r = getRace(a.id); r.skipped = true; persist(r); S.alerts = S.alerts.filter(function (x) { return x.id !== a.id; }); render(); toast(raceName(r) + ' skipped', function () { r.skipped = false; persist(r); render(); }); },
    bannerOpen: function () { var id = S.cardBanners.shift(); S.bannerAt = 0; S.bannerMini = false; S.ui.raceId = id; S.ui.view = 'race'; render(); },
    bannerDismiss: function () { S.cardBanners.shift(); S.bannerAt = 0; S.bannerMini = false; renderLayer(); },
    demo: function () {
      // Preview only: example races starting a few minutes from now so alerts can be tried live
      var now = new Date(), day = S.ui.day, list = [['Randwick', 5, 17, 12], ['Flemington', 6, 21, 14], ['Eagle Farm', 5, 27, 7], ['Morphettville', 4, 33, 10], ['Rosehill', 6, 40, 9], ['Caulfield', 7, 52, 16]];
      var data = { day: day, races: list.map(function (x) { var t = new Date(now.getTime() + x[2] * 60000); return { country: 'AU', track: x[0], rno: x[1], time: LB.pad(t.getHours()) + ':' + LB.pad(t.getMinutes()), runners: x[3] }; }) };
      importDayText(JSON.stringify(data));
      toast('Demo races loaded — first racecard alert in about 2 minutes');
    },
    undo: function () { var f = toastState && toastState.undo; toastState = null; if (f) f(); renderLayer(); }
  };
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function fixTime(t) { t = String(t || '').replace(/[^0-9:]/g, ''); if (t.indexOf(':') < 0 && t.length >= 3) t = t.slice(0, t.length - 2) + ':' + t.slice(-2); return t; }
  function tidyTrack(t, country) {
    t = t.trim().replace(/\s+/g, ' ');
    var known = LB.trackList(country, []).concat(S.tracks[country] || []);
    for (var i = 0; i < known.length; i++) if (known[i].toLowerCase() === t.toLowerCase()) return known[i];
    return t.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function saveArInputs() { if (S.sheet !== 'addRace') return; sheetData.track = val('arTrack'); sheetData.rno = val('arRno'); sheetData.time = val('arTime'); sheetData.runners = val('arRun'); }
  function openResultKp(r) {
    if (!r) return;
    openNumKp({
      label: 'FINISHING ORDER · TOP ' + LB.tier(r) + ' PAYS', what: raceName(r), mode: 'result', value: LB.resultOk(r) ? r.result.order.join('-') : '', ok: 'Save result',
      done: function (v) {
        var order = LB.parseResult(v);
        if (!order.length) { if (LB.resultOk(r)) { r.result = null; persist(r); render(); toast('Result cleared'); } return; }
        var dup = order.filter(function (x, i) { return order.indexOf(x) !== i; });
        if (dup.length) { toast('Horse #' + dup[0] + ' appears twice — check the order'); return; }
        r.result = { ok: true, order: order, t: Date.now() };
        S.alerts = S.alerts.filter(function (a) { return a.id !== r.id; });
        persist(r, { now: true }); render();
        var pnl = LB.racePnl(r);
        toast('Result saved' + (pnl !== null ? ' · ' + money(pnl, true) : ''));
      }
    });
  }
  function importDayText(t) {
    var data;
    var clean = t.replace(/^```(json)?|```$/gm, '').trim();
    try { data = JSON.parse(clean); } catch (e) {
      var a = clean.indexOf('{'), b = clean.lastIndexOf('}');
      try { data = JSON.parse(clean.slice(a, b + 1)); } catch (e2) { toast('No races found in that file — is it the race planner .json file?'); return; }
    }
    if (!data || !(Array.isArray(data) || Array.isArray(data.races))) { toast('No races found in that file — is it the race planner .json file?'); return; }
    if (Array.isArray(data)) data = { races: data };
    var res = LB.importDay(S.races, data, S.ui.day), now = Date.now();
    if (!res.added.length && !res.updated.length && !res.skipped) { toast('No races found in that file — is it the race planner .json file?'); return; }
    res.added.forEach(function (r) { S.races.push(r); persist(r); });
    res.updated.forEach(function (u) { persist(u.r); S.alerts = S.alerts.filter(function (a) { return a.id !== u.r.id || u.ch.indexOf('time') < 0; }); });
    // Remember which file the day came from (shown on home)
    S.set.files = S.set.files || {};
    S.set.files[res.day] = { by: res.info.by, at: res.info.at, n: LB.dayRaces(S.races, res.day).length, t: now };
    Object.keys(S.set.files).sort().slice(0, -10).forEach(function (k) { delete S.set.files[k]; });
    saveSettings();
    // Stay on today while today still has races to run; a file for another day doesn't pull you away
    var today = LB.defaultDay(now), moved = false;
    if (res.day !== S.ui.day) {
      var todayBusy = LB.upcoming(S.races, S.ui.day, now, cfg()).length > 0 && S.ui.day === today;
      if (!todayBusy) { S.ui.day = res.day; S.ui.open = {}; moved = true; }
    }
    S.sheet = null; render();
    var gone = LB.passed(S.races, res.day, now, cfg()).length;
    var msg = (res.added.length ? res.added.length + ' races loaded' : res.updated.length ? 'No new races' : 'All ' + res.skipped + ' races already in — nothing changed') +
      (res.updated.length ? ' · ' + res.updated.length + ' updated' : '') +
      (res.bad ? ' · ' + res.bad + ' unreadable' : '') +
      (gone && res.day === S.ui.day ? ' · ' + gone + ' already gone by (hidden)' : '') +
      (res.day !== S.ui.day ? ' · for ' + fmtDay(res.day) + ' — tap › to see' : '');
    toast(msg);
  }
  function download(name, text) {
    var b = new Blob([text], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* events: one delegated listener */
  root.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    var act = el.dataset.act;
    // clicks inside a sheet/keypad must not trigger the scrim's close
    if ((act === 'scrim' || act === 'kpClose') && el.classList.contains('scrim') && ev.target !== el) return;
    if (el.disabled) return;
    if (!S.armed && act !== 'arm') { Sound.arm(); }
    var fn = acts[act];
    if (fn) { ev.preventDefault(); fn(el, ev); }
  });
  root.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'arTime' || t.id === 'erTime') {
      var tv = t.value.replace(/[^0-9]/g, '').slice(0, 4);
      t.value = tv.length > 2 ? tv.slice(0, 2) + ':' + tv.slice(2) : tv;
    }
    // Every form box is remembered as it is typed, so a redraw can never wipe it
    if (t.dataset && t.dataset.bind && S.sheet) sheetData[t.dataset.bind] = t.value;
    if (t.id === 'trackSearch') S.ui.labQ = t.value;
    if (t.id === 'arTrack') {
      var list = LB.trackMatches(LB.trackList(sheetData.country || 'AU', []).concat(S.tracks[sheetData.country || 'AU'] || []).filter(function (x, i, a) { return a.indexOf(x) === i; }), t.value);
      document.getElementById('arAc').innerHTML = list.map(function (x) { return '<button data-act="arPick" data-t="' + esc(x) + '">' + esc(x) + '</button>'; }).join('');
    } else if (t.id === 'pasteText') {
      sheetData.text = t.value;
      document.getElementById('pastePreview').innerHTML = pastePreview(getRace(sheetData.raceId), t.value);
    } else if (t.id === 'trackSearch') {
      var f = S.ui.labF, from = f.period === 'all' ? '' : daysAgo(parseInt(f.period, 10));
      var S2 = LB.stats(S.races, { country: f.country, from: from });
      var tracks = Object.keys(S2.track).map(function (k) { return { k: k, t: S2.track[k] }; }).sort(function (a, b) { return b.t.races - a.t.races; });
      document.getElementById('trackTable').innerHTML = trackTable(tracks, t.value);
    }
  });
  // File picking. The box lives outside the app screen so a redraw can never remove it.
  // (On Android the app goes to the background while the file picker is open, and redraws when it comes back.)
  var filePick = document.createElement('input');
  filePick.type = 'file'; filePick.id = 'filePick'; filePick.style.display = 'none';
  document.body.appendChild(filePick);
  var pickKind = 'day';
  function pickFile(kind) { pickKind = kind; filePick.value = ''; filePick.click(); }
  filePick.addEventListener('change', function () {
    var f = filePick.files && filePick.files[0]; if (!f) return;
    var kind = pickKind, rd = new FileReader();
    rd.onload = function () { handleFile(kind, String(rd.result || '')); filePick.value = ''; };
    rd.onerror = function () { toast('Could not open that file — try saving it to Downloads first'); };
    rd.readAsText(f);
  });
  function handleFile(kind, txt) {
    if (kind === 'day') importDayText(txt);
    else if (kind === 'legacy') {
      try {
        var data = JSON.parse(txt);
        loadAll().then(function () {
          var res = LB.importLegacy(S.races, data);
          res.added.forEach(function (r) { S.races.push(r); persist(r); });
          toast(res.added.length + ' old races imported' + (res.skipped ? ' · ' + res.skipped + ' already in' : ''));
          render();
        });
      } catch (e) { toast('Could not read that file'); }
    } else if (kind === 'restore') {
      try {
        var bk = JSON.parse(txt);
        if (bk.app !== 'ledgerbook2') { toast('Not a LedgerBook v2 backup — use Import old LedgerBook'); return; }
        loadAll().then(function () {
          var have = {}; S.races.forEach(function (r) { have[r.id] = r; });
          var n = 0;
          (bk.races || []).forEach(function (r) { if (!have[r.id] || (r.u || 0) > (have[r.id].u || 0)) { upsertLocal(r); dirty[r.id] = r; n++; } });
          flush();
          if (bk.settings && !S.set.bank) { S.set = Object.assign(S.set, bk.settings); saveSettings(); }
          toast(n + ' races restored'); render();
        });
      } catch (e) { toast('Could not read that file'); }
    }
  }
  document.addEventListener('keydown', function (ev) {
    if (!S.kp) return;
    if (/^[0-9]$/.test(ev.key)) { kpKey(ev.key); ev.preventDefault(); }
    else if (ev.key === '.' || ev.key === '-' || ev.key === ':') { kpKey(ev.key); ev.preventDefault(); }
    else if (ev.key === 'Backspace') { kpKey('B'); ev.preventDefault(); }
    else if (ev.key === 'Enter' || ev.key === 'Tab') { if (S.kp.kind === 'slot') kpNext(); else acts.kpOk(); ev.preventDefault(); }
    else if (ev.key === 'Escape') { acts.kpClose({ dataset: {}, classList: { contains: function () { return false; } } }); }
  });

  /* =========================================================
     SYNC — Firebase (optional). Local storage stays the source of truth.
     ========================================================= */
  var Sync = (function () {
    var F = null, uid = null, unsub = null, queue = {}, loading = null;
    function set(state, msg) { S.sync.state = state; S.sync.msg = msg || ''; if (S.ui.view === 'home' && !S.sheet && !S.kp) render(); }
    function lib() {
      if (window.LBFire) return Promise.resolve(window.LBFire);
      if (loading) return loading;
      loading = new Promise(function (res, rej) {
        var s = document.createElement('script'); s.src = 'firebase.bundle.js';
        s.onload = function () { res(window.LBFire); }; s.onerror = function () { loading = null; rej(new Error('Could not load sync (offline?)')); };
        document.head.appendChild(s);
      });
      return loading;
    }
    function parseCfg(t) {
      var o = {};
      ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].forEach(function (k) {
        var m = String(t).match(new RegExp('["\']?' + k + '["\']?\\s*:\\s*["\']([^"\']+)["\']'));
        if (m) o[k] = m[1];
      });
      return o.apiKey && o.projectId && o.appId ? o : null;
    }
    function start() {
      if (!S.dev.fire) return;
      set('wait');
      lib().then(function (L) {
        F = L; F.init(S.dev.fire);
        F.onAuth(function (u) {
          if (!u) { uid = null; S.sync.user = null; set('off'); return; }
          uid = u.uid; S.sync.user = u.email; set('wait');
          if (unsub) unsub();
          unsub = F.watch(uid, S.dev.lastSync || 0, onRemote, function (e) { set('err', e.message); });
          F.watchSettings(uid, function (st) { if (st && (st.u || 0) > (S.set.u || 0)) { Object.assign(S.set, st); DB.set('settings', S.set); render(); } });
          var pend = Object.keys(queue); if (pend.length) { var list = pend.map(function (k) { return queue[k]; }); queue = {}; push(list); }
        });
      }).catch(function (e) { set('err', e.message); });
    }
    function onRemote(list, maxU, fromCache) {
      var changed = false;
      list.forEach(function (r) {
        var mine = getRace(r.id);
        if (r.deleted) { if (mine && (mine.u || 0) <= r.u) { removeLocal(r.id); DB.del(r.id); changed = true; } return; }
        if (!mine || (r.u || 0) > (mine.u || 0)) { upsertLocal(r); DB.put(r); if (r.track) noteTrack(r.country, r.track); changed = true; }
      });
      if (maxU > (S.dev.lastSync || 0)) { S.dev.lastSync = maxU; saveDev(); }
      set(fromCache ? 'wait' : 'ok');
      if (changed && !S.kp && !S.sheet) render();
    }
    function push(list) {
      if (!S.dev.fire) return;
      if (!F || !uid) { list.forEach(function (r) { queue[r.id] = r; }); return; }
      set('wait');
      F.putMany(uid, list.map(function (r) { return JSON.parse(JSON.stringify(r)); })).then(function () { set('ok'); }).catch(function (e) { list.forEach(function (r) { queue[r.id] = r; }); set('err', e.message); });
    }
    function remove(r) { push([{ id: r.id, day: r.day, deleted: true, u: Date.now() }]); }
    function pushSettings() { if (F && uid) F.putSettings(uid, JSON.parse(JSON.stringify(S.set))).catch(function () { }); }
    function login(create) {
      var cfgText = val('fireCfg'), email = val('syncEmail').trim(), pass = val('syncPass');
      var c = cfgText ? parseCfg(cfgText) : S.dev.fire;
      var err = document.getElementById('syncErr');
      if (!c) { err.textContent = 'Paste the firebaseConfig block from the Firebase console (it has apiKey, projectId and appId).'; return; }
      if (!email || pass.length < 6) { err.textContent = 'Enter your email and a password of 6+ characters.'; return; }
      S.dev.fire = c; saveDev();
      err.textContent = 'Connecting…';
      lib().then(function (L) {
        F = L; F.init(c);
        return create ? F.signUp(email, pass) : F.signIn(email, pass);
      }).then(function () {
        start();
        if (create) loadAll().then(function () { push(S.races.slice()); pushSettings(); });
        S.sheet = null; render(); toast(create ? 'Account created — this phone is syncing' : 'Signed in — pulling your races');
      }).catch(function (e) {
        var m = String(e && e.code || e.message || e);
        err.textContent = /invalid-credential|wrong-password|user-not-found/.test(m) ? 'Email or password not right.' : /email-already/.test(m) ? 'Account exists — use Sign in.' : /network/.test(m) ? 'No internet connection.' : m;
      });
    }
    function logout() { if (F) F.signOut(); if (unsub) unsub(); unsub = null; S.sync.user = null; set('off'); closeSheet(); }
    function pushAll() { loadAll().then(function () { push(S.races.slice()); pushSettings(); }); }
    window.addEventListener('online', function () { if (S.dev.fire) start(); });
    window.addEventListener('offline', function () { if (S.dev.fire) set('offline'); });
    return { start: start, push: push, remove: remove, pushSettings: pushSettings, login: login, logout: logout, pushAll: pushAll };
  })();

  /* =========================================================
     TICK — 1 s: clock + countdowns + alerts. Full redraw only when a stage changes.
     ========================================================= */
  function signature() {
    var now = Date.now(), c = cfg();
    return LB.dayRaces(S.races, S.ui.day).map(function (r) {
      var st = LB.stage(r, now, c);
      var m = st.inMin !== undefined ? Math.floor(st.inMin) : '';
      return st.k + (st.overdue ? 'o' : '') + m + (LB.followed(r) ? 'f' : '') + (LB.inFocus(r) ? 'i' : '');
    }).join(',') + '|' + LB.resultsNeeded(S.races, now, c).length;
  }
  function tick() {
    var now = Date.now();
    var cl = root.querySelectorAll('[data-clock]');
    for (var i = 0; i < cl.length; i++) cl[i].innerHTML = clockHtml();
    var cds = root.querySelectorAll('[data-cd]');
    for (var j = 0; j < cds.length; j++) { var r = getRace(cds[j].dataset.cd); if (r) cds[j].textContent = LB.fmtCountdown(LB.jumpAt(r) - now); }
    var jobs = root.querySelectorAll('[data-cdjob]');
    for (var k = 0; k < jobs.length; k++) { var r2 = getRace(jobs[k].dataset.cdjob); if (r2) { var st = LB.stage(r2, now, cfg()); jobs[k].textContent = LB.fmtCountdown((st.inMin || 0) * 60000); } }
    checkAlerts();
    if (!S.kp && !S.sheet && (S.ui.view === 'home' || S.ui.view === 'results' || (S.ui.view === 'race' && !wide()))) {
      var sig = signature();
      if (sig !== S.sig) render();
    }
  }
  var timer = null;
  function startTick() { if (timer) clearInterval(timer); timer = setInterval(tick, 1000); tick(); }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (S.armed) requestWake();
      // catch-up: races whose odds window passed while away
      var now = Date.now(), missed = LB.dayRaces(S.races, S.ui.day).filter(function (r) { return LB.followed(r) && !r.fired.o && LB.jumpAt(r) < now - 60000 && LB.jumpAt(r) > now - 30 * 60000 && !LB.resultOk(r); });
      if (missed.length) { missed.forEach(function (r) { r.fired.o = now; persist(r); }); toast('Missed while away: ' + missed.map(raceName).join(', ')); }
      tick(); render();
    }
  });
  // The on-screen keyboard changes the window height on phones. Never redraw for that;
  // only redraw when the layout switches between phone and laptop width.
  var lastWide = null;
  window.addEventListener('resize', function () {
    clearTimeout(window.__rz);
    window.__rz = setTimeout(function () { var w = wide(); if (lastWide !== null && w !== lastWide) render(); lastWide = w; }, 150);
  });

  /* =========================================================
     BOOT
     ========================================================= */
  loadDev();
  // Start fast: only the last 7 days in memory, plus any older race (up to 60 days) still waiting for a result
  var recent = daysAgo(7);
  Promise.all([DB.since(daysAgo(60)), DB.get('settings'), DB.get('tracks')]).then(function (res) {
    S.races = (res[0] || []).filter(function (r) { return !r.deleted && (r.day >= recent || (!LB.resultOk(r) && !r.skipped && !r.abandoned && LB.played(r))); });
    if (res[1]) Object.assign(S.set, res[1]);
    if (res[2]) S.tracks = res[2];
  }).catch(function () { toast('Storage unavailable — data will not be saved'); }).then(function () {
    render(); startTick(); Sync.start();
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () { });
  }
  window.__LB = { S: S, handleFile: handleFile, acts: acts, render: render, renderLayer: renderLayer, toast: toast, tick: tick, getRace: getRace, Sound: Sound, checkAlerts: checkAlerts };
})();
