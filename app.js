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
const hoje = () => { const d = new Date(); return [d.getDate(), d.getMonth() + 1].map(n => String(n).padStart(2, '0')).join('/') + '/' + d.getFullYear(); };
const fmtHora = ms => { const d = new Date(ms); return [d.getDate(), d.getMonth() + 1].map(n => String(n).padStart(2, '0')).join('/') + '/' + d.getFullYear() + ' ' + [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':'); };
function dataValida(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); if (!m) return false;
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
const strip = ({ cod, ...x }) => x;
const base = r => ({ v: 1, id: r.id, t: r.t, d: r.d, c: r.c, l: r.l });
const msgA = r => JSON.stringify([base(r), r.a.n, r.a.k, r.a.h]);
const msgB = (r, aExtra) => JSON.stringify([base(r), aExtra || strip(r.a), r.b.n, r.b.k, r.b.h]);
// versão 1 do app incluía o código impresso ("cod") na assinatura de quem conferiu
const msgBLegado = async r => msgB(r, { ...strip(r.a), cod: (await sha256hex(r.a.s)).slice(0, 8).toUpperCase() });

/* ---------- estado ---------- */
let R = null;          // recibo atual
let modo = 'novo';     // novo | aguardando | conferir | validado | cancelado

function novoRecibo() {
  return { id: b64u(crypto.getRandomValues(new Uint8Array(9))), t: 'Donativo', d: hoje(), c: [null, null, null, null, null], l: ['', '', ''] };
}
const nomeArq = r => `Recibo-S24-${r.d.replace(/\//g, '-')}-${r.id.slice(0, 5)}.pdf`;
const LIMITE = 99999; // 999,99 em centavos
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
  pintarValores();
  $('#assA').innerHTML = linhaAss(R.a); $('#assB').innerHTML = linhaAss(R.b);
  $('#qrBox').hidden = modo !== 'aguardando';
  const A = $('#acoes'); A.innerHTML = '';
  const btn = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.className = cls; b.onclick = fn; A.append(b); };
  if (modo === 'novo') {
    btn('Assinar como "Preenchido por"', 'pri', assinarA);
    btn('Conferir: ler QR Code', '', lerQR);
  }
  if (modo === 'aguardando') {
    btn('Enviar link pelo WhatsApp', 'pri', () => abrirWhats(`Recibo S-24 para conferir (total ${fmtValor(total(R))}):\n${linkRecibo()}`));
    btn('Cancelar recibo', 'perigo', () => cancelar('A'));
    btn('Já foi conferido — novo recibo', '', () => {
      if (!confirm('A outra pessoa já conferiu e validou este recibo?\n\nA tela será limpa para um novo recibo.')) return;
      store.del('pendente'); location.hash = ''; iniciar();
    });
  }
  if (modo === 'conferir') {
    btn('Conferido — assinar e validar', 'pri', assinarB);
    btn('Cancelar recibo', 'perigo', () => cancelar('B'));
  }
  if (modo === 'validado') {
    btn('Compartilhar PDF (WhatsApp)', 'pri', compartilharPDF);
    btn('Baixar PDF', '', baixarPDF);
    if (!(store.get('validados', {})[R.id] || {}).enviado) btn('Marcar como enviado', '', () => { marcarEnviado(R.id); render(); status('Marcado como enviado.', 'ok'); });
  }
  if (modo !== 'novo' && modo !== 'aguardando' && modo !== 'conferir') btn('Novo recibo', '', () => { location.hash = ''; iniciar(); });
  renderPendentes();
  requestAnimationFrame(ajustarEscala);
}

