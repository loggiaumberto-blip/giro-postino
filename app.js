/* Giro Postino – tutta la logica dell'app.
   Nessuna richiesta di rete: i dati del giro restano solo sul telefono. */
(function () {
'use strict';

const CHIAVE = 'giro_postino_v1';
const VERSIONE_APP = '1.2';
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
// uscendo dalle lettere del palazzo (tappa dopo, salta, posticipa) si torna alla schermata con indirizzo e mappa
function lasciaPalazzo() { while (S.pila && S.pila.length && S.pila[S.pila.length - 1].s === 'palazzo') S.pila.pop(); }
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
  riportaCarta();   // la mappa torna al suo posto prima di ridisegnare la pagina
  let h, chiave;
  const v = vista();
  if (!S.giro) chiave = 'inizio';
  else chiave = v.s + ':' + (v.n || '') + ':' + (v.s === 'tappa' || v.s === 'palazzo' ? S.pos : '');
  const nuova = chiave !== ultimaVista;
  if (!S.giro) h = pagInizio();
  else if (v.s === 'busta') h = pagBusta(v.n);
  else if (v.s === 'palazzo') h = pagPalazzo();
  else if (v.s === 'dasegnare') h = pagDaSegnare();
  else if (v.s === 'cerca') h = pagCerca();
  else if (v.s === 'tappe') h = pagTappe();
  else if (v.s === 'riepilogo') h = pagRiepilogo();
  else if (v.s === 'mappa') h = '';
  else h = pagTappa(nuova);
  const conMappa = !!S.giro && v.s === 'mappa';
  $app.hidden = conMappa;
  $app.classList.toggle('vista-tappa', !!S.giro && v.s === 'tappa');
  if (conMappa) mostraMappa(nuova); else nascondiMappa();
  const y = window.scrollY;
  $app.innerHTML = h;
  if (S.giro && v.s === 'tappa') mostraMini();
  if (nuova) window.scrollTo(0, 0);
  else window.scrollTo(0, y);
  ultimaVista = chiave;
  disegnaSopra();
  if (vista().s === 'cerca' && S.giro) { const c = document.getElementById('q'); if (c) { c.focus(); risultati(); } }
  if (vista().s === 'tappe' && nuova) { const q = document.querySelector('.tappa-r.qui'); if (q) q.scrollIntoView({block: 'center'}); }
  if (dopo) { const f = dopo; dopo = null; f(); }
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

function viaCivico(t) {
  if (t.via && t.civico) return {via: t.via, civ: String(t.civico)};
  const s = String(t.indirizzo || ''), i = s.lastIndexOf(',');
  return i < 0 ? {via: s, civ: ''} : {via: s.slice(0, i), civ: s.slice(i + 1).trim()};
}
/* Schermata della tappa: indirizzo grande, lettere con i numeri del blocco, mappa, pannello piccolo in basso.
   Toccando l'indirizzo si aprono le lettere del palazzo; toccando la mappa si apre a tutto schermo. */
function pagTappa(nuova) {
  const t = tappaQui(), tot = tuttiN().length, fatte = tuttiN().filter(fatta).length;
  const tr = trattoDi(t.ti), nTr = (S.giro.tratti || []).length;
  const rim = S.rimandate.indexOf(t.ti) >= 0, q = t.buste.length, vc = viaCivico(t), k = daSegnare().length;
  const vicina = S.pos > 0 && S.ordine[S.pos - 1] === t.ti - 1 && t.metri_dalla_precedente >= 30;
  const nuovoPezzo = !rim && tr >= 0 && nTr > 1 && (S.pos === 0 || trattoDi(S.ordine[S.pos - 1]) !== tr);
  let h = '<button class="indir' + (nuova ? ' entra' : '') + '" data-a="palazzo">' +
    '<span class="nomevia">' + esc(vc.via) + '</span>' + (vc.civ ? '<span class="civ">' + esc(vc.civ) + '</span>' : '') +
    '<span class="lett"><span class="q">' + (q === 1 ? '1 lettera' : q + ' lettere') + '</span>' +
    t.buste.map(b => { const e = esitoDi(b.n); return '<span class="nchip' + (e ? ' e-' + e : '') + '">' + b.n + '</span>'; }).join('') +
    (tappaFinita(t.ti) ? '<span class="ok-chip">✓ fatta</span>' : (rim ? '<span class="etichetta">↪ rimandata</span>' : '')) + '</span>' +
    '<span class="vai" aria-hidden="true">›</span></button>';
  h += '<div class="t-mappa" id="posto-mappa"><button class="t-tocca" data-a="mappa" aria-label="Apri la mappa a tutto schermo"></button>' +
    '<span class="ingrandisci">⤢ tocca per ingrandire</span></div>';
  h += '<section class="pann"><div class="nav">' +
    '<button class="freccia" data-a="prec" aria-label="Tappa precedente"' + (S.pos === 0 ? ' disabled' : '') + '>‹</button>' +
    '<button class="quale" data-a="tappe">Tappa ' + (S.pos + 1) + ' di ' + S.ordine.length +
      '<small>' + fatte + ' di ' + tot + ' buste fatte' + (vicina ? ' · a ' + Math.round(t.metri_dalla_precedente / 10) * 10 + ' m' : '') + '</small></button>' +
    '<button class="freccia" data-a="succ" aria-label="Tappa successiva">›</button></div>' +
    '<div class="avanz"><i id="barra" style="transform:scaleX(' + (tot ? fatte / tot : 0) + ')"></i></div>' +
    (tr >= 0 && nTr > 1 ? '<div class="mazzo-m' + (nuovoPezzo ? ' nuovo' : '') + '">📦 ' +
      (nuovoPezzo ? (S.pos === 0 ? 'Primo' : 'Nuovo') + ' pezzo di mazzo: ' : 'Pezzo di mazzo ') + '<b>' + esc(testoTratto(tr)) + '</b></div>' : '') +
    '<div class="icone"><button class="neutro conta cresce' + (k ? ' ha' : '') + '" data-a="dasegnare">⏳ Da segnare <b id="conta">' + k + '</b></button>' +
    '<button class="neutro" data-a="cerca" aria-label="Cerca">🔍</button>' +
    '<button class="neutro" data-a="menu" aria-label="Menu">☰</button></div></section>';
  return h;
}

/* Le lettere del palazzo (come prima la schermata della tappa) */
function pagPalazzo() {
  const t = tappaQui(), q = t.buste.length;
  const ultima = S.pos === S.ordine.length - 1;
  let h = barraIndietro('Tappa ' + (S.pos + 1) + ' di ' + S.ordine.length);
  if (S.rimandate.indexOf(t.ti) >= 0 && !tappaFinita(t.ti)) h += '<div><span class="etichetta">↪ rimandata</span></div>';
  h += '<h1 class="indirizzo">' + esc(t.indirizzo) + '</h1>' +
    '<div class="quante">' + (q === 1 ? '1 lettera qui' : q + ' lettere qui') + '</div>';
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
  if (foglio) h += '<div class="velo-nero" data-a="velo"><div class="foglio' + (SCRIVANIA[foglio.tipo] ? ' scr' + (nuovo ? ' scrivi' : '') : '') + '"' +
    (nuovo ? '' : ' style="animation:none"') + '>' + corpoFoglio(foglio) + '</div></div>';
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
  if (SCRIVANIA[f.tipo]) return scrivania(f);
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
    '<button class="neutro" data-a="mappa">🗺 Mappa del giro</button>' +
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

/* ================= Scrivania: i fogli disegnati =================
   Per "a terzi", "avviso" e "sconosciuto" si vedono il blocco, la busta e l'avviso
   disegnati, con sopra già scritto a mano quello che va scritto. */
const SCRIVANIA = {terzi: 1, avviso: 1, sconosciuto: 1};
const FIRMA = '<svg class="firma-svg" viewBox="0 0 90 30" aria-label="firma"><path d="M3 22 C 10 4, 16 4, 14 20 S 24 26, 28 12 S 36 6, 38 18 S 48 24, 52 10 C 54 4, 58 6, 56 16 S 66 24, 72 14 S 82 10, 88 16" fill="none" stroke="#1F3C9C" stroke-width="2.4" stroke-linecap="round"/></svg>';
const CROCE = '<svg class="x" viewBox="0 0 20 20"><path d="M3 4 L17 17 M16 3 L4 16" stroke="#1F3C9C" stroke-width="2.8" stroke-linecap="round" fill="none"/></svg>';
let cognomeTerzi = '';
// scritta a mano che compare (d = ritardo in secondi)
const amano = (t, d, cl) => '<span class="w" style="--d:' + (d || 0) + 's"><i class="' + (cl || '') + '">' + t + '</i></span>';
const ggmm = dataIso => { const p = dataIso.split('-'); return p[2] + '/' + p[1]; };
function cognomeHtml() { return cognomeTerzi ? '<i class="mano ev-b">' + esc(cognomeTerzi) + '</i>' : '<span class="vuoto">cognome</span>'; }
function cellaFirma(t, d) {
  if (t === 'avviso') return amano('AVVISO', d, 'mano ev-a');
  if (t === 'sconosciuto') return amano('SCONOSCIUTO', d, 'mano ev-r sm');
  if (t === 'terzi') return amano(FIRMA, d) + '<span class="cg-live">' + cognomeHtml() + '</span>';
  return '';
}
function bloccoCarta(n, t, d) {
  const b = perN[n].b, riga = m => perN[m]
    ? '<div class="br fuori"><span>' + m + '</span><span>' + esc(perN[m].b.destinatario) + '</span><span></span></div>' : '';
  return '<div class="carta blocco-c">' +
    '<div class="bt"><span>AFFIDO RACCOMANDATE N° ' + esc(S.giro.affido || '') + '</span><span>' + ggmmaaaa(S.giro.data) + '</span></div>' +
    '<div class="br th"><span>N</span><span>Destinatario</span><span>Ricevente (firma leggibile)</span></div>' +
    riga(n - 1) +
    '<div class="br qui t-' + t + '"><span>' + n + '</span><span><b class="dn">' + esc(b.destinatario) + '</b><small>' + esc(indirizzoBusta(n)) + '</small></span>' +
      '<span class="ric">' + cellaFirma(t, d) + '</span></div>' +
    riga(n + 1) + '</div>';
}
function bloccoMini(n, t, d) {
  return '<div class="carta blocco-c mini"><div class="br qui t-' + t + '"><span>' + n + '</span><span class="ric">' + cellaFirma(t, d) + '</span></div></div>';
}
function riquadroBusta(t, d, dataIso) {
  const sc = t === 'sconosciuto';
  const voci = ['Destinatario sconosciuto', 'Destinatario trasferito', 'Destinatario deceduto', 'Indirizzo errato e/o incompleto', 'rifiutato', 'altro'];
  return '<div class="rec' + (sc ? ' attivo' : '') + '"><b>Recapito non effettuato in quanto:</b>' +
    voci.map((v, i) => '<span class="voce' + (sc && i === 0 ? ' si' : '') + '"><span class="box">' + (sc && i === 0 ? amano(CROCE, d) : '') + '</span>' + v + '</span>').join('') +
    '<span class="df">Data <span class="fill">' + (sc ? amano(ggmm(dataIso), d + .1, 'mano') : '') + '</span>' +
    ' Firma <span class="fill f">' + (sc ? amano(FIRMA, d + .2) : '') + '</span></span>' +
    (t === 'avviso' ? '<span class="su">' + amano('AVVISO', d, 'mano ev-a') + '</span>' : '') + '</div>';
}
function codiceHtml(b) {
  const cod = String(b.codice || ''), pre = String((S.giro.avviso || {}).prestampato_invio || '');
  return (pre && cod.indexOf(pre) === 0) ? esc(pre) + '<b>' + esc(cod.slice(pre.length)) + '</b>' : '<b>' + esc(cod) + '</b>';
}
function bustaCarta(n, t, d, dataIso) {
  const b = perN[n].b;
  return '<div class="carta busta-c">' +
    '<div class="fin"><small>Cognome e nome</small><b>' + esc(b.destinatario) + '</b></div>' +
    '<div class="codbar"><span class="R">R</span><i class="barre"></i><span>' + codiceHtml(b) + '</span></div>' +
    riquadroBusta(t, d, dataIso) +
    (t === 'avviso' ? '<span class="borsa">↩ torna in borsa</span>' : '') + '</div>';
}
function bustaMini(n, d) {
  return '<div class="carta busta-m"><div class="fin"><b>' + esc(perN[n].b.destinatario) + '</b></div><i class="barre"></i>' +
    '<span class="su">' + amano('AVVISO', d, 'mano ev-a') + '</span><span class="borsa">↩ in borsa</span></div>';
}
function avvisoCarta(n, ora, dataIso, tardi) {
  const b = perN[n].b, cod = String(b.codice || ''), pre = String((S.giro.avviso || {}).prestampato_invio || '');
  const conPre = pre && cod.indexOf(pre) === 0;
  return '<div class="carta avviso-c">' +
    '<div class="ah"><span class="logo">MOLE<br>POST</span><span class="citta">Città di Torino</span><span class="logo l2">B&amp;B</span></div>' +
    '<div class="st">In data <span class="fill">' + amano(ggmm(dataIso), 0, 'mano') + '</span>/' + dataIso.slice(0, 4) + ', alle ore <span class="fill">' +
      amano('<input id="ora" class="ora-in' + (tardi ? ' controlla' : '') + '" type="time" value="' + esc(ora) + '">', .08) + '</span><span class="matita">✎</span>' +
      ' abbiamo tentato di consegnare la sua tessera elettorale…</div>' +
    (tardi ? '<div class="tardi">⚠ Stai segnando dopo: scrivi l\'ora vera in cui hai lasciato l\'avviso.</div>' : '') +
    '<div class="st">N° invio: ' + (conPre ? '<span class="pre">' + esc(pre) + '</span>' : '') +
      '<span class="fill inv">' + amano(esc(conPre ? cod.slice(pre.length) : cod), .16, 'mano') + '</span></div>' +
    '<div class="st">Destinatario: <span class="fill lungo">' + amano(esc(b.destinatario), .24, 'mano') + '</span></div>' +
    '<div class="righe-r"><i style="width:94%"></i><i style="width:82%"></i><i style="width:58%"></i></div>' +
    '<div class="righe-g"><i style="width:97%"></i><i style="width:66%"></i></div></div>';
}
const cap = t => '<div class="cap">' + t + '</div>';
function scrivania(f) {
  const n = f.n, b = perN[n].b, t = f.tipo, oggi = iso(new Date());
  let h = '<div class="fh"><span class="chip c-' + t + '">' + NOMI[t] + '</span><span class="fh-n">' + n + '</span>' +
    '<span class="fh-d">' + nomeHtml(b.destinatario) + '</span></div>';
  if (t === 'avviso') h += cap('Avviso di giacenza') + avvisoCarta(n, f.ora, f.data, f.tardi) +
    '<div class="due"><div>' + cap('Blocco') + bloccoMini(n, 'avviso', .3) + '</div><div>' + cap('Busta') + bustaMini(n, .3) + '</div></div>';
  if (t === 'sconosciuto') h += cap('Blocco') + bloccoCarta(n, 'sconosciuto', 0) + cap('Busta') + bustaCarta(n, 'sconosciuto', .2, oggi);
  if (t === 'terzi') h += cap('Blocco · fai firmare e scrivi il cognome') + bloccoCarta(n, 'terzi', 0) +
    '<label for="cognome" class="lab">Cognome di chi ritira</label>' +
    '<input class="campo maiusc" id="cognome" data-fuoco type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" value="' + esc(cognomeTerzi) + '">' +
    '<p class="errore" id="err" hidden>Scrivi il cognome di chi ritira.</p>';
  return h + '<div class="fondo"><button class="esito ' + t + '" data-a="ok-' + t + '">Fatto ✓</button>' +
    '<button class="neutro" data-a="chiudifoglio">Annulla</button></div>';
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
      if (festa && vista().s === 'palazzo' && tappaQui().ti === ti) faiFesta();
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
  lasciaPalazzo();
  salva(); disegna();
  toast('Palazzo rimandato: ora è la tappa ' + (j + 1));
}

/* ================= mappa (offline) =================
   La mappa della zona (strade, palazzi, verde) è un file fisso dell'app, da OpenStreetMap.
   Sopra si disegnano parcheggio, tappe e percorso presi dal file del giro, che resta sul telefono.
   Leaflet si carica solo la prima volta che si apre la mappa. */
const $mappa = document.getElementById('mappa');
const COL_TRATTI = ['#466EA0', '#0F8C8C', '#C2661B', '#6E7F2A'];
let M = null;            // {map, rGiro, giro, frecce, nomi, strati, gps}
let mappaPronta = null;  // promessa: Leaflet + dati della zona
let selMappa = -1;       // tappa scelta sulla mappa (indice ti)

function caricaScript(src) {
  return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
}
function preparaMappa() {
  if (!mappaPronta) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'lib/leaflet.css'; document.head.appendChild(l);
    mappaPronta = Promise.all([
      caricaScript('lib/leaflet.js'),
      fetch('mappa_zona.json').then(r => r.ok ? r.json() : null).catch(() => null)
    ]).then(r => r[1]);
    mappaPronta.catch(() => { mappaPronta = null; });
  }
  return mappaPronta;
}
const haCoord = ti => tappe[ti] && typeof tappe[ti].lat === 'number' && typeof tappe[ti].lon === 'number';
const puntoT = ti => [tappe[ti].lat, tappe[ti].lon];
function puntoPark(zi) { const p = (S.giro.zone[zi] || {}).parcheggio; return p && typeof p.lat === 'number' ? [p.lat, p.lon] : null; }
function metri(a, b) {
  const k = Math.cos(a[0] * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * k);
}
function angolo(a, b) {   // direzione sullo schermo, in gradi, in senso orario da destra
  return Math.atan2(-(b[0] - a[0]), (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180)) * 180 / Math.PI;
}
function scalini(a, inizio, o) {   // coordinate "a scalini" -> [[lat, lon], ...]
  const p = []; let x = 0, y = 0;
  for (let i = inizio; i + 1 < a.length; i += 2) { x += a[i]; y += a[i + 1]; p.push([o[0] + x / 1e5, o[1] + y / 1e5]); }
  return p;
}
function statoTappa(ti) {
  const es = tappe[ti].buste.map(b => esitoDi(b.n));
  if (es.every(e => FINALI.indexOf(e) >= 0)) return es.some(e => e === 'avviso' || e === 'sconosciuto') ? 'avvisi' : 'fatta';
  if (es.every(e => e)) return 'dasegnare';
  if (S.rimandate.indexOf(ti) >= 0) return 'rimandata';
  return es.some(e => e) ? 'iniziata' : 'dafare';
}

function mostraMappa(nuova) {
  $mappa.hidden = false;
  if (nuova || selMappa < 0 || !tappe[selMappa]) selMappa = S.ordine[S.pos];
  schedaMappa();
  preparaMappa().then(zona => {
    if (vista().s !== 'mappa') return;
    const prima = !M;
    if (prima) creaMappa(zona);
    M.map.invalidateSize();
    disegnaGiro();
    if ((nuova || prima) && haCoord(selMappa)) M.map.setView(puntoT(selMappa), Math.max(M.map.getZoom() || 0, 17), {animate: false});
  }, () => {
    document.getElementById('m-carta').innerHTML = '<p class="m-errore">Non riesco ad aprire la mappa. Se è la prima volta, apri l\'app una volta con internet.</p>';
  });
}
function nascondiMappa() { if (!$mappa.hidden) $mappa.hidden = true; }

/* Mappa piccola nella schermata della tappa: è la stessa mappa, spostata dentro la pagina.
   Mostra la strada dalla tappa prima a questa; toccandola si apre a tutto schermo. */
const $carta = document.getElementById('m-carta');
const $corpoMappa = $carta.parentNode;
function riportaCarta() { if ($carta.parentNode !== $corpoMappa) $corpoMappa.insertBefore($carta, $corpoMappa.firstChild); }
function mostraMini() {
  const posto = document.getElementById('posto-mappa'); if (!posto) return;
  posto.insertBefore($carta, posto.firstChild);
  selMappa = S.ordine[S.pos];
  preparaMappa().then(zona => {
    if (vista().s !== 'tappa' || $carta.parentNode !== posto) return;
    if (!M) creaMappa(zona);
    M.map.invalidateSize();
    disegnaGiro();
    inquadraTappa();
  }, () => { posto.classList.add('senza'); });
}
function inquadraTappa() {
  const ti = S.ordine[S.pos]; if (!haCoord(ti)) return;
  const pts = [puntoT(ti)], prev = S.pos > 0 ? S.ordine[S.pos - 1] : -1;
  if (prev >= 0 && haCoord(prev)) pts.push(puntoT(prev));
  else if (prev < 0) { const pk = puntoPark(tappe[ti].zi); if (pk) pts.push(pk); }
  if (pts.length > 1 && metri(pts[0], pts[1]) > 25) M.map.fitBounds(pts, {padding: [44, 44], maxZoom: 18, animate: false});
  else M.map.setView(pts[0], 18, {animate: false});
}

function creaMappa(zona) {
  const pts = tappe.filter((t, ti) => haCoord(ti)).map(t => [t.lat, t.lon]);
  let lim = L.latLngBounds(pts.length ? pts : [[45.05, 7.66]]);
  if (zona && zona.box) lim = lim.extend([[zona.box[0], zona.box[1]], [zona.box[2], zona.box[3]]]);
  const map = L.map('m-carta', {zoomControl: false, minZoom: 14, maxZoom: 19, zoomSnap: 0.5,
    maxBounds: lim.pad(0.15), maxBoundsViscosity: 0.8, fadeAnimation: false, markerZoomAnimation: animOn(), zoomAnimation: animOn()});
  map.attributionControl.setPrefix(false).addAttribution('© OpenStreetMap');
  map.setView(haCoord(selMappa) ? puntoT(selMappa) : lim.getCenter(), 17);
  M = {map: map, strati: null, gps: null,
    rGiro: L.canvas({padding: 0.4}),
    giro: L.layerGroup().addTo(map), frecce: L.layerGroup(), nomi: L.layerGroup()};
  if (zona) disegnaBase(zona);
  map.on('zoomend', zoomMappa);
  zoomMappa();
}

function disegnaBase(z) {
  const o = z.o, R = L.canvas({padding: 0.4}), map = M.map;
  const anelli = lista => lista.map(a => [scalini(a, 0, o)]);
  const base = {renderer: R, interactive: false, lineCap: 'round', lineJoin: 'round'};
  const st = M.strati = {};
  st.verde = L.polygon(anelli(z.verde || []), Object.assign({}, base, {stroke: false, fillColor: '#D3E7CE', fillOpacity: 1})).addTo(map);
  st.edifici = L.polygon(anelli(z.edifici || []), Object.assign({}, base, {color: '#BFC9D5', weight: 0.6, fillColor: '#D8DFE8', fillOpacity: 1})).addTo(map);
  st.ferrovia = L.polyline((z.ferrovia || []).map(a => scalini(a, 0, o)), Object.assign({}, base, {color: '#A3ADBA', weight: 2, dashArray: '6 5'})).addTo(map);
  const cl = [[], [], [], [], []];
  (z.strade || []).forEach(s => { if (cl[s[0]]) cl[s[0]].push(scalini(s, 2, o)); });
  st.c4 = L.polyline(cl[4], Object.assign({}, base, {color: '#AEB9C6', weight: 1.2, dashArray: '3 4'})).addTo(map);
  st.c3 = L.polyline(cl[3], Object.assign({}, base, {color: '#FFFFFF', weight: 2.5})).addTo(map);
  st.b2 = L.polyline(cl[2], Object.assign({}, base, {color: '#C3CDD9'})).addTo(map);
  st.b1 = L.polyline(cl[1], Object.assign({}, base, {color: '#C3CDD9'})).addTo(map);
  st.b0 = L.polyline(cl[0], Object.assign({}, base, {color: '#D8C79C'})).addTo(map);
  st.c2 = L.polyline(cl[2], Object.assign({}, base, {color: '#FFFFFF'})).addTo(map);
  st.c1 = L.polyline(cl[1], Object.assign({}, base, {color: '#FFFFFF'})).addTo(map);
  st.c0 = L.polyline(cl[0], Object.assign({}, base, {color: '#FBF2D9'})).addTo(map);
  // Nomi delle vie: uno ogni 300 m circa per ogni via, sul tratto dritto più lungo
  const posti = {};
  (z.strade || []).forEach(s => {
    if (s[1] < 0 || s[0] > 2) return;
    const p = scalini(s, 2, o);
    let best = 0, bi = 0;
    for (let i = 0; i + 1 < p.length; i++) { const d = metri(p[i], p[i + 1]); if (d > best) { best = d; bi = i; } }
    if (best < 70) return;
    const a = p[bi], b = p[bi + 1], c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const l = posti[s[1]] || (posti[s[1]] = []);
    if (l.some(q => metri(q, c) < 300)) return;
    l.push(c);
    let ang = angolo(a, b); if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    L.marker(c, {interactive: false, keyboard: false, icon: L.divIcon({className: 'm-via', iconSize: [0, 0],
      html: '<span style="transform:translate(-50%,-50%) rotate(' + ang.toFixed(0) + 'deg)">' + esc(z.nomi[s[1]]) + '</span>'})}).addTo(M.nomi);
  });
}

function zoomMappa() {
  const z = M.map.getZoom(), k = Math.min(2.4, Math.max(0.3, Math.pow(2, z - 16)));
  const st = M.strati;
  if (st) {
    const w = [10, 8, 6].map(x => Math.max(1, x * k));
    [0, 1, 2].forEach(c => { st['c' + c].setStyle({weight: w[c]}); st['b' + c].setStyle({weight: w[c] + (z >= 15 ? 2 : 0), opacity: z >= 15 ? 1 : 0}); });
    st.c3.setStyle({weight: Math.max(1, 3 * k)});
    st.c4.setStyle({opacity: z >= 17 ? 1 : 0});
    st.edifici.setStyle({weight: z >= 17 ? 0.6 : 0});
    if (z >= 16) M.nomi.addTo(M.map); else M.nomi.remove();
  }
  if (z >= 15.5) M.frecce.addTo(M.map); else M.frecce.remove();
  M.map.getContainer().classList.toggle('m-lontano', z < 16);
}

function decodPercorso(a) {
  const p = []; let x = 0, y = 0;
  for (let i = 0; i + 1 < a.length; i += 2) { x += a[i]; y += a[i + 1]; p.push([x / 1e5, y / 1e5]); }
  return p;
}
function primaDellaZona(ti) { return ti === 0 || tappe[ti - 1].zi !== tappe[ti].zi; }
function ultimaDellaZona(ti) { return ti === tappe.length - 1 || tappe[ti + 1].zi !== tappe[ti].zi; }

function disegnaGiro() {
  const g = M.giro, R = M.rGiro, ord = S.ordine;
  g.clearLayers(); M.frecce.clearLayers();
  const freccia = (linea, col) => {
    let tot = 0; const d = [];
    for (let i = 0; i + 1 < linea.length; i++) { d.push(metri(linea[i], linea[i + 1])); tot += d[i]; }
    if (tot < 45) return;
    let s = 0, i = 0;
    while (i < d.length - 1 && s + d[i] < tot / 2) { s += d[i]; i++; }
    const a = linea[i], b = linea[i + 1], f = d[i] ? (tot / 2 - s) / d[i] : 0;
    const c = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    L.marker(c, {interactive: false, keyboard: false, icon: L.divIcon({className: 'm-freccia', iconSize: [16, 16],
      html: '<svg viewBox="0 0 10 10" style="transform:rotate(' + angolo(a, b).toFixed(0) + 'deg)"><path d="M1.5 1 L9 5 L1.5 9 L3.5 5 Z" fill="' + col + '" stroke="#fff" stroke-width="1"/></svg>'})}).addTo(M.frecce);
  };
  for (let i = 0; i <= ord.length; i++) {
    const ritorno = i === ord.length;
    const ti = ritorno ? ord[i - 1] : ord[i], prev = i > 0 ? ord[i - 1] : -1;
    if (!haCoord(ti)) continue;
    const t = tappe[ti], zona = S.giro.zone[t.zi] || {};
    let linea = null, dritta = false;
    if (ritorno) {
      const pk = puntoPark(t.zi); if (!pk) continue;
      if (ultimaDellaZona(ti) && Array.isArray(zona.percorso_ritorno) && zona.percorso_ritorno.length >= 4) linea = decodPercorso(zona.percorso_ritorno);
      else { linea = [puntoT(ti), pk]; dritta = true; }
    } else {
      const contigua = (i === 0 && primaDellaZona(ti)) || (prev === ti - 1 && tappe[prev].zi === t.zi);
      if (contigua && Array.isArray(t.percorso) && t.percorso.length >= 4) linea = decodPercorso(t.percorso);
      else {
        const da = i === 0 ? puntoPark(t.zi) : (haCoord(prev) ? puntoT(prev) : null);
        if (!da) continue;
        linea = [da, puntoT(ti)]; dritta = true;
      }
    }
    const tr = trattoDi(ti), col = COL_TRATTI[(tr < 0 ? 0 : tr) % COL_TRATTI.length];
    const fatto = !ritorno && i <= S.pos, prossimo = i === S.pos + 1;
    L.polyline(linea, {renderer: R, interactive: false, color: col, lineCap: 'round', lineJoin: 'round',
      weight: prossimo ? 7 : (fatto ? 4 : 5), opacity: fatto ? 0.35 : 0.9,
      dashArray: ritorno ? '8 9' : (dritta ? '2 9' : null)}).addTo(g);
    if (!fatto) freccia(linea, col);
  }
  S.giro.zone.forEach((z, zi) => {
    const pk = puntoPark(zi); if (!pk) return;
    L.marker(pk, {keyboard: false, zIndexOffset: 500, icon: L.divIcon({className: '', iconSize: [36, 36], iconAnchor: [64, 18], html: '<div class="m-park">🛵</div>'})})
      .on('click', () => toast('🛵 Parcheggio vicino a ' + (z.parcheggio.vicino_a || ''))).addTo(g);
  });
  ord.forEach((ti, i) => {
    if (!haCoord(ti)) return;
    const qui = i === S.pos, sel = ti === selMappa, dim = qui ? 40 : 30;
    L.marker(puntoT(ti), {keyboard: false, zIndexOffset: qui ? 1000 : (sel ? 900 : 0),
      icon: L.divIcon({className: '', iconSize: [dim, dim],
        html: '<div class="m-t s-' + statoTappa(ti) + (qui ? ' qui' : '') + (sel ? ' sel' : '') + '">' + (i + 1) + '</div>'})})
      .on('click', () => scegliTappa(ti, false)).addTo(g);
  });
}

function scegliTappa(ti, centra) {
  selMappa = ti; schedaMappa();
  if (M) { disegnaGiro(); if (centra && haCoord(ti)) M.map.panTo(puntoT(ti), {animate: animOn()}); }
}
function schedaMappa() {
  const box = document.getElementById('m-scheda'), ti = selMappa;
  if (!tappe[ti]) { box.innerHTML = ''; return; }
  const i = S.ordine.indexOf(ti), t = tappe[ti], q = t.buste.length;
  const f = t.buste.filter(b => fatta(b.n)).length, st = statoTappa(ti);
  box.innerHTML = '<div class="m-nav">' +
    '<button class="freccia" data-a="m-prec" aria-label="Tappa prima"' + (i <= 0 ? ' disabled' : '') + '>‹</button>' +
    '<div class="m-tit">Tappa ' + (i + 1) + ' di ' + S.ordine.length + (i === S.pos ? ' <span class="m-qui">sei qui</span>' : '') +
    '<b>' + esc(t.indirizzo) + '</b></div>' +
    '<button class="freccia" data-a="m-succ" aria-label="Tappa dopo"' + (i >= S.ordine.length - 1 ? ' disabled' : '') + '>›</button></div>' +
    '<div class="m-sotto">' + (q === 1 ? '1 lettera' : q + ' lettere') + ' · N ' + t.buste.map(b => b.n).join(', ') +
    ' · <b>' + f + '/' + q + ' fatte</b>' + (st === 'rimandata' ? ' · <span class="etichetta">rimandata</span>' : '') +
    (haCoord(ti) ? '' : ' · <i>senza posizione sulla mappa</i>') + '</div>' +
    '<button class="pieno" data-a="m-vai">' + (i === S.pos ? 'Torna alla tappa' : 'Vai a questa tappa ›') + '</button>';
}
function legendaMappa() {
  const tr = S.giro.tratti || [];
  return '<b>Le tappe</b>' +
    '<div class="m-leg"><span class="m-t s-dafare qui">7</span> sei qui</div>' +
    '<div class="m-leg"><span class="m-t s-dafare">8</span> da fare</div>' +
    '<div class="m-leg"><span class="m-t s-fatta">5</span> finita</div>' +
    '<div class="m-leg"><span class="m-t s-avvisi">6</span> finita, con avvisi o sconosciuti</div>' +
    '<div class="m-leg"><span class="m-t s-dasegnare">4</span> da segnare</div>' +
    '<div class="m-leg"><span class="m-t s-rimandata">9</span> rimandata</div>' +
    '<b>Il percorso</b>' +
    (tr.length ? tr.map((x, k) => '<div class="m-leg"><i class="m-linea" style="background:' + COL_TRATTI[k % COL_TRATTI.length] + '"></i> tratto ' + (k + 1) + ': ' + esc(testoTratto(k)) + '</div>').join('') : '') +
    '<div class="m-leg"><i class="m-linea chiara"></i> già fatto</div>' +
    '<div class="m-leg"><i class="m-linea tratt"></i> ritorno allo scooter</div>' +
    '<button class="neutro" data-a="m-legenda">Chiudi</button>';
}
function dovesono() {
  if (!M || !navigator.geolocation) { toast('Posizione non disponibile su questo telefono'); return; }
  toast('Cerco la tua posizione…');
  navigator.geolocation.getCurrentPosition(p => {
    if (!M) return;
    const ll = [p.coords.latitude, p.coords.longitude], acc = Math.round(p.coords.accuracy || 0);
    if (M.gps) M.gps.forEach(l => l.remove());
    M.gps = [
      L.circle(ll, {radius: acc, renderer: M.rGiro, interactive: false, color: '#23344D', weight: 1, fillColor: '#466EA0', fillOpacity: 0.12}).addTo(M.map),
      L.marker(ll, {interactive: false, keyboard: false, zIndexOffset: 2000, icon: L.divIcon({className: '', iconSize: [22, 22], html: '<div class="m-io"></div>'})}).addTo(M.map)
    ];
    const lim = M.map.options.maxBounds;
    if (lim && !lim.contains(ll)) { toast('Sei fuori dalla zona della mappa'); return; }
    M.map.setView(ll, Math.max(M.map.getZoom(), 17), {animate: animOn()});
    toast('Sei qui · precisione circa ' + acc + ' m');
  }, e => {
    toast(e && e.code === 1 ? 'Posizione non permessa: consentila a Chrome per questa app' : 'Posizione non trovata: riprova all\'aperto');
  }, {enableHighAccuracy: true, timeout: 20000, maximumAge: 15000});
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
    lasciaPalazzo();
    if (S.pos < S.ordine.length - 1) { S.pos++; salva(); disegna(); }
    else apri({s: 'riepilogo'});
  },
  palazzo() { apri({s: 'palazzo'}); },
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
    if (e === 'terzi') cognomeTerzi = String(r.ritirato_da || '');
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
    lasciaPalazzo();
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
  mappa() { foglio = null; if (vista().s !== 'mappa') apri({s: 'mappa'}); else disegnaSopra(); },
  'm-prec'() { const i = S.ordine.indexOf(selMappa); if (i > 0) scegliTappa(S.ordine[i - 1], true); },
  'm-succ'() { const i = S.ordine.indexOf(selMappa); if (i < S.ordine.length - 1) scegliTappa(S.ordine[i + 1], true); },
  'm-vai'() { const i = S.ordine.indexOf(selMappa); if (i >= 0) S.pos = i; S.pila = []; salva(); disegna(); },
  'm-gps'() { dovesono(); },
  'm-tutto'() {
    if (!M) return;
    M.map.invalidateSize();
    const pts = S.ordine.filter(haCoord).map(puntoT);
    S.giro.zone.forEach((z, zi) => { const p = puntoPark(zi); if (p) pts.push(p); });
    if (pts.length) M.map.fitBounds(pts, {padding: [24, 24], animate: animOn()});
  },
  'm-legenda'() {
    const box = document.getElementById('m-legenda');
    if (box.hidden) { box.innerHTML = legendaMappa(); box.hidden = false; } else box.hidden = true;
  },
  aggiorna() { if (swInAttesa) swInAttesa.postMessage('AGGIORNA'); }
};

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-a]');
  if (!el || el.disabled || occupato) return;
  const f = AZIONI[el.dataset.a];
  if (f) f(el, ev);
});
document.addEventListener('input', ev => {
  if (ev.target.id === 'q') risultati();
  if (ev.target.id === 'cognome') {   // il cognome compare dal vivo sulla riga del blocco disegnata
    cognomeTerzi = ev.target.value.trim().toUpperCase();
    document.querySelectorAll('.cg-live').forEach(el => { el.innerHTML = cognomeHtml(); });
    const err = document.getElementById('err'); if (err && cognomeTerzi) err.hidden = true;
  }
});
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
