/* Giro Postino – tutta la logica dell'app.
   Nessuna richiesta di rete: i dati del giro restano solo sul telefono. */
(function () {
'use strict';

const CHIAVE = 'giro_postino_v1';
const VERSIONE_APP = '1.0';
const NOMI = {consegnata: 'CONSEGNATA', terzi: 'A TERZI', avviso: 'AVVISO', sconosciuto: 'SCONOSCIUTO', da_segnare: 'DA SEGNARE'};
const FINALI = ['consegnata', 'terzi', 'avviso', 'sconosciuto'];
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

const $app = document.getElementById('app');
const $sopra = document.getElementById('sopra');
const $toast = document.getElementById('toast');
const $file = document.getElementById('file');

let S = {giro: null, anim: true};   // stato salvato
let tappe = [];                     // tutte le tappe, in fila
let perN = {};                      // n -> {b: busta, ti: indice della tappa}
let foglio = null;                  // foglio aperto (oggetto) oppure null
let gigante = null;                 // n della busta mostrata a tutto schermo
let occupato = false;               // vero durante l'animazione dell'esito
let ultimaVista = '';
let dopo = null;                    // cose da fare dopo il prossimo disegno
let timerToast = 0;
let erroreInizio = '';

/* ================= utilità ================= */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const due = x => String(x).padStart(2, '0');
const hhmm = d => due(d.getHours()) + ':' + due(d.getMinutes());
const iso = d => d.getFullYear() + '-' + due(d.getMonth() + 1) + '-' + due(d.getDate());
const daIso = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const ggmmaaaa = s => { const p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };

function giornoRitiro(isoAvviso, quanti) {
  const d = daIso(isoAvviso);
  let n = quanti;
  while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
  return d;
}
function nomeHtml(dest) {
  const i = dest.indexOf(' ');
  return i < 0 ? '<b>' + esc(dest) + '</b>' : '<b>' + esc(dest.slice(0, i)) + '</b>' + esc(dest.slice(i));
}
function animOn() {
  return S.anim !== false && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function vibra() { try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) {} }
function salva() { try { localStorage.setItem(CHIAVE, JSON.stringify(S)); } catch (e) { toast('⚠ Non riesco a salvare sul telefono'); } }

/* ================= dati del giro ================= */
function indicizza() {
  tappe = []; perN = {};
  if (!S.giro) return;
  S.giro.zone.forEach((z, zi) => z.tappe.forEach(t => {
    const ti = tappe.length;
    tappe.push(Object.assign({zi: zi, ti: ti}, t));
    t.buste.forEach(b => { perN[b.n] = {b: b, ti: ti}; });
  }));
}
function controlla(g) {
  if (!g || typeof g !== 'object') return 'Il file non è un giro.';
  if (g.formato !== 1) return 'Questo file non è un giro nel formato giusto (manca "formato": 1).';
  if (typeof g.data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(g.data)) return 'Nel file manca la data del giro.';
  if (!Array.isArray(g.zone) || !g.zone.length) return 'Nel file non ci sono tappe.';
  const visti = {}; let nb = 0;
  for (const z of g.zone) {
    if (!z || !Array.isArray(z.tappe)) return 'Nel file manca l\'elenco delle tappe.';
    for (const t of z.tappe) {
      if (!t || !Array.isArray(t.buste) || !t.buste.length) return 'C\'è una tappa senza buste.';
      for (const b of t.buste) {
        if (b == null || b.n == null || !b.destinatario) return 'C\'è una busta senza numero o senza destinatario.';
        if (visti[b.n]) return 'Il numero N ' + b.n + ' compare due volte.';
        visti[b.n] = 1; nb++;
      }
    }
  }
  if (!nb) return 'Nel file non ci sono buste.';
  return '';
}
function caricaTesto(testo) {
  let g;
  try { g = JSON.parse(String(testo).replace(/^﻿/, '')); }
  catch (e) { return rifiuta('Non riesco a leggere il file: non è un file del giro (.json).'); }
  const err = controlla(g);
  if (err) return rifiuta(err);
  const inCorso = S.giro && !S.esportato && Object.keys(S.esiti || {}).length > 0;
  if (inCorso) {
    apriFoglio({tipo: 'chiedi', titolo: 'Sostituire il giro in corso?',
      testo: 'C\'è già il giro del ' + ggmmaaaa(S.giro.data) + ' con esiti segnati e non ancora esportato. Se carichi il nuovo, quegli esiti si perdono.',
      si: 'Sì, carica il nuovo giro', no: 'No, tieni quello in corso', fai: () => inizia(g)});
  } else inizia(g);
}
function rifiuta(msg) {
  if (S.giro) apriFoglio({tipo: 'chiedi', titolo: 'File non valido', testo: msg, no: 'Ho capito'});
  else { erroreInizio = msg; disegna(); }
}
function inizia(g) {
  S = {giro: g, ordine: [], pos: 0, esiti: {}, rimandate: [], esportato: false, pila: [], anim: S.anim !== false};
  indicizza();
  S.ordine = tappe.map(t => t.ti);
  erroreInizio = ''; foglio = null; gigante = null;
  salva(); disegna();
  toast('Giro del ' + ggmmaaaa(g.data) + ' caricato: ' + Object.keys(perN).length + ' buste');
}

const rec = n => S.esiti[n] || {};
const esitoDi = n => rec(n).esito || '';
const fatta = n => FINALI.indexOf(esitoDi(n)) >= 0;
const tuttiN = () => Object.keys(perN).map(Number).sort((a, b) => a - b);
const daSegnare = () => tuttiN().filter(n => esitoDi(n) === 'da_segnare');
const tappaFinita = ti => tappe[ti].buste.every(b => fatta(b.n));
const tappaGestita = ti => tappe[ti].buste.every(b => esitoDi(b.n));
const tappaQui = () => tappe[S.ordine[S.pos]];

function trattoDi(ti) {
  const tr = S.giro.tratti; if (!Array.isArray(tr)) return -1;
  const num = tappe[ti].tappa;
  for (let i = 0; i < tr.length; i++) if (num >= tr[i].prima_tappa && num <= tr[i].ultima_tappa) return i;
  return -1;
}
function testoTratto(i) {
  const t = S.giro.tratti[i];
  return t.verso === 'indietro' ? 'N ' + t.a + '–' + t.da + ' all\'indietro' : 'N ' + t.da + '–' + t.a;
}
function indirizzoBusta(n) {
  const t = tappe[perN[n].ti], b = perN[n].b;
  return (t.via && b.civico) ? t.via + ', ' + b.civico : t.indirizzo;
}

/* ================= navigazione ================= */
const vista = () => (S.pila && S.pila.length) ? S.pila[S.pila.length - 1] : {s: 'tappa'};
function apri(v) { S.pila.push(v); salva(); disegna(); }
function indietro() {
  if (occupato) return true;
  if (gigante != null) { gigante = null; disegnaSopra(); return true; }
  if (foglio) { chiudiFoglio(); return true; }
  if (S.giro && S.pila.length) { S.pila.pop(); salva(); disegna(); return true; }
  return false;
}
// Tasto "indietro" di Android: torna alla schermata prima invece di chiudere l'app
history.replaceState({base: 1}, '');
history.pushState({gp: 1}, '');
window.addEventListener('popstate', () => {
  if (indietro()) history.pushState({gp: 1}, '');
  else history.back();
});

/* ================= disegno ================= */
function disegna() {
  document.body.classList.toggle('anim', animOn());
  let h, chiave;
  if (!S.giro) { h = pagInizio(); chiave = 'inizio'; }
  else {
    const v = vista();
    chiave = v.s + ':' + (v.n || '') + ':' + (v.s === 'tappa' ? S.pos : '');
    if (v.s === 'busta') h = pagBusta(v.n);
    else if (v.s === 'dasegnare') h = pagDaSegnare();
    else if (v.s === 'cerca') h = pagCerca();
    else if (v.s === 'tappe') h = pagTappe();
    else if (v.s === 'riepilogo') h = pagRiepilogo();
    else h = pagTappa();
  }
  const nuova = chiave !== ultimaVista;
  const y = window.scrollY;
  $app.innerHTML = h;
  if (nuova) window.scrollTo(0, 0);
  else window.scrollTo(0, y);
  ultimaVista = chiave;
  disegnaSopra();
  if (vista().s === 'cerca' && S.giro) { const c = document.getElementById('q'); if (c) { c.focus(); risultati(); } }
  if (vista().s === 'tappe' && nuova) { const q = document.querySelector('.tappa-r.qui'); if (q) q.scrollIntoView({block: 'center'}); }
  if (dopo) { const f = dopo; dopo = null; f(); }
}

function barraSu() {
  const k = daSegnare().length;
  return '<div class="barra">' +
    '<button class="neutro conta cresce' + (k ? ' ha' : '') + '" data-a="dasegnare">⏳ Da segnare <b id="conta">' + k + '</b></button>' +
    '<button class="neutro" data-a="cerca">🔍 Cerca</button>' +
    '<button class="neutro" data-a="menu" aria-label="Menu">☰</button></div>';
}
function barraIndietro(titolo) {
  return '<div class="barra"><button class="neutro" data-a="indietro">‹ Indietro</button><div class="titolo-pag">' + esc(titolo) + '</div></div>';
}
function rigaBusta(n, conIndirizzo) {
  const b = perN[n].b, e = esitoDi(n), r = rec(n);
  let sotto = 'cod. …' + esc(String(b.codice || '').slice(-5));
  if (e === 'terzi' && r.ritirato_da) sotto += ' · ritira ' + esc(r.ritirato_da);
  if (r.nota) sotto += ' · 📝';
  return '<button class="busta' + (e ? ' e-' + e : '') + '" data-a="busta" data-n="' + n + '">' +
    '<span class="n">' + n + '</span>' +
    '<span class="chi"><span class="nome">' + nomeHtml(b.destinatario) + '</span>' +
    (conIndirizzo ? '<div class="dove">' + esc(indirizzoBusta(n)) + '</div>' : '') +
    '<div class="sotto">' + sotto + '</div></span>' +
    (e ? '<span class="timbro">' + (e === 'da_segnare' ? '⏳ da segnare' : NOMI[e]) + '</span>' : '') +
    '</button>';
}

function pagInizio() {
  return '<div class="inizio"><img src="icon-192.png" alt=""><h1>Giro Postino</h1>' +
    (erroreInizio ? '<p class="errore">' + esc(erroreInizio) + '</p>' : '') +
    '<button class="pieno" data-a="carica">Carica giro</button>' +
    '<p>Apri il file del giro da WhatsApp e tocca<br><b>Condividi → Giro Postino</b>.</p>' +
    '<p>Oppure tocca “Carica giro” e scegli il file <b>giro_….json</b>.</p></div>';
}

function pagTappa() {
  const t = tappaQui(), tot = tuttiN().length, fatte = tuttiN().filter(fatta).length;
  const zona = S.giro.zone[t.zi] || {};
  const tr = trattoDi(t.ti), nTr = (S.giro.tratti || []).length;
  const rim = S.rimandate.indexOf(t.ti) >= 0;
  const ultima = S.pos === S.ordine.length - 1;
  let h = barraSu();
  h += '<section class="testa"><div class="nav">' +
    '<button class="freccia" data-a="prec" aria-label="Tappa precedente"' + (S.pos === 0 ? ' disabled' : '') + '>‹</button>' +
    '<button class="quale" data-a="tappe">Tappa ' + (S.pos + 1) + ' di ' + S.ordine.length + '<small>tocca per vederle tutte</small></button>' +
    '<button class="freccia" data-a="succ" aria-label="Tappa successiva">›</button></div>' +
    '<div class="avanz"><i id="barra" style="transform:scaleX(' + (tot ? fatte / tot : 0) + ')"></i></div>' +
    '<div class="info"><span><b>' + fatte + '</b> di ' + tot + ' buste fatte</span>' +
    (tr >= 0 ? '<span>Tratto ' + (tr + 1) + (nTr > 1 ? ' di ' + nTr : '') + ' · ' + esc(testoTratto(tr)) + '</span>' : '') +
    (zona.parcheggio ? '<span>🛵 ' + esc(zona.parcheggio.vicino_a) + '</span>' : '') +
    '</div></section>';

  if (rim) h += '<div><span class="etichetta">↪ rimandata</span></div>';
  else if (tr >= 0 && nTr > 1 && (S.pos === 0 || trattoDi(S.ordine[S.pos - 1]) !== tr)) {
    const x = S.giro.tratti[tr];
    h += '<div class="mazzo">📦 ' + (S.pos === 0 ? 'Primo' : 'Nuovo') + ' pezzo di mazzo: <b>N ' + x.da + '–' + x.a + '</b>' +
      (x.verso === 'indietro' ? '<br>all\'indietro: dalla <b>N ' + x.a + '</b> verso la N ' + x.da : '') + '</div>';
  }
  const q = t.buste.length;
  const vicina = S.pos > 0 && S.ordine[S.pos - 1] === t.ti - 1 && t.metri_dalla_precedente >= 30;
  h += '<h1 class="indirizzo">' + esc(t.indirizzo) + '</h1>' +
    '<div class="quante">' + (q === 1 ? '1 lettera qui' : q + ' lettere qui') +
    (vicina ? '<small>a circa ' + Math.round(t.metri_dalla_precedente / 10) * 10 + ' m dalla tappa prima</small>' : '') + '</div>';
  h += '<div class="lista">' + t.buste.map(b => rigaBusta(b.n)).join('') + '</div>';
  if (t.nota) h += '<div class="nota-box">📝 ' + esc(t.nota) + '</div>';

  h += '<div class="fondo">';
  if (tappaGestita(t.ti)) {
    h += '<div class="finita" id="finita"><div class="scritta">' +
      (tappaFinita(t.ti) ? '✅ Tappa finita' : '⏳ Palazzo da segnare dopo') + '</div>' +
      '<button class="pieno" data-a="succ">' + (ultima ? '🏁 Fine giro: vai al riepilogo' : 'Vai alla tappa successiva ›') + '</button></div>';
  }
  if (!tappaFinita(t.ti)) {
    h += '<div class="riga"><button class="neutro" data-a="salta">⏳ Salta palazzo,<br>segno dopo</button>' +
      '<button class="neutro" data-a="posticipa"' + (ultima ? ' disabled' : '') + '>↪ Posticipa</button></div>';
  }
  return h + '</div>';
}

function riquadroAvviso(n, ora, dataIso, modificabile, tardi) {
  const b = perN[n].b, a = S.giro.avviso || {};
  const cod = String(b.codice || ''), pre = String(a.prestampato_invio || '');
  const invio = (pre && cod.indexOf(pre) === 0)
    ? '<span class="pre">' + esc(pre) + '</span><span class="amano">' + esc(cod.slice(pre.length)) + '</span>'
    : '<span class="amano">' + esc(cod) + '</span>';
  const r = giornoRitiro(dataIso, a.ritiro_giorni_lavorativi_dopo || 2);
  return '<div class="modulo">' +
    '<div class="v"><span>Data</span><span>' + ggmmaaaa(dataIso) + '</span></div>' +
    '<div class="v"><span>Ora</span>' + (modificabile
      ? '<span><input class="campo' + (tardi ? ' controlla' : '') + '" type="time" id="ora" value="' + esc(ora) + '">' +
        (tardi ? '<small>⚠ Stai segnando dopo: scrivi l\'ora vera in cui hai lasciato l\'avviso.</small>' : '<small>tocca per cambiarla</small>') + '</span>'
      : '<span>' + esc(ora) + '</span>') + '</div>' +
    '<div class="v"><span>N° invio</span><span>' + invio + '</span></div>' +
    '<div class="v"><span>Destinatario</span><span>' + esc(b.destinatario) + '</span></div>' +
    '<div class="v"><span>Ritiro dal</span><span>' + GIORNI[r.getDay()] + ' ' + ggmmaaaa(iso(r)) + ' ore ' + esc(a.ritiro_ora || '11:00') +
      '<small>' + esc(a.ritiro_luogo || '') + '</small><small>' + esc(a.orari || '') + '</small></span></div></div>';
}

function pagBusta(n) {
  const b = perN[n].b, t = tappe[perN[n].ti], e = esitoDi(n), r = rec(n);
  let h = barraIndietro('Tappa ' + (S.ordine.indexOf(t.ti) + 1) + ' · ' + (t.buste.length === 1 ? '1 lettera' : t.buste.length + ' lettere'));
  h += '<div class="scheda-busta entra' + (e ? ' e-' + e : '') + '" id="scheda">' +
    '<div class="n-enorme"><small>RIGA DEL BLOCCO</small>' + n + '</div>' +
    '<button class="nome-grande" data-a="gigante" data-n="' + n + '">' + nomeHtml(b.destinatario) + '<span class="lente">⤢ tocca per vederlo gigante</span></button>' +
    '<div class="ind">' + esc(indirizzoBusta(n)) + '</div>' +
    '<div class="cod">codice …' + esc(String(b.codice || '').slice(-5)) + '</div>' +
    (e ? '<div><span class="timbro">' + (e === 'da_segnare' ? '⏳ da segnare' : NOMI[e]) + '</span></div>' : '');
  if (e === 'terzi') h += '<div class="dett">Ha ritirato: <b>' + esc(r.ritirato_da) + '</b> · ore ' + esc(r.ora || '') + '</div>';
  if (e === 'consegnata' || e === 'sconosciuto') h += '<div class="dett">Segnata alle ' + esc(r.ora || '') + '</div>';
  if (e === 'avviso') h += '<div class="dett">' + riquadroAvviso(n, r.ora_avviso || r.ora || '', r.data_avviso || iso(new Date()), false) + '</div>';
  h += '</div>';
  if (r.nota) h += '<div class="nota-box">📝 ' + esc(r.nota) + '</div>';
  h += '<div class="fondo"><div class="esiti">' +
    '<button class="esito consegnata' + (e === 'consegnata' ? ' attuale' : '') + '" data-a="esito" data-e="consegnata">Consegnata al destinatario</button>' +
    '<button class="esito terzi' + (e === 'terzi' ? ' attuale' : '') + '" data-a="esito" data-e="terzi">Ritira un\'altra persona</button>' +
    '<button class="esito avviso' + (e === 'avviso' ? ' attuale' : '') + '" data-a="esito" data-e="avviso">Avviso</button>' +
    '<button class="esito sconosciuto' + (e === 'sconosciuto' ? ' attuale' : '') + '" data-a="esito" data-e="sconosciuto">Sconosciuto</button></div>' +
    '<div class="riga">' +
    (e !== 'da_segnare' && !fatta(n) ? '<button class="neutro" data-a="segnodopo">⏳ Segno dopo</button>' : '') +
    '<button class="neutro" data-a="nota">📝 Nota</button>' +
    (e ? '<button class="neutro" data-a="togli">↺ Annulla esito</button>' : '') +
    '</div></div>';
  return h;
}

function pagDaSegnare() {
  const l = daSegnare();
  return barraIndietro('Da segnare (' + l.length + ')') +
    (l.length ? '<div class="lista">' + l.map(n => rigaBusta(n, true)).join('') + '</div>'
      : '<p class="ok">✅ Nessuna busta in sospeso.</p>');
}
function pagCerca() {
  return barraIndietro('Cerca') +
    '<input class="campo" id="q" type="search" inputmode="search" autocomplete="off" autocapitalize="characters" placeholder="Cognome o numero N" value="' + esc(vista().q || '') + '">' +
    '<div class="lista" id="ris"></div>';
}
function risultati() {
  const c = document.getElementById('q'), box = document.getElementById('ris'); if (!c || !box) return;
  const q = c.value.trim().toUpperCase();
  vista().q = c.value;
  if (!q) { box.innerHTML = '<p style="color:var(--testo2)">Scrivi le prime lettere del cognome, oppure il numero N.</p>'; return; }
  let l;
  if (/^\d+$/.test(q)) {
    l = tuttiN().filter(n => String(n) === q).concat(tuttiN().filter(n => String(n) !== q && String(n).indexOf(q) === 0));
  } else {
    const tutti = tuttiN().map(n => ({n: n, d: perN[n].b.destinatario.toUpperCase()}));
    const a = tutti.filter(x => x.d.indexOf(q) === 0);
    const b = tutti.filter(x => x.d.indexOf(q) !== 0 && x.d.split(/[\s']+/).some(p => p.indexOf(q) === 0));
    const d = tutti.filter(x => a.indexOf(x) < 0 && b.indexOf(x) < 0 && x.d.indexOf(q) >= 0);
    l = a.concat(b, d).map(x => x.n);
  }
  box.innerHTML = l.length ? l.slice(0, 40).map(n => rigaBusta(n, true)).join('') : '<p>Nessuna busta trovata.</p>';
}
function pagTappe() {
  let h = barraIndietro('Tutte le tappe');
  h += '<div class="lista">' + S.ordine.map((ti, i) => {
    const t = tappe[ti], f = t.buste.filter(b => fatta(b.n)).length;
    const ns = t.buste.map(b => b.n);
    return '<button class="tappa-r' + (i === S.pos ? ' qui' : '') + (f === t.buste.length ? ' fatta' : '') + '" data-a="vaitappa" data-i="' + i + '">' +
      '<span class="p">' + (i + 1) + '</span><span class="a">' + esc(t.indirizzo) +
      '<small>N ' + ns.join(', ') + '</small></span>' +
      (S.rimandate.indexOf(ti) >= 0 && f < t.buste.length ? '<span class="etichetta">rimandata</span>' : '') +
      '<span class="q">' + f + '/' + t.buste.length + '</span></button>';
  }).join('') + '</div>';
  return h;
}
function conteggi() {
  const c = {consegnata: 0, terzi: 0, avviso: 0, sconosciuto: 0, da_segnare: 0};
  tuttiN().forEach(n => { c[esitoDi(n) || 'da_segnare']++; });
  return c;
}
const rimandateAperte = () => S.rimandate.filter(ti => !tappaFinita(ti));
function pagRiepilogo() {
  const c = conteggi(), tot = tuttiN().length;
  const mancano = tuttiN().filter(n => !fatta(n));
  const zona = S.giro.zone[S.giro.zone.length - 1] || {};
  const rim = rimandateAperte();
  let h = barraIndietro('Riepilogo del ' + ggmmaaaa(S.giro.data));
  if (zona.parcheggio) h += '<div class="scooter">🏁 <b>Torna allo scooter</b> – vicino a ' + esc(zona.parcheggio.vicino_a) +
    (zona.ritorno_al_parcheggio_m != null ? ', ' + zona.ritorno_al_parcheggio_m + ' m' : '') + '</div>';
  h += '<div class="numeri">' +
    '<div class="e-consegnata"><b>' + (c.consegnata + c.terzi) + '</b><span>consegnate</span></div>' +
    '<div class="e-terzi"><b>' + c.terzi + '</b><span>di cui a terzi</span></div>' +
    '<div class="e-avviso"><b>' + c.avviso + '</b><span>avvisi</span></div>' +
    '<div class="e-sconosciuto"><b>' + c.sconosciuto + '</b><span>sconosciuti</span></div></div>';
  h += mancano.length
    ? '<div class="attento">⚠ ' + (mancano.length === 1 ? 'Manca l\'esito di 1 busta' : 'Manca l\'esito di ' + mancano.length + ' buste') + ' su ' + tot + '.</div>'
    : '<p class="ok">✅ Tutte le ' + tot + ' buste hanno un esito.</p>';
  if (rim.length) {
    h += '<h3>Tappe rimandate non finite</h3><div class="lista">' + rim.map(ti =>
      '<button class="tappa-r" data-a="vaitappa" data-i="' + S.ordine.indexOf(ti) + '"><span class="p">' + (S.ordine.indexOf(ti) + 1) +
      '</span><span class="a">' + esc(tappe[ti].indirizzo) + '</span><span class="etichetta">rimandata</span></button>').join('') + '</div>';
  }
  if (mancano.length) h += '<h3>Buste senza esito</h3><div class="lista">' + mancano.map(n => rigaBusta(n, true)).join('') + '</div>';
  h += '<div class="fondo"><button class="pieno" data-a="esporta">📤 Esporta riepilogo</button>' +
    (S.esportato ? '<p class="ok" style="text-align:center;margin:0">Riepilogo già esportato.</p>' : '') + '</div>';
  return h;
}

/* ================= fogli e schermo gigante ================= */
function apriFoglio(f) { foglio = f; disegnaSopra(true); }
function chiudiFoglio() { foglio = null; disegnaSopra(); }
function disegnaSopra(nuovo) {
  let h = '';
  if (foglio) h += '<div class="velo-nero" data-a="velo"><div class="foglio"' + (nuovo ? '' : ' style="animation:none"') + '>' + corpoFoglio(foglio) + '</div></div>';
  if (gigante != null) {
    const d = perN[gigante].b.destinatario, i = d.indexOf(' ');
    const cogn = i < 0 ? d : d.slice(0, i), resto = i < 0 ? '' : d.slice(i + 1);
    const px = Math.max(40, Math.min(130, Math.floor((Math.min(window.innerWidth, 560) - 32) / (cogn.length * 0.68))));
    h += '<button class="gigante" data-a="chiudigigante"><span class="cogn" style="font-size:' + px + 'px">' + esc(cogn) + '</span>' +
      (resto ? '<span class="resto">' + esc(resto) + '</span>' : '') +
      '<span class="rigaN">riga del blocco<b>' + gigante + '</b></span><span class="chiudi">tocca per chiudere</span></button>';
  }
  $sopra.innerHTML = h;
  if (foglio && nuovo) {
    const c = $sopra.querySelector('[data-fuoco]');
    if (c) { c.focus(); }
  }
}
function corpoFoglio(f) {
  const b = f.n != null ? perN[f.n].b : null;
  const chi = b ? '<p><b>N ' + f.n + '</b> · ' + esc(b.destinatario) + '</p>' : '';
  if (f.tipo === 'terzi') return '<h2>Ritira un\'altra persona</h2>' + chi +
    '<div class="ricorda terzi">✍ Fai firmare e <b>scrivi il cognome accanto alla firma</b>.</div>' +
    '<label for="cognome">Cognome di chi ritira</label>' +
    '<input class="campo maiusc" id="cognome" data-fuoco type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" value="' + esc(rec(f.n).ritirato_da || '') + '">' +
    '<p class="errore" id="err" hidden>Scrivi il cognome di chi ritira.</p>' +
    '<button class="esito terzi" data-a="ok-terzi">Fatto</button><button class="neutro" data-a="chiudifoglio">Annulla</button>';
  if (f.tipo === 'avviso') return '<h2>Avviso di giacenza</h2>' +
    '<div class="ricorda avviso">✍ Scrivi <b>AVVISO</b> sul blocco e sulla busta.<br>La busta <b>torna in borsa</b>.</div>' +
    '<p>Da copiare sull\'avviso:</p>' + riquadroAvviso(f.n, f.ora, f.data, true, f.tardi) +
    '<button class="esito avviso" data-a="ok-avviso">Fatto, avviso lasciato</button><button class="neutro" data-a="chiudifoglio">Annulla</button>';
  if (f.tipo === 'sconosciuto') return '<h2>Sconosciuto</h2>' + chi +
    '<div class="ricorda sconosciuto">✍ Scrivi <b>SCONOSCIUTO</b> sul blocco e sulla busta.</div>' +
    '<button class="esito sconosciuto" data-a="ok-sconosciuto">Fatto</button><button class="neutro" data-a="chiudifoglio">Annulla</button>';
  if (f.tipo === 'nota') return '<h2>Nota sulla busta</h2>' + chi +
    '<textarea class="campo" id="nota" data-fuoco placeholder="es. lasciata alla vicina del 2° piano">' + esc(rec(f.n).nota || '') + '</textarea>' +
    '<button class="pieno" data-a="ok-nota">Salva nota</button><button class="neutro" data-a="chiudifoglio">Annulla</button>';
  if (f.tipo === 'posticipa') {
    const i = S.pos, tr = trattoDi(S.ordine[i]);
    let altreTratto = false;
    for (let k = i + 1; k < S.ordine.length; k++) if (trattoDi(S.ordine[k]) === tr) altreTratto = true;
    return '<h2>Posticipa questo palazzo</h2><p>' + esc(tappaQui().indirizzo) + '</p>' +
      '<button class="neutro" data-a="post" data-m="prossima">Dopo la prossima tappa</button>' +
      '<button class="neutro" data-a="post" data-m="tratto"' + (altreTratto && tr >= 0 ? '' : ' disabled') + '>In fondo al tratto' +
        (tr >= 0 ? ' (' + esc(testoTratto(tr)) + ')' : '') + '</button>' +
      '<button class="neutro" data-a="post" data-m="giro">In fondo al giro</button>' +
      '<button class="neutro" data-a="chiudifoglio">Annulla</button>';
  }
  if (f.tipo === 'menu') return '<h2>Menu</h2>' +
    '<button class="neutro" data-a="tappe">Tutte le tappe</button>' +
    '<button class="neutro" data-a="riepilogo">Riepilogo ed esporta</button>' +
    '<button class="neutro" data-a="carica">Carica un altro giro</button>' +
    '<button class="neutro" data-a="anim">Animazioni: ' + (S.anim !== false ? 'sì' : 'no') + '</button>' +
    '<button class="neutro" data-a="chiudifoglio">Chiudi</button>' +
    '<p style="text-align:center;color:var(--testo2);font-size:15px">Giro del ' + ggmmaaaa(S.giro.data) + ' · affido ' + esc(S.giro.affido || '') + ' · versione ' + VERSIONE_APP + '</p>';
  // domanda generica
  return '<h2>' + esc(f.titolo) + '</h2><p>' + esc(f.testo) + '</p>' +
    (f.si ? '<button class="pieno" data-a="ok-chiedi">' + esc(f.si) + '</button>' : '') +
    '<button class="neutro" data-a="chiudifoglio">' + esc(f.no || 'Annulla') + '</button>';
}

function toast(testo, annulla) {
  clearTimeout(timerToast);
  $toast.innerHTML = '<div class="t"><span>' + esc(testo) + '</span>' + (annulla ? '<button data-a="annulla-ultimo">Annulla</button>' : '<span style="width:10px"></span>') + '</div>';
  timerToast = setTimeout(() => { $toast.innerHTML = ''; }, annulla ? 4500 : 2500);
}

/* ================= esiti ================= */
function segna(n, esito, extra) {
  const prima = S.esiti[n] ? Object.assign({}, S.esiti[n]) : null;
  const ti = perN[n].ti, eraFinita = tappaFinita(ti);
  const r = {esito: esito, ora: hhmm(new Date())};
  if (prima && prima.nota) r.nota = prima.nota;
  Object.assign(r, extra || {});
  S.esiti[n] = r; S.ultimo = {n: n, prima: prima}; S.esportato = false;
  salva();
  foglio = null;
  vibra();
  const festa = !eraFinita && tappaFinita(ti);
  const torna = () => {
    occupato = false;
    if (vista().s === 'busta') S.pila.pop();
    salva();
    dopo = () => {
      const riga = $app.querySelector('.busta[data-n="' + n + '"]');
      if (riga) riga.classList.add('appena');
      if (festa && vista().s === 'tappa' && tappaQui().ti === ti) faiFesta();
      toast('N ' + n + ' · ' + NOMI[esito], true);
    };
    disegna();
  };
  if (!animOn() || vista().s !== 'busta') return torna();
  occupato = true;
  disegna();
  const sc = document.getElementById('scheda');
  if (sc) { sc.classList.remove('entra'); sc.classList.add('timbrata'); }
  setTimeout(() => { if (sc) sc.classList.add('via'); setTimeout(torna, 280); }, 420);
}
function faiFesta() {
  const box = document.getElementById('finita'); if (!box || !animOn()) return;
  const col = ['#0E8A45', '#2463EB', '#F5A524', '#DC2F3C', '#466EA0'];
  const d = document.createElement('div'); d.className = 'festa';
  let h = '';
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2, dist = 60 + (i % 3) * 28;
    h += '<i style="background:' + col[i % col.length] + ';--x:' + Math.round(Math.cos(ang) * dist) + 'px;--y:' + Math.round(Math.sin(ang) * dist - 20) + 'px"></i>';
  }
  d.innerHTML = h; box.appendChild(d);
  setTimeout(() => d.remove(), 700);
}
function saltello() {
  const c = document.getElementById('conta'); if (!c) return;
  c.classList.remove('salto'); void c.offsetWidth; c.classList.add('salto');
}
function posticipa(modo) {
  const i = S.pos, id = S.ordine[i]; let j = i;
  if (modo === 'prossima') j = i + 1;
  else if (modo === 'tratto') { const tr = trattoDi(id); for (let k = i + 1; k < S.ordine.length; k++) if (trattoDi(S.ordine[k]) === tr) j = k; }
  else j = S.ordine.length - 1;
  foglio = null;
  if (j <= i || j >= S.ordine.length) { disegna(); return; }
  S.ordine.splice(i, 1); S.ordine.splice(j, 0, id);
  if (S.rimandate.indexOf(id) < 0) S.rimandate.push(id);
  salva(); disegna();
  toast('Palazzo rimandato: ora è la tappa ' + (j + 1));
}

/* ================= esporta ================= */
function riepilogo() {
  const adesso = new Date();
  return {
    formato: 1, data: S.giro.data, affido: S.giro.affido,
    esportato_alle: iso(adesso) + 'T' + hhmm(adesso) + ':' + due(adesso.getSeconds()),
    conteggi: conteggi(),
    buste: tuttiN().map(n => {
      const r = rec(n), e = r.esito || 'da_segnare', o = {n: n, codice: perN[n].b.codice, esito: e};
      if (e === 'terzi') o.ritirato_da = r.ritirato_da;
      if (e === 'avviso') { o.ora_avviso = r.ora_avviso || r.ora; if (r.data_avviso && r.data_avviso !== S.giro.data) o.data_avviso = r.data_avviso; }
      else if (e !== 'da_segnare') o.ora = r.ora;
      if (r.nota) o.nota = r.nota;
      return o;
    }),
    tappe_rimandate: rimandateAperte().map(ti => ({tappa: tappe[ti].tappa, indirizzo: tappe[ti].indirizzo}))
  };
}
async function esporta() {
  const testo = JSON.stringify(riepilogo(), null, 1);
  const nome = 'riepilogo_' + S.giro.data;
  const fatto = () => { S.esportato = true; salva(); disegna(); };
  // WhatsApp e Android non sempre accettano i .json in "Condividi": si prova prima .json, poi lo stesso contenuto come .txt
  const prove = [new File([testo], nome + '.json', {type: 'application/json'}), new File([testo], nome + '.txt', {type: 'text/plain'})];
  for (const f of prove) {
    try {
      if (navigator.canShare && navigator.canShare({files: [f]})) {
        await navigator.share({files: [f], title: 'Riepilogo giro ' + ggmmaaaa(S.giro.data)});
        return fatto();
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // ha chiuso la finestra di condivisione
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([testo], {type: 'application/json'}));
  a.download = nome + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Riepilogo salvato nei Download');
  fatto();
}

/* ================= tocchi ================= */
const AZIONI = {
  carica() { foglio = null; disegnaSopra(); $file.value = ''; $file.click(); },
  indietro() { indietro(); },
  velo(el, ev) { if (ev.target === el) chiudiFoglio(); },
  chiudifoglio() { chiudiFoglio(); },
  menu() { apriFoglio({tipo: 'menu'}); },
  dasegnare() { apri({s: 'dasegnare'}); },
  cerca() { apri({s: 'cerca', q: ''}); },
  tappe() { foglio = null; apri({s: 'tappe'}); },
  riepilogo() { foglio = null; apri({s: 'riepilogo'}); },
  anim() { S.anim = S.anim === false; salva(); document.body.classList.toggle('anim', animOn()); disegnaSopra(); },
  prec() { if (S.pos > 0) { S.pos--; salva(); disegna(); } },
  succ() {
    if (S.pos < S.ordine.length - 1) { S.pos++; salva(); disegna(); }
    else apri({s: 'riepilogo'});
  },
  vaitappa(el) { S.pos = Math.max(0, Math.min(S.ordine.length - 1, +el.dataset.i)); S.pila = []; salva(); disegna(); },
  busta(el) { apri({s: 'busta', n: +el.dataset.n}); },
  gigante(el) { gigante = +el.dataset.n; disegnaSopra(); },
  chiudigigante() { gigante = null; disegnaSopra(); },
  esito(el) {
    const n = vista().n, e = el.dataset.e, r = rec(n);
    if (e === 'consegnata') return segna(n, 'consegnata');
    if (e === 'avviso') {
      const gia = r.esito === 'avviso';
      return apriFoglio({tipo: 'avviso', n: n, tardi: r.esito === 'da_segnare',
        ora: gia ? (r.ora_avviso || r.ora) : hhmm(new Date()), data: gia && r.data_avviso ? r.data_avviso : iso(new Date())});
    }
    apriFoglio({tipo: e, n: n});
  },
  'ok-terzi'() {
    const c = document.getElementById('cognome'), v = c.value.trim().toUpperCase();
    if (!v) { document.getElementById('err').hidden = false; c.focus(); return; }
    segna(foglio.n, 'terzi', {ritirato_da: v});
  },
  'ok-avviso'() {
    const o = document.getElementById('ora').value || foglio.ora;
    segna(foglio.n, 'avviso', {ora_avviso: o, data_avviso: foglio.data});
  },
  'ok-sconosciuto'() { segna(foglio.n, 'sconosciuto'); },
  'ok-chiedi'() { const f = foglio.fai; foglio = null; disegnaSopra(); if (f) f(); },
  segnodopo() {
    const n = vista().n, prima = S.esiti[n] ? Object.assign({}, S.esiti[n]) : null;
    S.esiti[n] = Object.assign({}, prima && prima.nota ? {nota: prima.nota} : {}, {esito: 'da_segnare'});
    S.ultimo = {n: n, prima: prima}; S.esportato = false;
    S.pila.pop(); salva();
    dopo = () => { saltello(); toast('N ' + n + ' · da segnare dopo', true); };
    disegna();
  },
  salta() {
    const t = tappaQui(); let k = 0;
    t.buste.forEach(b => { if (!esitoDi(b.n)) { S.esiti[b.n] = Object.assign({}, rec(b.n), {esito: 'da_segnare'}); k++; } });
    S.esportato = false;
    const ultima = S.pos === S.ordine.length - 1;
    if (!ultima) S.pos++;
    salva();
    dopo = () => { if (k) saltello(); toast(k ? (k === 1 ? '1 busta' : k + ' buste') + ' da segnare dopo' : 'Palazzo già segnato'); };
    disegna();
  },
  togli() {
    const n = vista().n, prima = Object.assign({}, S.esiti[n]);
    if (prima.nota) S.esiti[n] = {nota: prima.nota}; else delete S.esiti[n];
    S.ultimo = {n: n, prima: prima}; S.esportato = false; salva(); disegna();
    toast('N ' + n + ' · esito tolto', true);
  },
  'annulla-ultimo'() {
    const u = S.ultimo; if (!u) return;
    if (u.prima) S.esiti[u.n] = u.prima; else delete S.esiti[u.n];
    S.ultimo = null; salva(); clearTimeout(timerToast); $toast.innerHTML = ''; disegna();
  },
  nota() { apriFoglio({tipo: 'nota', n: vista().n}); },
  'ok-nota'() {
    const n = foglio.n, v = document.getElementById('nota').value.trim();
    const r = Object.assign({}, rec(n));
    if (v) r.nota = v; else delete r.nota;
    if (Object.keys(r).length) S.esiti[n] = r; else delete S.esiti[n];
    S.esportato = false; foglio = null; salva(); disegna();
  },
  posticipa() { apriFoglio({tipo: 'posticipa'}); },
  post(el) { posticipa(el.dataset.m); },
  esporta() {
    const m = tuttiN().filter(n => !fatta(n)).length;
    if (m) apriFoglio({tipo: 'chiedi', titolo: 'Ci sono buste senza esito',
      testo: (m === 1 ? 'Manca l\'esito di 1 busta.' : 'Manca l\'esito di ' + m + ' buste.') + ' Nel riepilogo risulteranno "da segnare". Vuoi esportare lo stesso?',
      si: 'Esporta lo stesso', no: 'No, prima le segno', fai: esporta});
    else esporta();
  },
  aggiorna() { if (swInAttesa) swInAttesa.postMessage('AGGIORNA'); }
};

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-a]');
  if (!el || el.disabled || occupato) return;
  const f = AZIONI[el.dataset.a];
  if (f) f(el, ev);
});
document.addEventListener('input', ev => { if (ev.target.id === 'q') risultati(); });
document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.id === 'cognome') { ev.preventDefault(); AZIONI['ok-terzi'](); }
});
$file.addEventListener('change', () => {
  const f = $file.files && $file.files[0]; if (!f) return;
  f.text().then(caricaTesto, () => rifiuta('Non riesco a leggere il file.'));
});

