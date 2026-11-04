/* Recibo S-24 — tudo roda no aparelho: sem servidor, sem login, sem banco de dados.
 * Cada aparelho tem uma chave ECDSA P-256 própria (gerada no 1º uso).
 * Fluxo: A preenche e assina -> QR/link com os dados assinados -> B confere e assina -> PDF validado.
 */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const enc = new TextEncoder(), dec = new TextDecoder();

/* ---------- utilidades ---------- */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('s24.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('s24.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('s24.' + k); } catch {} },
};
const fmtValor = c => c == null || c === '' ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoje = () => { const d = new Date(); return [d.getDate(), d.getMonth() + 1].map(n => String(n).padStart(2, '0')).join('-') + '-' + d.getFullYear(); };
const fmtHora = ms => { const d = new Date(ms); return [d.getDate(), d.getMonth() + 1].map(n => String(n).padStart(2, '0')).join('-') + '-' + d.getFullYear() + ' ' + [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':'); };
function dataValida(s) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s); if (!m) return false;
  const d = new Date(+m[3], m[2] - 1, +m[1]);
  return d.getFullYear() == m[3] && d.getMonth() == m[2] - 1 && d.getDate() == m[1];
}
async function sha256hex(str) { const h = await crypto.subtle.digest('SHA-256', enc.encode(str)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); }

/* ---------- identidade do aparelho ---------- */
const ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIG = { name: 'ECDSA', hash: 'SHA-256' };
async function identidade() {
  let id = store.get('id');
  if (!id) {
    const kp = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    id = { priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), nome: '' };
    store.set('id', id);
  }
  return id;
}
async function assinar(msg) {
  const id = await identidade();
  const k = await crypto.subtle.importKey('jwk', id.priv, ALG, false, ['sign']);
  return b64u(await crypto.subtle.sign(SIG, k, enc.encode(msg)));
}
async function verificar(pub, sig, msg) {
  try {
    const k = await crypto.subtle.importKey('raw', unb64u(pub), ALG, false, ['verify']);
    return await crypto.subtle.verify(SIG, k, unb64u(sig), enc.encode(msg));
  } catch { return false; }
}
const base = r => ({ v: 1, id: r.id, t: r.t, d: r.d, c: r.c, l: r.l });
const msgA = r => JSON.stringify([base(r), r.a.n, r.a.k, r.a.h]);
const msgB = r => JSON.stringify([base(r), r.a, r.b.n, r.b.k, r.b.h]);

/* ---------- estado ---------- */
let R = null;          // recibo atual
let modo = 'novo';     // novo | aguardando | conferir | validado | cancelado

function novoRecibo() {
  return { id: b64u(crypto.getRandomValues(new Uint8Array(9))), t: 'Donativo', d: hoje(), c: [null, null, null, null, null], l: ['', '', ''] };
}
const total = r => r.c.reduce((s, v) => s + (v || 0), 0);

/* ---------- tela ---------- */
function ajustarEscala() {
  const f = $('#folha'), p = $('#palco');
  const k = Math.min(1.6, p.clientWidth / f.offsetWidth);
  f.style.transform = `scale(${k})`;
  p.style.height = f.offsetHeight * k + 'px';
}
function status(txt, tipo = '') {
  const s = $('#status'); s.hidden = !txt; s.className = 'status ' + tipo; s.innerHTML = txt || '';
}
function linhaAss(x) { return x ? `<span>${esc(x.n)}</span><small>Assinado digitalmente em ${fmtHora(x.h)} · cód. ${x.cod || ''}</small>` : ''; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function render() {
  const edit = modo === 'novo';
  $('#data').value = R.d; $('#data').disabled = !edit;
  $$('.tipo').forEach(b => { b.classList.toggle('on', b.dataset.tipo === R.t); if (b.dataset.tipo !== 'Deposito') b.disabled = !edit; });
  $$('.desc').forEach(i => { i.value = R.l[i.dataset.l]; i.disabled = !edit; });
  $$('input.valor').forEach(i => { i.value = fmtValor(R.c[i.dataset.v]); i.disabled = !edit; });
  $('#total').textContent = fmtValor(total(R)) || '';
  $('#assA').innerHTML = linhaAss(R.a); $('#assB').innerHTML = linhaAss(R.b);
  $('#qrBox').hidden = modo !== 'aguardando';
  const A = $('#acoes'); A.innerHTML = '';
  const btn = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.className = cls; b.onclick = fn; A.append(b); };
  if (modo === 'novo') btn('Assinar como "Preenchido por"', 'pri', assinarA);
  if (modo === 'aguardando') {
    btn('Enviar link pelo WhatsApp', 'pri', () => abrirWhats(`Recibo S-24 para conferir (total ${fmtValor(total(R))}):\n${linkRecibo()}`));
    btn('Cancelar recibo', 'perigo', () => cancelar('A'));
  }
  if (modo === 'conferir') {
    btn('Conferido — assinar e validar', 'pri', assinarB);
    btn('Cancelar recibo', 'perigo', () => cancelar('B'));
  }
  if (modo === 'validado') btn('Compartilhar PDF (WhatsApp)', 'pri', compartilharPDF);
  if (modo !== 'novo' && modo !== 'aguardando' && modo !== 'conferir') btn('Novo recibo', '', () => { location.hash = ''; iniciar(); });
  requestAnimationFrame(ajustarEscala);
}