/* ---------- recibos validados aguardando envio (só neste aparelho) ---------- */
function marcarEnviado(id) { const v = store.get('validados', {}); if (v[id]) { v[id].enviado = Date.now(); store.set('validados', v); } }
function limparValidados() {
  // guarda no máximo 200; os já enviados há mais de 60 dias são descartados
  const v = store.get('validados', {}), lim = Date.now() - 60 * 864e5;
  const ids = Object.keys(v).filter(id => !(v[id].enviado && v[id].enviado < lim)).sort((a, b) => v[b].b.h - v[a].b.h).slice(0, 200);
  store.set('validados', Object.fromEntries(ids.map(id => [id, v[id]])));
}
function renderPendentes() {
  const box = $('#pendentes'), ul = $('#listaPend');
  const lista = Object.values(store.get('validados', {})).filter(r => !r.enviado).sort((a, b) => b.b.h - a.b.h);
  box.hidden = modo !== 'novo' || !lista.length;
  ul.innerHTML = '';
  for (const r of lista) {
    const li = document.createElement('li');
    li.innerHTML = `<div><b>${esc(r.d)}</b> · ${esc(r.t === 'Deposito' ? 'Depósito' : r.t)} · <b>${fmtValor(total(r))}</b><br><span class="peq">${esc(r.a.n)} / ${esc(r.b.n)}</span></div>`;
    const bt = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.className = cls; b.onclick = fn; li.append(b); };
    bt('Enviar', 'pri', () => { R = r; modo = 'validado'; render(); compartilharPDF(); });
    bt('Já enviei', '', () => { if (confirm('Tirar este recibo da lista de envio?')) { marcarEnviado(r.id); renderPendentes(); } });
    ul.append(li);
  }
  $('#qtdPend').textContent = lista.length;
}

/* ---------- entrada de dados ---------- */
$('#data').addEventListener('input', e => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 8);
  e.target.value = [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
  R.d = e.target.value;
});
$$('input.valor').forEach(i => {
  i.inputMode = 'numeric'; i.autocomplete = 'off';
  i.addEventListener('input', () => {
    // um "-" digitado em qualquer posição inverte o sinal
    const neg = ((i.value.match(/-/g) || []).length % 2) === 1;
    const d = i.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
    R.c[i.dataset.v] = d ? (neg ? -d : +d) : null;
    i.value = d ? fmtValor(R.c[i.dataset.v]) : (neg ? '-' : '');
    pintarValores();
  });
  i.addEventListener('focus', () => { campoValor = i; $('#btnSinal').hidden = modo !== 'novo' || editorAtivo(); });
  i.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== i) $('#btnSinal').hidden = true; }, 150));
});
let campoValor = null;
function pintarValores() {
  $$('input.valor').forEach(i => i.classList.toggle('negativo', (R.c[i.dataset.v] || 0) < 0));
  const t = total(R), o = $('#total');
  o.textContent = R.c.some(v => v) ? fmtValor(t) : ''; o.classList.toggle('negativo', t < 0);
}
function inverterSinal(i) {
  const k = i.dataset.v;
  if (R.c[k]) { R.c[k] = -R.c[k]; i.value = fmtValor(R.c[k]); } else i.value = i.value === '-' ? '' : '-';
  pintarValores();
}
$('#btnSinal').addEventListener('pointerdown', e => e.preventDefault()); // não tira o foco do campo
$('#btnSinal').addEventListener('click', () => campoValor && inverterSinal(campoValor));
$$('.desc').forEach(i => { i.maxLength = 60; i.addEventListener('input', () => { R.l[i.dataset.l] = i.value; }); });
$$('.tipo').forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.tipo;
  if (modo !== 'novo' || t === 'Deposito' || t === R.t) return;
  if ((t === 'Pagamento' || t === 'Adiantamento') && !confirm(`Confirmar o tipo "${t}"?\n\nO padrão é "Donativo".`)) return;
  R.t = t; render();
}));

/* ---------- editor ampliado: só celular em pé ---------- */
const mqEmPe = matchMedia('(orientation: portrait) and (max-width: 600px)');
const editorAtivo = () => mqEmPe.matches;
const ROTULOS = { data: 'Data (dd/mm/aaaa)', v0: 'Donativos — Obra mundial', v1: 'Donativos — Despesas da congregação local',
  l0: 'Linha 1 — descrição', v2: 'Linha 1 — valor', l1: 'Linha 2 — descrição', v3: 'Linha 2 — valor', l2: 'Linha 3 — descrição', v4: 'Linha 3 — valor' };