/* ================= avvio ================= */
let swInAttesa = null;
function avvisaAggiornamento(sw) { swInAttesa = sw; document.getElementById('aggiorna').hidden = false; }
function avviaSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) avvisaAggiornamento(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nuovo = reg.installing; if (!nuovo) return;
      nuovo.addEventListener('statechange', () => {
        if (nuovo.state === 'installed' && navigator.serviceWorker.controller) avvisaAggiornamento(nuovo);
      });
    });
  }).catch(() => {});
  let ricaricato = false;
  const aveva = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!aveva || ricaricato) return;
    ricaricato = true; location.reload();
  });
}
async function prendiCondiviso() {
  if (location.search.indexOf('condiviso') < 0) return;
  history.replaceState(history.state, '', location.pathname);
  try {
    const c = await caches.open('gp-condiviso');
    const r = await c.match('./giro-condiviso');
    if (!r) return;   // pagina solo ricaricata: niente di nuovo da caricare
    const testo = await r.text();
    await c.delete('./giro-condiviso');
    caricaTesto(testo);
  } catch (e) { rifiuta('Il file condiviso non è arrivato. Riprova, oppure usa "Carica giro".'); }
}

try {
  const salvato = JSON.parse(localStorage.getItem(CHIAVE) || 'null');
  if (salvato && typeof salvato === 'object') S = salvato;
} catch (e) {}
if (S.giro) {
  if (controlla(S.giro)) S = {giro: null, anim: S.anim};
  else {
    indicizza();
    S.esiti = S.esiti || {}; S.rimandate = S.rimandate || []; S.pila = S.pila || [];
    if (!Array.isArray(S.ordine) || S.ordine.length !== tappe.length) S.ordine = tappe.map(t => t.ti);
    S.pos = Math.max(0, Math.min(S.ordine.length - 1, S.pos | 0));
    S.pila = S.pila.filter(v => v && (v.s !== 'busta' || perN[v.n]));
  }
}
disegna();
avviaSW();
prendiCondiviso();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

window.giroPostino = {caricaTesto: caricaTesto, giornoRitiro: (d, n) => iso(giornoRitiro(d, n == null ? 2 : n))};
})();
