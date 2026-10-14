/* LedgerBook core logic — pure functions, no DOM. Shared by the app and the tests. */
(function (root) {
  'use strict';

  var SLOTS = [
    { k: 'win', n: 'WIN', s: 'WIN' },
    { k: 'fk', n: 'FAV KILLER', s: 'FK' },
    { k: 'ew', n: 'EACH WAY', s: 'EW' },
    { k: 'hg', n: 'HIDDEN GEM', s: 'HG' },
    { k: 'os', n: 'OUTSIDER', s: 'OUT' }
  ];
  var ENGINES = [
    { k: 'claude', n: 'Claude', s: 'C' },
    { k: 'gemini', n: 'Gemini', s: 'G' },
    { k: 'gpt', n: 'ChatGPT', s: 'GPT' }
  ];
  var COUNTRIES = [
    { k: 'AU', n: 'Australia' }, { k: 'GB', n: 'UK' }, { k: 'IE', n: 'Ireland' },
    { k: 'FR', n: 'France' }, { k: 'SA', n: 'South Africa' }, { k: 'HK', n: 'Hong Kong' },
    { k: 'NZ', n: 'New Zealand' }, { k: 'US', n: 'USA' }, { k: 'OT', n: 'Other' }
  ];
  // Countries that pay top 3 at most (6 runners = top 2)
  var TOP3_COUNTRIES = { FR: 1, SA: 1, US: 1 };

  var TRACKS = {
    AU: ['Albury', 'Alice Springs', 'Ararat', 'Ascot', 'Bairnsdale', 'Balaklava', 'Ballarat', 'Ballina', 'Bathurst', 'Beaudesert', 'Belmont', 'Benalla', 'Bendigo', 'Bordertown', 'Broome', 'Bunbury', 'Cairns', 'Canberra', 'Carnarvon', 'Caulfield', 'Cessnock', 'Clare', 'Coffs Harbour', 'Colac', 'Corowa', 'Cranbourne', 'Dalby', 'Darwin', 'Doomben', 'Dubbo', 'Eagle Farm', 'Echuca', 'Esperance', 'Flemington', 'Gatton', 'Gawler', 'Geelong', 'Geraldton', 'Gold Coast', 'Gold Coast Poly', 'Gosford', 'Goulburn', 'Grafton', 'Gunnedah', 'Hamilton', 'Hawkesbury', 'Hobart', 'Ipswich', 'Kalgoorlie', 'Kembla Grange', 'Kilmore', 'Kyneton', 'Launceston', 'Lismore', 'Longreach', 'Mackay', 'Mildura', 'Moe', 'Moonee Valley', 'Moruya', 'Morphettville', 'Mount Gambier', 'Mudgee', 'Murray Bridge', 'Muswellbrook', 'Naracoorte', 'Narrogin', 'Newcastle', 'Northam', 'Nowra', 'Oakbank', 'Orange', 'Pakenham', 'Penola', 'Penrith', 'Pinjarra', 'Port Augusta', 'Port Lincoln', 'Port Macquarie', 'Queanbeyan', 'Randwick', 'Rockhampton', 'Rosehill', 'Sale', 'Sandown', 'Sandown-Hillside', 'Sandown-Lakeside', 'Scone', 'Seymour', 'Shepparton', 'Stony Creek', 'Strathalbyn', 'Sunshine Coast', 'Sunshine Coast Poly', 'Swan Hill', 'Tamworth', 'Taree', 'Toowoomba', 'Townsville', 'Tuncurry', 'Wagga', 'Wangaratta', 'Warracknabeal', 'Warrnambool', 'Warwick Farm', 'Werribee', 'Wodonga', 'Wyong', 'Yarra Valley', 'York'],
    GB: ['Ascot', 'Ayr', 'Bath', 'Beverley', 'Brighton', 'Carlisle', 'Catterick', 'Chelmsford City', 'Chepstow', 'Chester', 'Doncaster', 'Epsom', 'Ffos Las', 'Goodwood', 'Hamilton', 'Haydock', 'Kempton', 'Leicester', 'Lingfield', 'Musselburgh', 'Newbury', 'Newcastle', 'Newmarket', 'Nottingham', 'Pontefract', 'Redcar', 'Ripon', 'Salisbury', 'Sandown Park', 'Southwell', 'Thirsk', 'Windsor', 'Wolverhampton', 'Yarmouth', 'York'],
    IE: ['Ballinrobe', 'Bellewstown', 'Clonmel', 'Cork', 'Curragh', 'Down Royal', 'Downpatrick', 'Dundalk', 'Fairyhouse', 'Galway', 'Gowran Park', 'Killarney', 'Laytown', 'Leopardstown', 'Limerick', 'Listowel', 'Naas', 'Navan', 'Punchestown', 'Roscommon', 'Sligo', 'Tipperary', 'Tralee', 'Tramore', 'Wexford'],
    FR: ['Angers', 'Bordeaux Le Bouscat', 'Caen', 'Chantilly', 'Chateaubriant', 'Clairefontaine', 'Compiegne', 'Craon', 'Deauville', 'Dieppe', 'Dijon', 'Fontainebleau', 'La Teste', 'Laval', 'Le Croise-Laroche', 'Le Lion-d\'Angers', 'Le Mans', 'Longchamp', 'Lyon Parilly', 'Maisons-Laffitte', 'Marseille Borely', 'Marseille Pont-de-Vivaux', 'Moulins', 'Nantes', 'Nimes', 'Pau', 'Pornichet', 'Saint-Cloud', 'Salon-de-Provence', 'Strasbourg', 'Toulouse', 'Tours', 'Vichy', 'Vittel'],
    SA: ['Durbanville', 'Fairview', 'Flamingo Park', 'Greyville', 'Kenilworth', 'Scottsville', 'Turffontein', 'Vaal'],
    HK: ['Happy Valley', 'Sha Tin'],
    NZ: ['Awapuni', 'Ellerslie', 'Hastings', 'Otaki', 'Pukekohe', 'Riccarton', 'Rotorua', 'Ruakaka', 'Te Aroha', 'Te Rapa', 'Trentham', 'Wanganui', 'Waverley', 'Wingatui'],
    US: [], OT: []
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function num(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
  function round2(x) { return Math.round(x * 100) / 100; }

  /* ---------- days and times (phone clock = IST) ---------- */
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // Race day: before 05:00 still counts as the previous race day (UK evening races run past midnight IST)
  function defaultDay(now) {
    var d = new Date(now);
    if (d.getHours() < 5) d.setDate(d.getDate() - 1);
    return dayKey(d);
  }
  // Build an absolute time for a race on a race day. Times before 05:00 fall on the next calendar date.
  function makeAt(day, hhmm) {
    var p = String(hhmm || '').replace(/[^0-9:]/g, '').split(':');
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (!isFinite(h) || !isFinite(m) || h > 23 || m > 59) return null;
    var dp = day.split('-');
    var d = new Date(+dp[0], +dp[1] - 1, +dp[2], h, m, 0, 0);
    if (h < 5) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  function hhmm(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function jumpAt(r) { return r.at + (r.delay || 0) * 60000; }
  function fmtCountdown(ms) {
    var neg = ms < 0, s = Math.floor(Math.abs(ms) / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var t = h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : pad(m) + ':' + pad(sec);
    return (neg ? '−' : '') + t;
  }

  /* ---------- payout tier ---------- */
  function autoTier(country, runners) {
    var n = parseInt(runners, 10);
    if (TOP3_COUNTRIES[country]) {
      if (!n) return 3;
      if (n <= 5) return 1;
      if (n === 6) return 2;
      return 3;
    }
    if (!n) return 4;
    if (n <= 3) return 1;
    if (n <= 5) return 2;
    if (n <= 7) return 3;
    return 4;
  }
  function tier(r) {
    var o = parseInt(r.pay, 10);
    if (o >= 1 && o <= 4) return o;
    return autoTier(r.country, r.runners);
  }
  function slotCount(r) { return Math.min(5, tier(r) + 1); }
  function slotActive(r, idx) { return idx < slotCount(r); }

  /* ---------- race model ---------- */
  function emptyPicks() {
    var p = {};
    ENGINES.forEach(function (e) {
      p[e.k] = {};
      SLOTS.forEach(function (s) { p[e.k][s.k] = { h: '', nm: '', wo: '', po: '' }; });
    });
    return p;
  }
  function newRace(o) {
    return {
      id: o.id || uid(), day: o.day, at: o.at, country: o.country || 'AU', track: o.track || '',
      rno: parseInt(String(o.rno).replace(/\D/g, ''), 10) || 0, runners: o.runners ? parseInt(o.runners, 10) : '',
      pay: o.pay || 0, delay: 0, skipped: false, muted: false,
      picks: o.picks || emptyPicks(), bets: [], result: null, swaps: [],
      fired: { c: 0, o: 0 }, ack: 0, u: Date.now()
    };
  }
  function raceKey(r) { return r.day + '|' + r.country + '|' + String(r.track).toLowerCase() + '|' + r.rno; }
  function trackKey(r) { return r.country + '|' + r.track; }
  function hasPicks(r, eng) {
    var list = eng ? [eng] : ENGINES.map(function (e) { return e.k; });
    return list.some(function (ek) {
      return SLOTS.some(function (s, i) { return slotActive(r, i) && r.picks[ek] && r.picks[ek][s.k] && r.picks[ek][s.k].h; });
    });
  }
  function enginesWithPicks(r) {
    return ENGINES.filter(function (e) { return hasPicks(r, e.k); }).map(function (e) { return e.k; });
  }
  function resultOk(r) { return !!(r.result && r.result.ok && r.result.order && r.result.order.length); }

  /* ---------- agreement ---------- */
  // Horses picked by 2+ engines in any active slot (a horse counts once per engine)
  function agreement(r) {
    var map = {};
    ENGINES.forEach(function (e) {
      var seen = {};
      SLOTS.forEach(function (s, i) {
        if (!slotActive(r, i)) return;
        var d = r.picks[e.k] && r.picks[e.k][s.k];
        var h = d && String(d.h || '').trim();
        if (!h || seen[h]) return;
        seen[h] = 1;
        if (!map[h]) map[h] = { h: h, engines: [], nm: '' };
        map[h].engines.push(e.k);
        if (!map[h].nm && d.nm) map[h].nm = d.nm;
      });
    });
    return Object.keys(map).map(function (k) { map[k].n = map[k].engines.length; return map[k]; })
      .sort(function (a, b) { return b.n - a.n || (+a.h) - (+b.h); });
  }
  function agreeLevel(r, h) {
    if (!h) return 0;
    var a = agreement(r).filter(function (x) { return x.h === String(h).trim(); })[0];
    return a ? a.n : 0;
  }

  /* ---------- results and outcomes ---------- */
  function parseResult(text) {
    return String(text || '').split(/[^0-9]+/).filter(function (x) { return x !== ''; })
      .map(function (x) { return String(parseInt(x, 10)); });
  }
  function position(r, h) {
    if (!resultOk(r) || !h) return 0;
    var i = r.result.order.indexOf(String(parseInt(h, 10)));
    return i < 0 ? 0 : i + 1;
  }
  // 'W' won, 'P' placed in paid places, 'L' lost, 'X' slot not used, null not settled
  function outcome(r, ek, idx) {
    if (!slotActive(r, idx)) return 'X';
    var d = r.picks[ek] && r.picks[ek][SLOTS[idx].k];
    if (!d || !d.h || !resultOk(r)) return null;
    var pos = position(r, d.h);
    if (pos === 1) return 'W';
    if (pos > 0 && pos <= tier(r)) return 'P';
    return 'L';
  }

  /* ---------- bets ---------- */
  // Returns profit (positive) or loss (negative); null if not settled yet or odds missing
  function betPnl(b, r) {
    var st = num(b.stake);
    if (!st || !resultOk(r)) return null;
    if (b.ret !== null && b.ret !== undefined && b.ret !== '') return round2(num(b.ret) - st);
    var paid = tier(r);
    if (b.type === 'ANY') {
      var co = num(b.co);
      var anyWon = (b.legs || []).some(function (l) { return position(r, l.h) === 1; });
      if (!anyWon) return -st;
      return co > 1 ? round2(st * (co - 1)) : null;
    }
    var pos = position(r, b.h), wo = num(b.wo), po = num(b.po);
    var won = pos === 1, placed = pos > 0 && pos <= paid;
    if (b.type === 'WIN') { if (!won) return -st; return wo > 1 ? round2(st * (wo - 1)) : null; }
    if (b.type === 'PLACE') { if (!placed) return -st; return po > 1 ? round2(st * (po - 1)) : null; }
    if (b.type === 'EW') {
      var h = st / 2, w, p;
      if (won) { if (!(wo > 1)) return null; w = h * (wo - 1); } else w = -h;
      if (placed) { if (!(po > 1)) return null; p = h * (po - 1); } else p = -h;
      return round2(w + p);
    }
    return null;
  }
  function raceStaked(r) { return (r.bets || []).reduce(function (a, b) { return a + num(b.stake); }, 0); }
  function racePnl(r) {
    var t = 0, any = false;
    (r.bets || []).forEach(function (b) { var p = betPnl(b, r); if (p !== null) { t += p; any = true; } });
    return any ? round2(t) : null;
  }
  // Bankroll is always derived, never mutated: base + adjustments + settled profit − stakes still running
  function bankroll(races, settings) {
    var base = num(settings.bank) + (settings.adj || []).reduce(function (a, x) { return a + num(x.amt); }, 0);
    var settled = 0, inPlay = 0, needOdds = 0;
    races.forEach(function (r) {
      (r.bets || []).forEach(function (b) {
        var p = betPnl(b, r);
        if (p === null) { inPlay += num(b.stake); if (resultOk(r)) needOdds++; } else settled += p;
      });
    });
    return { balance: round2(base + settled - inPlay), inPlay: round2(inPlay), settled: round2(settled), needOdds: needOdds };
  }

  /* ---------- race-day stages ---------- */
  // Stage of a race right now: what job is next and how urgent
  function stage(r, now, cfg) {
    cfg = cfg || {};
    var cardMin = cfg.card || 15, oddsMin = cfg.odds || 3;
    var rem = (jumpAt(r) - now) / 60000;
    if (resultOk(r)) return { k: 'done', rem: rem };
    if (r.skipped) return { k: 'skip', rem: rem };
    if (rem < -1) return { k: 'result', rem: rem };
    if (rem <= oddsMin) return { k: 'odds_now', rem: rem, urgent: true };
    var picks = hasPicks(r);
    if (!picks && rem <= cardMin) return { k: 'card_now', rem: rem, urgent: true, overdue: rem < cardMin - 1 };
    if (!picks) return { k: 'card_in', rem: rem, inMin: rem - cardMin };
    return { k: 'odds_in', rem: rem, inMin: rem - oddsMin };
  }
  function dayRaces(races, day) {
    return races.filter(function (r) { return r.day === day; }).sort(function (a, b) { return jumpAt(a) - jumpAt(b) || a.rno - b.rno; });
  }
  function upcoming(races, day, now, cfg) {
    return dayRaces(races, day).filter(function (r) {
      var s = stage(r, now, cfg).k;
      return s !== 'done' && s !== 'skip' && s !== 'result';
    });
  }
  // The single most urgent job: an urgent race whose jump is soonest
  function doNow(races, day, now, cfg) {
    var urgent = upcoming(races, day, now, cfg).filter(function (r) { return stage(r, now, cfg).urgent; });
    return urgent[0] || null;
  }
  function resultsNeeded(races, now, cfg) {
    return races.filter(function (r) { return stage(r, now, cfg).k === 'result'; })
      .sort(function (a, b) { return jumpAt(a) - jumpAt(b); });
  }
  function finished(races, day) {
    return races.filter(function (r) { return r.day === day && resultOk(r); })
      .sort(function (a, b) { return jumpAt(b) - jumpAt(a); });
  }
  // Two scheduled jobs (card or odds) within 60 s of each other in the next hour
  function clashes(races, day, now, cfg) {
    cfg = cfg || {};
    var cardMin = cfg.card || 15, oddsMin = cfg.odds || 3, jobs = [];
    upcoming(races, day, now, cfg).forEach(function (r) {
      var j = jumpAt(r);
      if (!hasPicks(r)) jobs.push({ r: r, k: 'card', t: j - cardMin * 60000 });
      jobs.push({ r: r, k: 'odds', t: j - oddsMin * 60000 });
    });
    jobs = jobs.filter(function (x) { return x.t > now && x.t - now < 3600000; }).sort(function (a, b) { return a.t - b.t; });
    var out = [];
    for (var i = 1; i < jobs.length; i++) {
      if (jobs[i].t - jobs[i - 1].t <= 60000 && jobs[i].r.id !== jobs[i - 1].r.id) out.push([jobs[i - 1], jobs[i]]);
    }
    return out;
  }
  // Alerts that should fire now. Marks nothing — caller records fired flags.
  function dueAlerts(races, day, now, cfg) {
    cfg = cfg || {};
    var cardMin = cfg.card || 15, oddsMin = cfg.odds || 3, out = [];
    dayRaces(races, day).forEach(function (r) {
      if (r.skipped || r.muted || resultOk(r)) return;
      var rem = (jumpAt(r) - now) / 60000, f = r.fired || {};
      if (!f.o && rem <= oddsMin && rem > -1) out.push({ r: r, k: 'odds' });
      else if (!f.c && !f.o && rem <= cardMin && rem > oddsMin && !hasPicks(r)) out.push({ r: r, k: 'card' });
    });
    return out;
  }

  /* ---------- paste-to-fill ---------- */
  var SLOT_RX = [
    ['fk', /FAV(?:OU?RITE)?\s*-?\s*KILL(?:ER)?|\bF\.?K\.?\b/i],
    ['ew', /EACH[\s-]*WAY|\bE\s*\/\s*W\b|\bEW\b/i],
    ['hg', /HIDDEN\s*GEM|\bH\.?G\.?\b/i],
    ['os', /OUTSIDER|LONG\s*SHOT|\bOUT\b/i],
    ['win', /\bWIN(?:NER)?\b/i]
  ];
  function findSlot(text) {
    for (var i = 0; i < SLOT_RX.length; i++) if (SLOT_RX[i][1].test(text)) return SLOT_RX[i][0];
    return null;
  }
  function horseFrom(text) {
    var t = String(text || '').replace(/\*\*/g, '').trim(), m;
    var res = { h: '', nm: '' };
    if ((m = t.match(/^(.*?)\(\s*(?:No\.?\s*)?#?\s*(\d{1,2})\s*\)/i))) { res.h = m[2]; res.nm = m[1]; }
    else if ((m = t.match(/(?:#|No\.?\s*)(\d{1,2})\b/i))) { res.h = m[1]; res.nm = t.replace(m[0], ''); }
    else if ((m = t.match(/^(\d{1,2})[\s.:)\-–]+([A-Za-z].*)$/))) { res.h = m[1]; res.nm = m[2]; }
    else if ((m = t.match(/^(\d{1,2})$/))) { res.h = m[1]; }
    res.nm = String(res.nm || '').replace(/[|:–\-]+$/, '').replace(/\s+/g, ' ').trim();
    if (res.nm.length > 40) res.nm = res.nm.slice(0, 40);
    if (res.h) res.h = String(parseInt(res.h, 10));
    return res;
  }
  function oddsFrom(text) {
    var t = String(text || ''), m;
    if ((m = t.match(/(\d{1,3}(?:\.\d{1,2})?)\s*\/\s*(\d{1,3}(?:\.\d{1,2})?)/))) return { wo: m[1], po: m[2] };
    if ((m = t.match(/\b(\d{1,3}\.\d{1,2})\b/))) return { wo: m[1], po: '' };
    return { wo: '', po: '' };
  }
  // Reads an AI's prediction table (markdown or plain lines). Returns { slotKey: {h, nm, wo, po} }
  function parsePicks(text) {
    var out = {};
    String(text || '').split(/\r?\n/).forEach(function (line) {
      if (!/\d/.test(line)) return;
      if (/^\s*\|?\s*:?-{3,}/.test(line)) return;
      var res = null;
      if (line.indexOf('|') > -1) {
        var cells = line.split('|').map(function (c) { return c.trim(); }).filter(function (c) { return c !== ''; });
        for (var i = 0; i < cells.length - 1; i++) {
          var sk = findSlot(cells[i]);
          if (!sk || cells[i].length > 20) continue;
          var hr = horseFrom(cells[i + 1]);
          if (!hr.h) continue;
          var od = { wo: '', po: '' };
          for (var j = i + 2; j < Math.min(cells.length, i + 4); j++) {
            od = oddsFrom(cells[j]);
            if (od.wo) break;
          }
          res = { sk: sk, h: hr.h, nm: hr.nm, wo: od.wo, po: od.po };
          break;
        }
      } else {
        var sk2 = findSlot(line);
        if (sk2) {
          var rx = SLOT_RX.filter(function (x) { return x[0] === sk2; })[0][1];
          var rest = line.replace(rx, '').replace(/^[\s:*\-–—.)]+/, '');
          var hr2 = horseFrom(rest);
          if (hr2.h) {
            var afterHorse = rest.replace(/^.*?\(\s*#?\d{1,2}\s*\)/, '');
            var od2 = oddsFrom(afterHorse);
            res = { sk: sk2, h: hr2.h, nm: hr2.nm.replace(/\s*[@:]\s*[\d./\s]+$/, '').replace(/\s\d+(\.\d+)?\s*\/.*$/, '').trim(), wo: od2.wo, po: od2.po };
          }
        }
      }
      if (res && !out[res.sk]) out[res.sk] = { h: res.h, nm: res.nm, wo: res.wo, po: res.po };
    });
    return out;
  }

  /* ---------- stats (Lab) ---------- */
  function emptyTally() { return { n: 0, w: 0, p: 0 }; }
  function addT(t, o) { t.n++; if (o === 'W') { t.w++; t.p++; } else if (o === 'P') t.p++; }
  function stats(races, f) {
    f = f || {};
    var S = { races: 0, eng: {}, slot: {}, country: {}, track: {}, agree: { 3: emptyTally(), 2: emptyTally(), 1: emptyTally() }, roi: {} };
    ENGINES.forEach(function (e) {
      S.eng[e.k] = emptyTally(); S.slot[e.k] = {};
      SLOTS.forEach(function (s) { S.slot[e.k][s.k] = emptyTally(); });
      S.roi[e.k] = { stake: 0, pnl: 0 };
    });
    S.roi.multi = { stake: 0, pnl: 0 };
    races.forEach(function (r) {
      if (!resultOk(r) || r.skipped) return;
      if (f.country && r.country !== f.country) return;
      if (f.from && r.day < f.from) return;
      if (f.to && r.day > f.to) return;
      if (f.track && trackKey(r) !== f.track) return;
      S.races++;
      var tk = trackKey(r);
      if (!S.track[tk]) { S.track[tk] = { country: r.country, track: r.track, races: 0 }; ENGINES.forEach(function (e) { S.track[tk][e.k] = emptyTally(); }); }
      S.track[tk].races++;
      if (!S.country[r.country]) { S.country[r.country] = {}; ENGINES.forEach(function (e) { S.country[r.country][e.k] = emptyTally(); }); }
      ENGINES.forEach(function (e) {
        SLOTS.forEach(function (s, i) {
          var o = outcome(r, e.k, i);
          if (!o || o === 'X') return;
          addT(S.eng[e.k], o); addT(S.slot[e.k][s.k], o); addT(S.track[tk][e.k], o); addT(S.country[r.country][e.k], o);
        });
      });
      agreement(r).forEach(function (a) {
        var pos = position(r, a.h);
        var o = pos === 1 ? 'W' : (pos > 0 && pos <= tier(r) ? 'P' : 'L');
        addT(S.agree[Math.min(3, a.n)], o);
      });
      (r.bets || []).forEach(function (b) {
        var p = betPnl(b, r); if (p === null) return;
        var key = b.type === 'ANY' ? 'multi' : b.eng;
        if (!S.roi[key]) return;
        S.roi[key].stake += num(b.stake); S.roi[key].pnl += p;
      });
    });
    return S;
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

  /* ---------- day import (from Claude) and old LedgerBook import ---------- */
  function normCountry(c) {
    c = String(c || '').toUpperCase().trim();
    var map = { UK: 'GB', GBR: 'GB', ENG: 'GB', ENGLAND: 'GB', SCO: 'GB', WAL: 'GB', IRE: 'IE', IRL: 'IE', AUS: 'AU', FRA: 'FR', RSA: 'SA', ZA: 'SA', SAF: 'SA', OTHER: 'OT', NZL: 'NZ', USA: 'US' };
    if (map[c]) return map[c];
    return COUNTRIES.some(function (x) { return x.k === c; }) ? c : 'OT';
  }
  // Day file: { day:"2026-10-17", races:[{country,track,rno,time,runners}] }
  function importDay(existing, data, fallbackDay) {
    var day = data.day || fallbackDay, have = {}, added = [], skipped = 0, bad = 0;
    existing.forEach(function (r) { have[raceKey(r)] = 1; });
    (data.races || []).forEach(function (x) {
      var at = makeAt(x.day || day, x.time);
      var rno = parseInt(String(x.rno).replace(/\D/g, ''), 10);
      if (!at || !rno || !x.track) { bad++; return; }
      var r = newRace({ day: x.day || day, at: at, country: normCountry(x.country), track: String(x.track).trim(), rno: rno, runners: x.runners, pay: x.pay });
      if (have[raceKey(r)]) { skipped++; return; }
      have[raceKey(r)] = 1; added.push(r);
    });
    return { added: added, skipped: skipped, bad: bad };
  }
  // Old LedgerBook (v1) backup → new races. Track history keeps working.
  function importLegacy(existing, data) {
    var have = {}, added = [], skipped = 0;
    existing.forEach(function (r) { have[raceKey(r)] = 1; });
    (data.races || data || []).forEach(function (o) {
      if (!o || !o.date || !o.track) return;
      var at = makeAt(o.date, o.time);
      if (!at) return;
      var r = newRace({ day: o.date, at: at, country: normCountry(o.country), track: o.track, rno: o.rno, runners: o.runners, pay: o.payOverride });
      if (have[raceKey(r)]) { skipped++; return; }
      ['claude', 'gemini'].forEach(function (ek) {
        SLOTS.forEach(function (s) {
          var d = o[ek] && o[ek][s.k];
          if (d && d.horse) r.picks[ek][s.k] = { h: String(parseInt(d.horse, 10) || d.horse), nm: '', wo: d.wo || '', po: d.po || '' };
        });
      });
      if (o.official && o.official.confirmed && o.official.first) {
        r.result = { ok: true, t: Date.now(), order: ['first', 'second', 'third', 'fourth'].map(function (k) { return o.official[k]; }).filter(Boolean).map(function (h) { return String(parseInt(h, 10)); }) };
      }
      (o.bets || []).forEach(function (b) {
        if (!num(b.stake)) return;
        if ((b.bt === 'SRM' || b.bt === 'MULTI') && b.legs) {
          r.bets.push({ id: uid(), type: 'ANY', stake: num(b.stake), co: b.combinedOdds || '', legs: b.legs.map(function (l) { return { eng: l.eng, slot: l.sk, h: String(l.horse) }; }), ret: null, t: Date.now() });
        } else if (b.bt === 'DUTCH' && b.legs) {
          b.legs.forEach(function (l) { if (num(l.stake)) r.bets.push({ id: uid(), type: 'WIN', eng: 'claude', slot: l.sk, h: String(l.horse), stake: num(l.stake), wo: l.wo, po: l.po, ret: null, t: Date.now() }); });
        } else if (b.bt === 'WIN' || b.bt === 'PLACE' || b.bt === 'EW') {
          r.bets.push({ id: uid(), type: b.bt, eng: b.eng, slot: b.sk, h: String(b.horse), stake: num(b.stake), wo: b.wo, po: b.po, ret: null, t: Date.now() });
        }
      });
      have[raceKey(r)] = 1; added.push(r);
    });
    return { added: added, skipped: skipped };
  }

  /* ---------- tracks ---------- */
  function trackList(country, races) {
    var set = {};
    (TRACKS[country] || []).forEach(function (t) { set[t] = 1; });
    (races || []).forEach(function (r) { if (r.country === country && r.track) set[r.track] = 1; });
    return Object.keys(set).sort();
  }
  function trackMatches(list, q) {
    q = String(q || '').toLowerCase().trim();
    if (!q) return [];
    var starts = [], words = [];
    list.forEach(function (t) {
      var l = t.toLowerCase();
      if (l.indexOf(q) === 0) starts.push(t);
      else if (l.split(/[\s\-']+/).some(function (w) { return w.indexOf(q) === 0; })) words.push(t);
    });
    return starts.concat(words).slice(0, 8);
  }

  var api = {
    SLOTS: SLOTS, ENGINES: ENGINES, COUNTRIES: COUNTRIES, TRACKS: TRACKS,
    pad: pad, uid: uid, num: num, round2: round2,
    dayKey: dayKey, defaultDay: defaultDay, makeAt: makeAt, hhmm: hhmm, jumpAt: jumpAt, fmtCountdown: fmtCountdown,
    autoTier: autoTier, tier: tier, slotCount: slotCount, slotActive: slotActive,
    emptyPicks: emptyPicks, newRace: newRace, raceKey: raceKey, trackKey: trackKey, hasPicks: hasPicks, enginesWithPicks: enginesWithPicks, resultOk: resultOk,
    agreement: agreement, agreeLevel: agreeLevel,
    parseResult: parseResult, position: position, outcome: outcome,
    betPnl: betPnl, raceStaked: raceStaked, racePnl: racePnl, bankroll: bankroll,
    stage: stage, dayRaces: dayRaces, upcoming: upcoming, doNow: doNow, resultsNeeded: resultsNeeded, finished: finished, clashes: clashes, dueAlerts: dueAlerts,
    parsePicks: parsePicks, horseFrom: horseFrom, oddsFrom: oddsFrom,
    stats: stats, pct: pct,
    normCountry: normCountry, importDay: importDay, importLegacy: importLegacy,
    trackList: trackList, trackMatches: trackMatches
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LB = api;
})(this);
