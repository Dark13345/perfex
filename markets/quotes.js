/* Котировки в разделе «Рынки».
   1) Сразу показываем цены из data/quotes.json (его раз в 15 минут обновляет робот на GitHub).
   2) Для карточек с data-stream подключаемся к живому потоку Lightstreamer на online.npbfxrus.pro
      (сервер разрешает запросы с dark13345.github.io) и обновляем цены каждую секунду.
   3) Карточки без потока (индексы, газ) раз в 5 минут перечитывают data/quotes.json. */
(function () {
  var cards = [].slice.call(document.querySelectorAll('.instrument-card[data-sym]'));
  if (!cards.length) return;

  var LS = 'https://online.npbfxrus.pro/ls/lightstreamer/';
  var PREFIX = 'info1:';
  var JSON_URL = new URL('../data/quotes.json', document.currentScript.src).href;
  var last = {};

  function digits(s) { var i = String(s).indexOf('.'); return i < 0 ? 0 : String(s).length - i - 1; }

  var FX = /^(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|RUB|DKK|HKD|MXN|NOK|SEK|SGD|TRY|ZAR){2}$/;

  function spreadText(sym, bid, ask) {
    var d = Math.abs(parseFloat(ask) - parseFloat(bid));
    if (FX.test(sym)) {
      var pip = /JPY$/.test(sym) ? 0.01 : 0.0001;
      return (d / pip).toFixed(1) + ' п.';
    }
    var s = d.toFixed(digits(bid));
    return s.indexOf('.') < 0 ? s : s.replace(/0+$/, '').replace(/\.$/, '');
  }

  function render(sym, bid, ask) {
    if (bid == null || ask == null) return;
    var prev = last[sym];
    last[sym] = parseFloat(bid);
    cards.forEach(function (c) {
      if (c.getAttribute('data-sym') !== sym) return;
      var p = c.querySelector('[data-f="bid"]');
      p.textContent = bid;
      var a = c.querySelector('[data-f="ask"]'), s = c.querySelector('[data-f="spread"]');
      if (a) a.textContent = ask;
      if (s) s.textContent = spreadText(sym, bid, ask);
      if (prev != null && prev !== last[sym]) {
        p.classList.remove('up', 'down');
        void p.offsetWidth;
        p.classList.add(last[sym] > prev ? 'up' : 'down');
      }
    });
  }

  function loadJson() {
    return fetch(JSON_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        cards.forEach(function (c) {
          var sym = c.getAttribute('data-sym');
          var q = data.quotes[sym];
          if (!q) return;
          if (c.hasAttribute('data-stream') && last[sym] != null) return;
          render(sym, q.bid, q.ask);
        });
      })
      .catch(function () {});
  }

  loadJson();
  setInterval(function () { if (!document.hidden) loadJson(); }, 5 * 60 * 1000);

  /* ---------- живой поток ---------- */
  var streamSyms = [];
  cards.forEach(function (c) {
    var s = c.getAttribute('data-sym');
    if (c.hasAttribute('data-stream') && streamSyms.indexOf(s) < 0) streamSyms.push(s);
  });
  if (!streamSyms.length || !window.fetch) return;

  var phase = 1, session = null, running = false, fails = 0;
  var fields = streamSyms.map(function () { return [null, null]; });

  function post(path, params) {
    var body = new URLSearchParams();
    Object.keys(params).forEach(function (k) { body.append(k, params[k]); });
    return fetch(LS + path, { method: 'POST', body: body, credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
  }

  // разбор строк вида d(2,1,5,'1.12374',1) — номер инструмента и новые значения полей;
  // число вместо строки означает «столько полей не изменилось»
  function applyUpdates(text) {
    var re = /\bd\((\d+),(\d+),(\d+),((?:'[^']*'|[^)'])*)\)/g, m;
    while ((m = re.exec(text))) {
      var idx = parseInt(m[3], 10) - 1;
      if (idx < 0 || idx >= fields.length) continue;
      var toks = m[4].match(/'[^']*'|[^,]+/g) || [], f = 0;
      toks.forEach(function (t) {
        t = t.trim();
        if (t.charAt(0) === "'") { fields[idx][f] = t.slice(1, -1); f++; }
        else if (/^\d+$/.test(t)) { f += parseInt(t, 10); }
        else { fields[idx][f] = null; f++; }
      });
      var fv = fields[idx];
      if (fv[0] && fv[1]) {
        var lo = fv[0], hi = fv[1];
        if (parseFloat(lo) > parseFloat(hi)) { var x = lo; lo = hi; hi = x; }
        render(streamSyms[idx], lo, hi);
      }
    }
  }

  function openSession() {
    return post('create_session.js', {
      LS_phase: phase++, LS_polling: 'true', LS_polling_millis: '0', LS_idle_millis: '0',
      LS_client_version: '4.3', LS_adapter: 'NEFTEPROM'
    }).then(function (t) {
      var m = /start\('([^']+)'/.exec(t);
      if (!m) throw new Error('no session');
      session = m[1];
      fields = streamSyms.map(function () { return [null, null]; });
      return post('control.js', {
        LS_session: session, LS_window: '1', LS_win_phase: '1', LS_op: 'add', LS_req_phase: phase++,
        LS_mode1: 'MERGE', LS_id1: streamSyms.map(function (s) { return PREFIX + s; }).join(' '),
        LS_schema1: 'bid offer', LS_data_adapter1: 'STOCKS', LS_snapshot1: 'true',
        LS_requested_max_frequency1: '1', LS_unique: String(phase)
      });
    });
  }

  function poll() {
    if (!running) return;
    post('bind_session.js', {
      LS_session: session, LS_phase: phase++, LS_polling: 'true',
      LS_polling_millis: '0', LS_idle_millis: '20000'
    }).then(function (t) {
      if (!/start\('/.test(t)) throw new Error('session lost');
      fails = 0;
      applyUpdates(t);
      setTimeout(poll, 300);
    }).catch(restart);
  }

  function restart() {
    if (!running) return;
    fails++;
    if (fails > 6) { running = false; return; }   // поток недоступен — остаются цены робота
    setTimeout(start, Math.min(30000, 1500 * fails));
  }

  function start() {
    if (!running) return;
    openSession().then(poll).catch(restart);
  }

  function resume() { if (running) return; running = true; fails = 0; start(); }
  function pause() { running = false; }

  document.addEventListener('visibilitychange', function () { document.hidden ? pause() : resume(); });
  if (!document.hidden) resume();
})();