const ORDEM = ['data', 'v0', 'v1', 'l0', 'v2', 'l1', 'v3', 'l2', 'v4'];
const campoDe = k => k === 'data' ? $('#data') : k[0] === 'v' ? $(`input.valor[data-v="${k[1]}"]`) : $(`.desc[data-l="${k[1]}"]`);
let edK = null;
function abrirEditor(k) {
  edK = k; const orig = campoDe(k), big = $('#edInput'), dlg = $('#dlgEditor');
  $('#edRotulo').textContent = ROTULOS[k];
  big.inputMode = orig.inputMode || 'text'; big.maxLength = orig.maxLength > 0 ? orig.maxLength : 60;
  big.value = orig.value; big.classList.toggle('negativo', orig.classList.contains('negativo'));
  $('#edSinal').hidden = k[0] !== 'v';
  $('#edProx').hidden = ORDEM.indexOf(k) === ORDEM.length - 1;
  if (!dlg.open) dlg.showModal();
  big.focus(); big.setSelectionRange(big.value.length, big.value.length);
}
function espelhar() { const o = campoDe(edK), big = $('#edInput'); big.value = o.value; big.classList.toggle('negativo', o.classList.contains('negativo')); }
$('#edInput').addEventListener('input', () => { const o = campoDe(edK); o.value = $('#edInput').value; o.dispatchEvent(new Event('input')); espelhar(); });
$('#edSinal').addEventListener('pointerdown', e => e.preventDefault());
$('#edSinal').onclick = () => { inverterSinal(campoDe(edK)); espelhar(); };
$('#edProx').onclick = () => abrirEditor(ORDEM[ORDEM.indexOf(edK) + 1]);
$('#edOk').onclick = () => $('#dlgEditor').close();
$('#edInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#edProx').hidden ? $('#dlgEditor').close() : $('#edProx').click(); } });
ORDEM.forEach(k => campoDe(k).addEventListener('focus', e => {
  if (!editorAtivo() || modo !== 'novo') return;
  e.target.blur(); abrirEditor(k);
}));