/* ---------- entrada de dados ---------- */
$('#data').addEventListener('input', e => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 8);
  e.target.value = [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('-');
  R.d = e.target.value;
});
$$('input.valor').forEach(i => {
  i.inputMode = 'numeric'; i.autocomplete = 'off';
  i.addEventListener('input', () => {
    const d = i.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
    R.c[i.dataset.v] = d ? +d : null;
    i.value = fmtValor(R.c[i.dataset.v]);
    $('#total').textContent = fmtValor(total(R)) || '';
  });
});
$$('.desc').forEach(i => { i.maxLength = 60; i.addEventListener('input', () => { R.l[i.dataset.l] = i.value; }); });
$$('.tipo').forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.tipo;
  if (modo !== 'novo' || t === 'Deposito' || t === R.t) return;
  if ((t === 'Pagamento' || t === 'Adiantamento') && !confirm(`Confirmar o tipo "${t}"?\n\nO padrão é "Donativo".`)) return;
  R.t = t; render();
}));

/* ---------- fluxo ---------- */
async function garantirNome() {
  const id = await identidade();
  if (id.nome) return id;
  return new Promise(res => {
    const dlg = $('#dlgNome'); $('#inNome').value = '';
    dlg.onclose = async () => {
      const n = $('#inNome').value.trim();
      if (!n) return res(null);
      id.nome = n; store.set('id', id); mostrarEu(); res(id);
    };
    dlg.showModal();
  });
}
function validarCampos() {
  if (!dataValida(R.d)) return 'Data inválida. Use dd-mm-aaaa.';
  if (!total(R)) return 'Informe pelo menos um valor.';
  for (let i = 0; i < 3; i++) {
    if (R.c[i + 2] && !R.l[i].trim()) return `Descreva a linha ${i + 1} (tem valor sem descrição).`;
    if (!R.c[i + 2] && R.l[i].trim()) return `Informe o valor da linha "${R.l[i].trim()}".`;
  }
  return null;
}
async function assinarA() {
  const erro = validarCampos(); if (erro) return status(erro, 'erro');
  const id = await garantirNome(); if (!id) return;
  if (!confirm(`Assinar como "${id.nome}" (Preenchido por)?\n\nTotal: ${fmtValor(total(R))}\nDepois de assinado, os dados não podem ser alterados.`)) return;
  R.l = R.l.map(s => s.trim());
  R.a = { n: id.nome, k: id.pub, h: Date.now() };
  R.a.s = await assinar(msgA(R));
  R.a.cod = (await sha256hex(R.a.s)).slice(0, 8).toUpperCase();
  store.set('pendente', R);
  modo = 'aguardando'; mostrarQR();
  status('Assinado. Agora <b>outra pessoa, em outro aparelho</b>, deve conferir: mostre o QR Code ou envie o link.');
  render();
}
function payload(r) { const { cod, ...a } = r.a; return b64u(enc.encode(JSON.stringify({ ...base(r), a }))); }
function linkRecibo() { return location.origin + location.pathname + '#r=' + payload(R); }
function mostrarQR() {
  const q = qrcode(0, 'L'); q.addData(linkRecibo()); q.make();
  $('#qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}
function abrirWhats(txt) { window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank'); }

async function abrirLink(p) {
  let r;
  try { r = JSON.parse(dec.decode(unb64u(p))); } catch { return status('Link inválido ou incompleto.', 'erro'); }
  R = r;
  R.a.cod = (await sha256hex(R.a.s)).slice(0, 8).toUpperCase();
  if (!await verificar(R.a.k, R.a.s, msgA(R))) { modo = 'cancelado'; render(); return status('<b>Assinatura inválida.</b> Os dados deste recibo foram alterados depois de assinados. Não confira.', 'erro'); }
  const ok = store.get('validados', {})[R.id];
  if (ok) { R = ok; modo = 'validado'; render(); return status('Este recibo já foi validado neste aparelho.', 'ok'); }
  if (store.get('cancelados', []).includes(R.id)) { modo = 'cancelado'; render(); return status('Este recibo foi <b>cancelado</b>. Um novo recibo deve ser feito.', 'erro'); }
  const id = await identidade();
  if (id.pub === R.a.k) {
    const pend = store.get('pendente');
    modo = pend && pend.id === R.id ? 'aguardando' : 'cancelado';
    if (modo === 'aguardando') { R = pend; mostrarQR(); }
    render();
    return status('Você preencheu este recibo. A conferência deve ser feita por <b>outra pessoa, em outro aparelho</b>.', 'erro');
  }
  modo = 'conferir'; render();
  status(`Confira os valores preenchidos por <b>${esc(R.a.n)}</b>. Se algo estiver errado, cancele o recibo.`);
}
async function assinarB() {
  const id = await garantirNome(); if (!id) return;
  if (id.pub === R.a.k) return status('Quem preencheu não pode conferir.', 'erro');
  if (!confirm(`Confirmo que conferi o recibo de total ${fmtValor(total(R))}.\nAssinar como "${id.nome}" (Conferido por)?`)) return;
  R.b = { n: id.nome, k: id.pub, h: Date.now() };
  R.b.s = await assinar(msgB(R));
  R.b.cod = (await sha256hex(R.b.s)).slice(0, 8).toUpperCase();
  const v = store.get('validados', {}); v[R.id] = R; store.set('validados', v);
  modo = 'validado'; render();
  status('<b>Recibo validado.</b> Compartilhe o PDF.', 'ok');
}
function cancelar(quem) {
  if (!confirm('Cancelar este recibo? Ele não poderá ser validado e um novo recibo deverá ser feito.')) return;
  const c = store.get('cancelados', []); c.push(R.id); store.set('cancelados', c.slice(-200));
  if (quem === 'A') store.del('pendente');
  modo = 'cancelado'; render();
  if (quem === 'B') {
    status('Recibo cancelado. Avise quem preencheu para fazer um novo.', 'erro');
    if (confirm('Avisar quem preencheu pelo WhatsApp?')) abrirWhats(`O recibo S-24 de ${R.d} (total ${fmtValor(total(R))}) preenchido por ${R.a.n} foi CANCELADO na conferência. Por favor, faça um novo recibo.`);
  } else status('Recibo cancelado. Se já enviou o link, avise quem iria conferir.', 'erro');
}

/* ---------- PDF (escreve sobre o S-24-T original) ---------- */
async function gerarPDF() {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.load(await (await fetch('S-24_T.pdf')).arrayBuffer());
  const pg = doc.getPage(0);
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const cor = rgb(0, 0.12, 0.45);
  const txt = (s, x, y, sz = 8, fonte = f) => pg.drawText(s, { x, y, size: sz, font: fonte, color: cor });
  const dir = (s, x, y, sz = 8, fonte = f) => txt(s, x - fonte.widthOfTextAtSize(s, sz), y, sz, fonte);
  const meio = (s, x, y, sz, fonte = f) => txt(s, x - fonte.widthOfTextAtSize(s, sz) / 2, y, sz, fonte);
  txt(R.d, 306, 191.5, 8);
  const cx = { Donativo: [41.4, 179.3], Deposito: [41.4, 167], Pagamento: [169.2, 179.3], Adiantamento: [169.2, 167] }[R.t];
  meio('X', cx[0], cx[1] - 2.5, 7, fb);
  const ys = [145.3, 130.5, 116.5, 102.1, 88];
  R.c.forEach((v, i) => v && dir(fmtValor(v), 356, ys[i]));
  R.l.forEach((s, i) => s && txt(s, 40, ys[i + 2]));
  dir(fmtValor(total(R)), 356, 73.6, 8, fb);
  for (const [x, a] of [[108, R.a], [288, R.b]]) {
    meio(a.n, x, 57, 7.5);
    meio(`Assinado digitalmente em ${fmtHora(a.h)} · cód. ${a.cod}`, x, 50.8, 4.3);
  }
  doc.setTitle(`Recibo S-24 ${R.d}`);
  doc.setSubject('S24v1:' + b64u(enc.encode(JSON.stringify({ ...base(R), a: strip(R.a), b: strip(R.b) }))));
  doc.setProducer('Recibo S-24'); doc.setCreator('Recibo S-24');
  return doc.save();
}
const strip = ({ cod, ...x }) => x;
async function compartilharPDF() {
  const bytes = await gerarPDF();
  const nome = `Recibo-S24-${R.d}-${R.id.slice(0, 5)}.pdf`;
  const file = new File([bytes], nome, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Recibo S-24' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- início ---------- */
async function mostrarEu() { const id = await identidade(); $('#btnEu').textContent = id.nome ? `👤 ${id.nome}` : 'Definir meu nome'; }
$('#btnEu').onclick = async () => { const id = await identidade(); id.nome = ''; store.set('id', id); await garantirNome(); mostrarEu(); };
window.addEventListener('resize', ajustarEscala);

async function iniciar() {
  status('');
  if (!window.isSecureContext || !crypto.subtle) return status('Abra o app por HTTPS para usar as assinaturas digitais.', 'erro');
  mostrarEu();
  const p = new URLSearchParams(location.hash.slice(1)).get('r');
  if (p) return abrirLink(p);
  const pend = store.get('pendente');
  if (pend && !store.get('cancelados', []).includes(pend.id) && confirm('Há um recibo assinado por você aguardando conferência. Abri-lo?')) {
    R = pend; modo = 'aguardando'; mostrarQR(); render();
    return status('Aguardando conferência por outra pessoa, em outro aparelho.');
  }
  store.del('pendente');
  R = novoRecibo(); modo = 'novo'; render();
}
window.addEventListener('hashchange', iniciar);
iniciar();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