/* ---------- leitor de QR Code dentro do app ---------- */
let leitor = null;
async function lerQR() {
  const dlg = $('#dlgQR'), video = $('#qrVideo');
  try { leitor = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
  catch { return status('Não foi possível abrir a câmera. Verifique a permissão de câmera do navegador.', 'erro'); }
  video.srcObject = leitor; await video.play(); dlg.showModal();
  let detectar;
  if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
    const bd = new BarcodeDetector({ formats: ['qr_code'] });
    detectar = async () => (await bd.detect(video))[0]?.rawValue;
  } else {
    if (!window.jsQR) await new Promise((ok, erro) => { const s = document.createElement('script'); s.src = 'vendor/jsQR.js'; s.onload = ok; s.onerror = erro; document.head.append(s); });
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
    detectar = async () => {
      if (!video.videoWidth) return null;
      const w = Math.min(640, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
      cv.width = w; cv.height = h; ctx.drawImage(video, 0, 0, w, h);
      return jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data;
    };
  }
  const passo = async () => {
    if (!leitor) return;
    let txt = null; try { txt = await detectar(); } catch {}
    const m = txt && /#r=([\w-]+)/.exec(txt);
    if (m) { fecharQR(); location.hash = 'r=' + m[1]; return; }
    if (txt) $('#qrMsg').textContent = 'Este QR Code não é de um recibo S-24.';
    setTimeout(passo, 200);
  };
  passo();
}
function fecharQR() { if (leitor) leitor.getTracks().forEach(t => t.stop()); leitor = null; const d = $('#dlgQR'); if (d.open) d.close(); $('#qrMsg').textContent = ''; }
$('#qrFechar').onclick = fecharQR;
$('#dlgQR').addEventListener('close', fecharQR);

/* ---------- fluxo ---------- */
async function garantirNome(trocar = false) {
  const id = await identidade();
  if (id.nome && !trocar) return id;
  return new Promise(res => {
    const dlg = $('#dlgNome'); $('#inNome').value = id.nome || '';
    $('#btnCancNome').onclick = () => dlg.close('cancel');
    dlg.onclose = async () => {
      const n = $('#inNome').value.trim();
      if (dlg.returnValue !== 'ok' || !n) return res(id.nome ? id : null);
      id.nome = n; store.set('id', id); mostrarEu(); res(id);
    };
    dlg.returnValue = ''; dlg.showModal();
  });
}
function validarCampos() {
  if (!dataValida(R.d)) return 'Data inválida. Use dd/mm/aaaa.';
  if (!R.c.some(v => v)) return 'Informe pelo menos um valor.';
  for (let i = 0; i < 3; i++) {
    if (R.c[i + 2] && !R.l[i].trim()) return `Descreva a linha ${i + 1} (tem valor sem descrição).`;
    if (!R.c[i + 2] && R.l[i].trim()) return `Informe o valor da linha "${R.l[i].trim()}".`;
  }
  return null;
}
async function assinarA() {
  const erro = validarCampos(); if (erro) return status(erro, 'erro');
  if (total(R) > LIMITE && !confirm(`ATENÇÃO: o total ${fmtValor(total(R))} passa de 999,99.\n\nO valor está correto?`)) return;
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
  status(`Confira os valores preenchidos por <b>${esc(R.a.n)}</b>. Se algo estiver errado, cancele o recibo.` +
    (total(R) > LIMITE ? `<br><b>Atenção:</b> o total ${fmtValor(total(R))} passa de 999,99.` : ''));
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
  const v = await verificarRecibo(R);
  if (!v.ok) throw new Error('PDF não gerado: ' + v.erro);
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.load(await (await fetch('S-24_T.pdf')).arrayBuffer());
  const pg = doc.getPage(0);
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const cor = rgb(0, 0.12, 0.45);
  const verm = rgb(0.75, 0, 0);
  const txt = (s, x, y, sz = 8, fonte = f, c = cor) => pg.drawText(s, { x, y, size: sz, font: fonte, color: c });
  const dir = (s, x, y, sz = 8, fonte = f, c = cor) => txt(s, x - fonte.widthOfTextAtSize(s, sz), y, sz, fonte, c);
  const meio = (s, x, y, sz, fonte = f) => txt(s, x - fonte.widthOfTextAtSize(s, sz) / 2, y, sz, fonte);
  txt(R.d, 306, 191.5, 8);
  const cx = { Donativo: [41.4, 179.3], Deposito: [41.4, 167], Pagamento: [169.2, 179.3], Adiantamento: [169.2, 167] }[R.t];
  meio('X', cx[0], cx[1] - 2.5, 7, fb);
  const ys = [145.3, 130.5, 116.5, 102.1, 88];
  R.c.forEach((v, i) => v && dir(fmtValor(v), 356, ys[i], 8, f, v < 0 ? verm : cor));
  R.l.forEach((s, i) => s && txt(s, 40, ys[i + 2]));
  dir(fmtValor(total(R)), 356, 73.6, 8, fb, total(R) < 0 ? verm : cor);
  for (const [x, a] of [[108, R.a], [288, R.b]]) {
    meio(a.n, x, 57, 7.5);
    meio(`Assinado digitalmente em ${fmtHora(a.h)} · cód. ${a.cod}`, x, 50.8, 4.3);
  }
  doc.setTitle(`Recibo S-24 ${R.d}`);
  doc.setSubject('S24v1:' + b64u(enc.encode(JSON.stringify({ ...base(R), a: strip(R.a), b: strip(R.b) }))));
  doc.setProducer('Recibo S-24'); doc.setCreator('Recibo S-24');
  return doc.save();
}

/* ---------- verificação das assinaturas (sempre automática) ---------- */
async function verificarRecibo(r) {
  if (!r.a || !await verificar(r.a.k, r.a.s, msgA(r))) return { ok: false, erro: 'assinatura de "Preenchido por" inválida — dados alterados.' };
  if (!r.b) return { ok: false, erro: 'falta a assinatura de "Conferido por".' };
  if (r.b.k === r.a.k) return { ok: false, erro: 'as duas assinaturas são do mesmo aparelho.' };
  if (!await verificar(r.b.k, r.b.s, msgB(r)) && !await verificar(r.b.k, r.b.s, await msgBLegado(r))) return { ok: false, erro: 'assinatura de "Conferido por" inválida — dados alterados.' };
  return { ok: true };
}
async function verificarPDF(bytes) {
  let r;
  try {
    const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    const sub = doc.getSubject() || '';
    if (!sub.startsWith('S24v1:')) throw 0;
    r = JSON.parse(dec.decode(unb64u(sub.slice(6))));
  } catch { modo = 'cancelado'; R = novoRecibo(); render(); return status('<b>Este PDF não é um recibo S-24 gerado por este app</b> (ou foi modificado).', 'erro'); }
  for (const x of [r.a, r.b].filter(Boolean)) x.cod = (await sha256hex(x.s)).slice(0, 8).toUpperCase();
  const v = await verificarRecibo(r);
  R = r; modo = 'verificado'; render();
  if (!v.ok) return status(`<b>✗ Recibo NÃO é válido:</b> ${esc(v.erro)}`, 'erro');
  status(`<b>✓ Recibo autêntico.</b> Assinado por <b>${esc(r.a.n)}</b> e conferido por <b>${esc(r.b.n)}</b>, em aparelhos diferentes.<br>` +
    `Os dados assinados estão abaixo. <b>Compare com o PDF recebido</b>: data, tipo e valores devem ser iguais (total ${fmtValor(total(r))}).`, 'ok');
}
$('#btnVerificar').onclick = () => $('#arqPDF').click();
$('#arqPDF').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) { location.hash = ''; await verificarPDF(await f.arrayBuffer()); }
};
async function pdfCompartilhado() {
  // Android: PDF compartilhado para o app (ex.: do WhatsApp) é verificado automaticamente
  try {
    const c = await caches.open('s24-compartilhado'), resp = await c.match('compartilhado.pdf');
    await c.delete('compartilhado.pdf');
    return resp ? await resp.arrayBuffer() : null;
  } catch { return null; }
}
async function baixarPDF() {
  let file; try { file = await arquivoPDF(); } catch (e) { return status(e.message, 'erro'); }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  status('PDF baixado (pasta Downloads; no iPhone/iPad, em Arquivos → Downloads). Depois de enviá-lo, toque em "Marcar como enviado".');
}
async function arquivoPDF() {
  return new File([await gerarPDF()], nomeArq(R), { type: 'application/pdf' });
}
async function compartilharPDF() {
  let file; try { file = await arquivoPDF(); } catch (e) { return status(e.message, 'erro'); }
  const nome = file.name;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Recibo S-24' }); marcarEnviado(R.id); render(); status('PDF compartilhado.', 'ok'); return; }
    catch (e) { if (e.name === 'AbortError') return status('Envio não concluído. O recibo continua na lista "Aguardando envio".'); }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  status('PDF baixado. Depois de enviá-lo pelo WhatsApp, toque em "Marcar como enviado".');
}

/* ---------- início ---------- */
async function mostrarEu() { const id = await identidade(); $('#btnEu').textContent = id.nome ? `👤 ${id.nome}` : 'Definir meu nome'; }
$('#btnEu').onclick = () => garantirNome(true);

/* aviso de instalação (some quando o app já está instalado) */
(function avisoInstalar() {
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (instalado || store.get('semAvisoInstalar')) return;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const box = $('#instalar');
  $('#instalarTxt').innerHTML = ios
    ? 'Toque em <b>Compartilhar</b> (quadrado com seta ↑) e depois em <b>Adicionar à Tela de Início</b>.'
    : 'Toque no menu <b>⋮</b> do navegador e depois em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).';
  let evt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); evt = e; $('#btnInstalar').hidden = false; });
  $('#btnInstalar').onclick = async () => { if (!evt) return; evt.prompt(); const r = await evt.userChoice; if (r.outcome === 'accepted') box.hidden = true; };
  $('#btnFecharInst').onclick = () => { box.hidden = true; store.set('semAvisoInstalar', true); };
  box.hidden = false;
})();
window.addEventListener('resize', ajustarEscala);

async function iniciar() {
  status('');
  if (!window.isSecureContext || !crypto.subtle) return status('Abra o app por HTTPS para usar as assinaturas digitais.', 'erro');
  mostrarEu();
  if (new URLSearchParams(location.search).has('verificar')) {
    history.replaceState(null, '', location.pathname);
    const b = await pdfCompartilhado();
    if (b) return verificarPDF(b);
  }
  const p = new URLSearchParams(location.hash.slice(1)).get('r');
  if (p) return abrirLink(p);
  const pend = store.get('pendente');
  if (pend && !store.get('cancelados', []).includes(pend.id) && confirm('Há um recibo assinado por você aguardando conferência. Abri-lo?')) {
    R = pend; modo = 'aguardando'; mostrarQR(); render();
    return status('Aguardando conferência por outra pessoa, em outro aparelho.');
  }
  store.del('pendente');
  limparValidados();
  R = novoRecibo(); modo = 'novo'; render();
}
window.addEventListener('hashchange', iniciar);
iniciar();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
