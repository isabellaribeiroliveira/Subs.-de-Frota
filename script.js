/* =========================================================
   CONFIGURAÇÃO — a única linha que você precisa editar:
   cole em API_URL o endereço do Web App (termina com /exec).
   ========================================================= */
'use strict';
const CFG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwk3FWBFRRrnY2PFUvUZxp-_T_KRw7K9C9bHN5jnK85_cAqtoickmjDh3nRvZ0MdeYD_w/exec',
  REFRESH_MS: 45000,     // atualização automática dos dados (ms)
  MAX_ANEXO_MB: 6,       // tamanho máximo de cada anexo
  MAX_ANEXOS: 5          // anexos por ocorrência
};

/* ---------- Comunicação com o backend ---------- */
/* Comunicação com o backend (Google Apps Script) + sessão local */
(function () {
  const KEY = 'univale_auth_v2';

  const Auth = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} },
    clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  };

  async function call(action, payload, opts) {
    if (!CFG.API_URL) return { ok: false, code: 'NO_API', message: 'O aplicativo ainda não foi conectado à planilha.' };
    const auth = Auth.get();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 45000);
    try {
      const res = await fetch(CFG.API_URL, {
        method: 'POST',
        // text/plain evita o "preflight" CORS, que o Apps Script não responde
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action, token: auth && auth.token }, payload || {})),
        signal: ctrl.signal,
        redirect: 'follow'
      });
      const text = await res.text();
      try { return JSON.parse(text); }
      catch (e) { return { ok: false, code: 'BAD_RESPONSE', message: 'Resposta inesperada do servidor. Verifique a URL em config.js.' }; }
    } catch (e) {
      return { ok: false, code: 'NETWORK', network: true,
        message: e && e.name === 'AbortError' ? 'O servidor demorou demais para responder.' : 'Sem conexão com a internet.' };
    } finally { clearTimeout(timer); }
  }

  window.UnivaleAPI = { call: call, Auth: Auth };
})();

/* =========================================================
   UNIVALE · Ocorrências — núcleo do app + fluxo do colaborador
   (a área da Qualidade fica em qualidade.js)
   ========================================================= */

const API = window.UnivaleAPI;

/* ------------------------- Constantes ------------------------- */
const MOTIVOS = [
  { v: 'Falha mecânica', e: '⚙️' }, { v: 'Falha elétrica', e: '⚡' }, { v: 'Pneu', e: '🛞' },
  { v: 'Ar-condicionado', e: '❄️' }, { v: 'Carroceria', e: '🔧' }, { v: 'Combustível', e: '⛽' },
  { v: 'Sistema/equipamento', e: '💻' }, { v: 'Outro', e: '➕' }
];
const TIPOS_IMPACTO = ['Atraso', 'Horário não cumprido', 'Viagem interrompida', 'Outro'];
const TIPOS_REMOCAO = ['Reboque', 'Guincho', 'Outro'];

const STATUS = {
  aguardando_lancamento: { qa: 'Aguardando nº do socorro', colab: 'Aguardando análise', tone: 'amber' },
  em_analise:            { qa: 'Em análise',               colab: 'Em análise',         tone: 'blue' },
  correcao_solicitada:   { qa: 'Correção solicitada',      colab: 'Correção solicitada', tone: 'orange' },
  validada:              { qa: 'Validada',                 colab: 'Validada',           tone: 'green' },
  encerrada:             { qa: 'Encerrada',                colab: 'Encerrada',          tone: 'gray' }
};
const CONCLUIDAS = ['validada', 'encerrada'];

/* ------------------------- Estado ------------------------- */
const state = {
  boot: 'loading',            // loading | setup | login | app
  user: null,
  listas: { setores: [], linhas: [], veiculos: [], motoristas: [] },
  occs: [], lastSync: 0, syncing: false,
  route: 'home',              // colaborador: home | wizard | minhas | success
  minhasFiltro: 'todas',
  wiz: null, success: null, sheet: null, modal: null,
  outbox: [], draftInfo: null, loginError: '', loginBusy: false, busy: false,
  qa: {
    view: 'dashboard', detail: null, showFilters: false, limit: 100,
    f: { q: '', from: '', to: '', status: '', setor: '', linha: '', motivo: '', impacto: '', subst: '' },
    rel: { from: '', to: '' }, drafts: { socorro: '', obs: '', correcao: '' }, draftFor: null
  }
};

/* ------------------------- Utilitários ------------------------- */
function esc(v) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const p2 = n => String(n).padStart(2, '0');
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
function nowHM() { const d = new Date(); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; }
function fmtDate(iso) { if (!iso) return '—'; const p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso; }
function fmtDT(iso) {
  if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return iso;
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime(); if (isNaN(ms)) return '';
  const m = Math.floor(ms / 60000); if (m < 1) return 'agora'; if (m < 60) return m + ' min';
  const h = Math.floor(m / 60); if (h < 24) return h + ' h'; return Math.floor(h / 24) + ' d';
}
function initials(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function uuid() { try { return crypto.randomUUID(); } catch (e) { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); } }
function lsGet(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
function yn(v) { return v === 'sim' ? 'Sim' : v === 'nao' ? 'Não' : '—'; }
function motivoEmoji(v) { const m = MOTIVOS.find(x => x.v === v); return m ? m.e : '•'; }
function statusLabel(s, qa) { const m = STATUS[s]; return m ? (qa ? m.qa : m.colab) : s; }
const SHORT = { aguardando_lancamento: 'Aguardando', em_analise: 'Em análise', correcao_solicitada: 'Corrigir', validada: 'Validada', encerrada: 'Encerrada' };
function pillShort(s) { const m = STATUS[s] || { tone: 'gray' }; return `<span class="pill tone-${m.tone}"><i></i>${esc(SHORT[s] || s)}</span>`; }
function pill(s, qa) { const m = STATUS[s] || { tone: 'gray' }; return `<span class="pill tone-${m.tone}"><i></i>${esc(statusLabel(s, qa))}</span>`; }
function isQA() { return state.user && state.user.perfil === 'qualidade'; }
function findOcc(p) { return state.occs.find(o => o.protocolo === p); }
function upsertOcc(o) {
  const i = state.occs.findIndex(x => x.protocolo === o.protocolo);
  if (i >= 0) state.occs[i] = o; else state.occs.unshift(o);
  saveCache();
}
function sortRecent(list) { return list.slice().sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em))); }

function toast(msg, type) {
  const layer = document.getElementById('toast-layer'); if (!layer) return;
  const el = document.createElement('div'); el.className = 'toast ' + (type || 'ok'); el.textContent = msg;
  layer.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 4800 : 3000);
}

/* ------------------------- Cache local ------------------------- */
const cacheKey = () => 'univale_cache_v2_' + (state.user ? state.user.matricula : '');
function saveCache() { if (state.user) lsSet(cacheKey(), { occs: state.occs, listas: state.listas, at: Date.now() }); }
function loadCache() {
  const c = lsGet(cacheKey(), null);
  if (c) { state.occs = c.occs || []; state.listas = c.listas || state.listas; state.lastSync = c.at || 0; }
}

/* =========================================================
   FLUXO DE PERGUNTAS (colaborador)
   Cada tela faz uma pergunta; telas condicionais só aparecem
   quando a resposta anterior pede.
   ========================================================= */
const FLOW = [
  { id: 'veic_mot', sec: 'Identificação', type: 'fields', title: 'Qual é o veículo e quem estava dirigindo?', sub: 'Digite ou escolha na lista.',
    fields: [
      { k: 'veiculo', label: 'Veículo', kind: 'combo', list: 'veiculos', ph: 'Ex.: 1234' },
      { k: 'motorista', label: 'Motorista', kind: 'combo', list: 'motoristas', ph: 'Nome do motorista' }] },
  { id: 'setor_linha', sec: 'Identificação', type: 'fields', title: 'Qual é o setor e a linha?',
    fields: [
      { k: 'setor', label: 'Setor', kind: 'pills', list: 'setores', ph: 'Ex.: Fretamento' },
      { k: 'linha', label: 'Linha', kind: 'combo', list: 'linhas', ph: 'Ex.: 501 - Centro / Bairro' }] },
  { id: 'quando', sec: 'Identificação', type: 'fields', title: 'Quando aconteceu?', sub: 'Já preenchemos com a data e a hora de agora. Ajuste se foi antes.',
    fields: [{ k: 'data', label: 'Data', kind: 'date' }, { k: 'hora', label: 'Horário', kind: 'time' }] },
  { id: 'onde', sec: 'Identificação', type: 'fields', title: 'Onde aconteceu?',
    fields: [
      { k: 'cidade', label: 'Cidade', kind: 'text', ph: 'Ex.: Belo Horizonte' },
      { k: 'bairro', label: 'Bairro', kind: 'text', ph: 'Ex.: Centro' },
      { k: 'local_especifico', label: 'Rua / local específico', kind: 'text', ph: 'Ex.: Rua das Flores, 123' }] },

  { id: 'passageiros', sec: 'Impacto', type: 'yn', k: 'possui_passageiros', title: 'Havia passageiros no interior do veículo no momento da falha?' },
  { id: 'baldeio', sec: 'Impacto', type: 'yn', k: 'houve_baldeio', title: 'Houve necessidade de baldeio?',
    sub: 'Baldeio é a transferência dos passageiros para outro veículo.', when: d => d.possui_passageiros === 'sim' },
  { id: 'horario', sec: 'Impacto', type: 'yn', k: 'houve_impacto_horario', title: 'A ocorrência causou atraso ou impediu o cumprimento do horário programado?' },
  { id: 'tipo_impacto', sec: 'Impacto', type: 'choice', k: 'tipo_impacto', title: 'Qual foi o impacto?', options: TIPOS_IMPACTO, when: d => d.houve_impacto_horario === 'sim' },
  { id: 'desc_impacto', sec: 'Impacto', type: 'fields', title: 'Descreva o impacto', when: d => d.tipo_impacto === 'Outro',
    fields: [{ k: 'descricao_impacto', label: 'O que aconteceu?', kind: 'area', ph: 'Descreva aqui' }] },

  { id: 'substituicao', sec: 'Substituição', type: 'yn', k: 'houve_substituicao', title: 'Foi necessária a substituição do veículo?' },
  { id: 'fora_apoio', sec: 'Substituição', type: 'yn', k: 'substituicao_fora_ponto_apoio', title: 'A substituição ocorreu fora do ponto de apoio?', when: d => d.houve_substituicao === 'sim' },
  { id: 'substituto', sec: 'Substituição', type: 'fields', title: 'Qual veículo e qual motorista assumiram?', when: d => d.houve_substituicao === 'sim',
    fields: [
      { k: 'veiculo_substituto', label: 'Veículo substituto', kind: 'combo', list: 'veiculos', ph: 'Ex.: 5678' },
      { k: 'motorista_substituto', label: 'Motorista substituto', kind: 'combo', list: 'motoristas', ph: 'Nome do motorista' }] },
  { id: 'local_subst', sec: 'Substituição', type: 'fields', title: 'Onde foi feita a substituição?', when: d => d.substituicao_fora_ponto_apoio === 'sim',
    fields: [
      { k: 'local_substituicao', label: 'Local da substituição', kind: 'text', ph: 'Ex.: Av. Central, 500' },
      { k: 'detalhamento_substituicao', label: 'Detalhar o local (opcional)', kind: 'area', optional: true, ph: 'Pontos de referência, condição da via...' }] },

  { id: 'manut', sec: 'Manutenção', type: 'yn', k: 'manutencao_acionada', title: 'A equipe de Manutenção foi acionada para atendimento no local da ocorrência?' },
  { id: 'manut_desloc', sec: 'Manutenção', type: 'yn', k: 'manutencao_deslocou', title: 'Houve deslocamento da equipe até o veículo?', when: d => d.manutencao_acionada === 'sim' },

  { id: 'retorno', sec: 'Retorno', type: 'yn', k: 'retorno_proprio', title: 'O veículo conseguiu retornar por meios próprios?' },
  { id: 'remocao', sec: 'Retorno', type: 'yn', k: 'houve_remocao', title: 'Foi necessária remoção/reboque?', when: d => d.retorno_proprio === 'nao' },
  { id: 'tipo_remocao', sec: 'Retorno', type: 'choice', k: 'tipo_remocao', title: 'Qual o tipo de remoção?', options: TIPOS_REMOCAO, when: d => d.houve_remocao === 'sim' },

  { id: 'motivo', sec: 'Motivo', type: 'motivo', k: 'motivo', title: 'Qual foi o motivo da ocorrência?' },
  { id: 'motivo_outro', sec: 'Motivo', type: 'fields', title: 'Descreva o motivo', when: d => d.motivo === 'Outro',
    fields: [{ k: 'descricao_motivo', label: 'Qual foi o motivo?', kind: 'area', ph: 'Descreva aqui' }] },

  { id: 'obs', sec: 'Fechamento', type: 'obs', title: 'Há alguma informação complementar?', sub: 'Opcional. Você pode anexar fotos ou arquivos.' },
  { id: 'review', sec: 'Fechamento', type: 'review', title: 'Confira sua ocorrência', sub: 'Se estiver tudo certo, é só enviar.' }
];

const FORM_KEYS = ['data', 'hora', 'veiculo', 'setor', 'linha', 'motorista', 'cidade', 'bairro', 'local_especifico',
  'possui_passageiros', 'houve_baldeio', 'houve_impacto_horario', 'tipo_impacto', 'descricao_impacto',
  'houve_substituicao', 'substituicao_fora_ponto_apoio', 'local_substituicao', 'detalhamento_substituicao',
  'veiculo_substituto', 'motorista_substituto', 'manutencao_acionada', 'manutencao_deslocou',
  'retorno_proprio', 'houve_remocao', 'tipo_remocao', 'motivo', 'descricao_motivo', 'observacoes'];

function blankData() {
  const d = {}; FORM_KEYS.forEach(k => d[k] = '');
  d.data = todayISO(); d.hora = nowHM();
  d.setor = (state.user && state.user.setor) || '';
  d.cidade = lsGet('univale_last_cidade', '') || '';
  return d;
}
function screenKeys(s) { return s.type === 'fields' ? s.fields.map(f => f.k) : s.type === 'obs' ? ['observacoes'] : s.k ? [s.k] : []; }
function visibleFlow(d) { return FLOW.filter(s => !s.when || s.when(d)); }
function pruneHidden(d) { FLOW.forEach(s => { if (s.when && !s.when(d)) screenKeys(s).forEach(k => { d[k] = ''; }); }); }

function screenError(s, d) {
  if (s.type === 'fields') {
    for (const f of s.fields) {
      if (f.optional) continue;
      if (!String(d[f.k] || '').trim()) return `Preencha: ${f.label}.`;
    }
    if (s.id === 'quando') {
      if (d.data > todayISO()) return 'A data não pode ser no futuro.';
      if (d.data === todayISO() && d.hora > nowHM()) return 'O horário não pode ser no futuro.';
    }
    return '';
  }
  if (['yn', 'choice', 'motivo'].includes(s.type) && !d[s.k]) return 'Escolha uma opção para continuar.';
  return '';
}
function firstIncompleteFrom(vis, startIdx, d) {
  for (let i = startIdx; i < vis.length; i++) { if (vis[i].type !== 'review' && screenError(vis[i], d)) return vis[i].id; }
  return null;
}

/* ------------------------- Rascunho ------------------------- */
const draftKey = () => 'univale_draft_v2_' + (state.user ? state.user.matricula : '');
let draftTimer = null;
function saveDraft() {
  if (!state.wiz || state.wiz.editing) return;
  lsSet(draftKey(), { data: state.wiz.data, current: state.wiz.current, at: Date.now() });
}
function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 500); }
function refreshDraftInfo() { state.draftInfo = lsGet(draftKey(), null); }
function clearDraft() { lsDel(draftKey()); state.draftInfo = null; }

/* ------------------------- Controle do assistente ------------------------- */
function startWizard(opts) {
  opts = opts || {};
  const data = opts.data || blankData();
  state.wiz = { data: data, current: opts.current || FLOW[0].id, editing: opts.editing || null, returnToReview: false,
    dir: 'fwd', sending: false, anexos: [], anexosExistentes: opts.anexosExistentes || [], token: 0 };
  state.route = 'wizard'; state.sheet = null; state.modal = null;
  render();
}
function wizGo(id, dir) { state.wiz.current = id; state.wiz.dir = dir || 'fwd'; state.wiz.token++; saveDraft(); render(); window.scrollTo && window.scrollTo(0, 0); }
function wizNext(fromAuto) {
  const w = state.wiz; if (!w) return;
  const vis = visibleFlow(w.data); const idx = vis.findIndex(s => s.id === w.current); const scr = vis[idx];
  const err = scr ? screenError(scr, w.data) : '';
  if (err) { if (!fromAuto) toast(err, 'error'); return; }
  if (w.returnToReview) {
    const pend = firstIncompleteFrom(vis, idx + 1, w.data);
    return wizGo(pend || 'review');
  }
  const next = vis[idx + 1]; if (next) wizGo(next.id);
}
function wizBack() {
  const w = state.wiz; const vis = visibleFlow(w.data); const idx = vis.findIndex(s => s.id === w.current);
  if (idx <= 0) return wizExit();
  w.returnToReview = false; wizGo(vis[idx - 1].id, 'back');
}
function wizExit() {
  saveDraft(); state.wiz = null; state.route = 'home'; refreshDraftInfo(); render();
}
function setAnswer(k, v, auto) {
  const w = state.wiz; if (!w || w.sending) return;
  w.data[k] = v; pruneHidden(w.data); saveDraft();
  const tk = ++w.token; render();
  if (auto) setTimeout(() => { if (state.wiz && state.wiz.token === tk) wizNext(true); }, 260);
}

/* ------------------------- Seções (revisão e detalhe) ------------------------- */
function sections(o) {
  const rows = (arr) => arr.filter(r => r[1] !== '' && r[1] !== undefined && r[1] !== null);
  const local = [o.cidade, o.bairro, o.local_especifico].filter(Boolean).join(' · ');
  const out = [
    { t: 'Identificação', step: 'veic_mot', rows: rows([['Veículo', o.veiculo], ['Motorista', o.motorista], ['Setor', o.setor], ['Linha', o.linha],
      ['Quando', fmtDate(o.data) + ' às ' + o.hora], ['Local', local]]) },
    { t: 'Impacto', step: 'passageiros', rows: rows([['Passageiros no veículo', yn(o.possui_passageiros)],
      o.possui_passageiros === 'sim' ? ['Baldeio', yn(o.houve_baldeio)] : ['', ''],
      ['Impacto no horário', yn(o.houve_impacto_horario)],
      o.houve_impacto_horario === 'sim' ? ['Tipo de impacto', o.tipo_impacto] : ['', ''],
      o.tipo_impacto === 'Outro' ? ['Descrição', o.descricao_impacto] : ['', '']]) },
    { t: 'Substituição', step: 'substituicao', rows: rows([['Substituição do veículo', yn(o.houve_substituicao)],
      o.houve_substituicao === 'sim' ? ['Fora do ponto de apoio', yn(o.substituicao_fora_ponto_apoio)] : ['', ''],
      o.houve_substituicao === 'sim' ? ['Veículo substituto', o.veiculo_substituto] : ['', ''],
      o.houve_substituicao === 'sim' ? ['Motorista substituto', o.motorista_substituto] : ['', ''],
      o.substituicao_fora_ponto_apoio === 'sim' ? ['Local da substituição', o.local_substituicao] : ['', ''],
      o.substituicao_fora_ponto_apoio === 'sim' ? ['Detalhes do local', o.detalhamento_substituicao] : ['', '']]) },
    { t: 'Manutenção', step: 'manut', rows: rows([['Equipe acionada', yn(o.manutencao_acionada)],
      o.manutencao_acionada === 'sim' ? ['Deslocou até o veículo', yn(o.manutencao_deslocou)] : ['', '']]) },
    { t: 'Retorno', step: 'retorno', rows: rows([['Retorno por meios próprios', yn(o.retorno_proprio)],
      o.retorno_proprio === 'nao' ? ['Remoção / reboque', yn(o.houve_remocao)] : ['', ''],
      o.houve_remocao === 'sim' ? ['Tipo de remoção', o.tipo_remocao] : ['', '']]) },
    { t: 'Motivo', step: 'motivo', rows: rows([['Motivo', o.motivo ? motivoEmoji(o.motivo) + ' ' + o.motivo : ''],
      o.motivo === 'Outro' ? ['Descrição', o.descricao_motivo] : ['', '']]) },
    { t: 'Observações', step: 'obs', rows: rows([['Observações', o.observacoes || 'Nenhuma']]) }
  ];
  return out;
}
function rowsHtml(rows) { return rows.map(r => `<div class="kv"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join(''); }

/* =========================================================
   TELAS
   ========================================================= */
const SWOOSH = '<span class="swoosh" aria-hidden="true"></span>';
const LOGO = '<span class="logo" role="img" aria-label="Univale"></span>';

function renderSetup() {
  return `<main class="center-screen">${SWOOSH}
    <section class="card auth-card"><div class="auth-logo">${LOGO}</div>
      <h1>Falta conectar à planilha</h1>
      <p class="muted">O aplicativo está pronto, mas ainda não sabe onde guardar as ocorrências.</p>
      <ol class="steps">
        <li>Siga o passo a passo do arquivo <b>SETUP.md</b> (cerca de 10 minutos).</li>
        <li>Copie a URL do Web App gerada (termina com <code>/exec</code>).</li>
        <li>Cole em <code>API_URL</code> no arquivo <code>config.js</code> e publique de novo.</li>
      </ol></section></main>`;
}
function renderLoading() { return `<main class="center-screen">${SWOOSH}<div class="loader-wrap">${LOGO}<div class="spinner"></div><p class="muted">Carregando…</p></div></main>`; }

function renderLogin() {
  const last = lsGet('univale_last_matricula', '') || '';
  return `<main class="center-screen">${SWOOSH}
    <section class="card auth-card">
      <div class="auth-logo">${LOGO}</div>
      <h1>Registro de Ocorrências</h1>
      <p class="muted">Entre com sua matrícula e seu PIN.</p>
      <label class="lbl" for="lg-m">Matrícula</label>
      <input id="lg-m" class="inp" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(last)}" placeholder="Sua matrícula" />
      <label class="lbl" for="lg-p">PIN</label>
      <div class="pin-wrap"><input id="lg-p" class="inp" type="password" inputmode="numeric" autocomplete="current-password" placeholder="••••" />
        <button type="button" class="eye" data-action="togglePin" aria-label="Mostrar PIN">👁</button></div>
      ${state.loginError ? `<div class="alert err" role="alert">${esc(state.loginError)}</div>` : ''}
      <button class="btn btn-primary btn-lg btn-block" data-action="login" ${state.loginBusy ? 'disabled' : ''}>${state.loginBusy ? '<span class="spinner sm"></span> Entrando…' : 'Entrar'}</button>
      <p class="tiny muted center">Esqueceu o PIN? Procure a Qualidade.</p>
    </section></main>`;
}

/* ---------- Colaborador: início ---------- */
function myOccs() { return sortRecent(state.occs); }
function pendingOutbox() { return state.outbox.filter(x => state.user && x.matricula === state.user.matricula); }

function tabbar(active) {
  return `<nav class="tabbar" aria-label="Navegação">
    <button class="tab ${active === 'home' ? 'on' : ''}" data-action="goHome"><span class="ti">🏠</span>Início</button>
    <button class="tab fab" data-action="novaOcorrencia" aria-label="Nova ocorrência"><span>+</span></button>
    <button class="tab ${active === 'minhas' ? 'on' : ''}" data-action="goMinhas"><span class="ti">📋</span>Minhas</button>
  </nav>`;
}
function topbar() {
  return `<header class="topbar">${LOGO}
    <button class="avatar-btn" data-action="openPerfil" aria-label="Perfil e sair">${esc(initials(state.user.nome))}</button></header>`;
}
function occItem(o) {
  return `<button class="occ" data-action="openSheet" data-id="${esc(o.protocolo)}">
    <span class="occ-ic">${motivoEmoji(o.motivo)}</span>
    <span class="occ-main"><b>${esc(o.protocolo)}</b><small>Veículo ${esc(o.veiculo)} · ${fmtDate(o.data)} ${esc(o.hora)}</small></span>
    ${pillShort(o.status)}</button>`;
}
function outboxItem(x) {
  return `<div class="occ pending"><span class="occ-ic">📤</span><span class="occ-main"><b>${x.erro ? 'Não foi possível enviar' : 'Aguardando envio'}</b>
    <small>Veículo ${esc(x.dados.veiculo)} · ${fmtDate(x.dados.data)} ${esc(x.dados.hora)}${x.erro ? ' · ' + esc(x.erro) : ''}</small></span>
    ${x.erro ? `<button class="btn btn-ghost btn-sm" data-action="dropOutbox" data-id="${esc(x.client_id)}">Descartar</button>` : '<span class="pill tone-amber"><i></i>Sem sinal</span>'}</div>`;
}
function renderHome() {
  const mine = myOccs();
  const andamento = mine.filter(o => ['aguardando_lancamento', 'em_analise'].includes(o.status)).length;
  const corrigir = mine.filter(o => o.status === 'correcao_solicitada');
  const ok = mine.filter(o => CONCLUIDAS.includes(o.status)).length;
  const ob = pendingOutbox();
  const d = state.draftInfo;
  return `<div class="app colab">${topbar()}
    <main class="content">
      <section class="hero card">${SWOOSH}
        <p class="eyebrow">Olá, ${esc(state.user.nome.split(' ')[0])}</p>
        <h1>Aconteceu algo com um veículo?</h1>
        <p class="muted">Registre em poucos toques. Só perguntamos o que é necessário.</p>
        <button class="btn btn-primary btn-lg" data-action="novaOcorrencia">＋ Nova ocorrência</button>
      </section>
      ${d ? `<section class="banner info"><div><b>Registro em andamento</b><small>Você parou no meio de uma ocorrência (${esc(d.data.veiculo || 'sem veículo')}).</small></div>
        <div class="banner-actions"><button class="btn btn-ghost btn-sm" data-action="discardDraft">Descartar</button><button class="btn btn-primary btn-sm" data-action="resumeDraft">Continuar</button></div></section>` : ''}
      ${corrigir.length ? `<section class="banner warn"><div><b>${corrigir.length === 1 ? '1 ocorrência precisa de correção' : corrigir.length + ' ocorrências precisam de correção'}</b>
        <small>A Qualidade pediu um ajuste.</small></div><button class="btn btn-primary btn-sm" data-action="openSheet" data-id="${esc(corrigir[0].protocolo)}">Ver</button></section>` : ''}
      <section class="tiles">
        <div class="tile"><b>${andamento}</b><span>Em andamento</span></div>
        <div class="tile ${corrigir.length ? 'alert' : ''}"><b>${corrigir.length}</b><span>Para corrigir</span></div>
        <div class="tile"><b>${ok}</b><span>Concluídas</span></div>
      </section>
      <h2 class="sec-title">Últimas ocorrências <button class="link" data-action="goMinhas">Ver todas</button></h2>
      <div class="list">${ob.map(outboxItem).join('')}${mine.slice(0, 5).map(occItem).join('') || (ob.length ? '' : '<div class="empty"><span>📋</span>Você ainda não registrou nenhuma ocorrência.</div>')}</div>
    </main>${tabbar('home')}</div>`;
}

function renderMinhas() {
  const f = state.minhasFiltro; let list = myOccs();
  if (f === 'andamento') list = list.filter(o => ['aguardando_lancamento', 'em_analise'].includes(o.status));
  if (f === 'corrigir') list = list.filter(o => o.status === 'correcao_solicitada');
  if (f === 'concluidas') list = list.filter(o => CONCLUIDAS.includes(o.status));
  const chip = (id, t) => `<button class="chip ${f === id ? 'on' : ''}" data-action="setMinhasFiltro" data-v="${id}">${t}</button>`;
  return `<div class="app colab">${topbar()}
    <main class="content"><h1 class="page-title">Minhas ocorrências</h1>
      <div class="chips">${chip('todas', 'Todas')}${chip('andamento', 'Em andamento')}${chip('corrigir', 'Para corrigir')}${chip('concluidas', 'Concluídas')}</div>
      <div class="list">${pendingOutbox().map(outboxItem).join('')}${list.map(occItem).join('') || '<div class="empty"><span>🔎</span>Nenhuma ocorrência aqui.</div>'}</div>
    </main>${tabbar('minhas')}</div>`;
}

/* ---------- Colaborador: assistente ---------- */
function datalists() {
  return ['veiculos', 'motoristas', 'linhas'].map(k => `<datalist id="dl-${k}">${(state.listas[k] || []).map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist>`).join('');
}
function fieldHtml(f, d) {
  const v = d[f.k] || '';
  const lbl = `<label class="lbl" for="f-${f.k}">${esc(f.label)}</label>`;
  if (f.kind === 'pills') {
    const list = state.listas[f.list] || [];
    if (list.length) return `<div class="field">${lbl.replace(/ for="[^"]*"/, '')}<div class="pills">${list.map(x => `<button type="button" class="pillbtn ${v === x ? 'on' : ''}" data-action="pick" data-k="${f.k}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`;
    return `<div class="field">${lbl}<input id="f-${f.k}" class="inp" data-bind="${f.k}" value="${esc(v)}" placeholder="${esc(f.ph || '')}" autocomplete="off" /></div>`;
  }
  if (f.kind === 'area') return `<div class="field">${lbl}<textarea id="f-${f.k}" class="inp area" data-bind="${f.k}" placeholder="${esc(f.ph || '')}" rows="4">${esc(v)}</textarea></div>`;
  if (f.kind === 'date') return `<div class="field">${lbl}<input id="f-${f.k}" class="inp" type="date" data-bind="${f.k}" value="${esc(v)}" max="${todayISO()}" /></div>`;
  if (f.kind === 'time') return `<div class="field">${lbl}<input id="f-${f.k}" class="inp" type="time" data-bind="${f.k}" value="${esc(v)}" /></div>`;
  const list = f.kind === 'combo' ? ` list="dl-${f.list}"` : '';
  return `<div class="field">${lbl}<input id="f-${f.k}" class="inp" data-bind="${f.k}" value="${esc(v)}" placeholder="${esc(f.ph || '')}" autocomplete="off"${list} /></div>`;
}
function renderWizard() {
  const w = state.wiz; const vis = visibleFlow(w.data);
  let idx = vis.findIndex(s => s.id === w.current); if (idx < 0) { idx = 0; w.current = vis[0].id; }
  const s = vis[idx]; const d = w.data; const pct = Math.max(4, Math.round((idx / (vis.length - 1)) * 100));
  let body = '', footer = '';
  const answered = s.k && d[s.k];
  if (s.type === 'fields') {
    body = s.fields.map(f => fieldHtml(f, d)).join('');
    if (s.id === 'quando') body += `<button type="button" class="link" data-action="setNow">Usar data e hora de agora</button>`;
    footer = `<button class="btn btn-primary btn-lg btn-block" data-action="wizNext">Continuar</button>`;
  } else if (s.type === 'yn') {
    body = `<div class="yn"><button class="ynb yes ${d[s.k] === 'sim' ? 'on' : ''}" data-action="answer" data-k="${s.k}" data-v="sim"><span>✓</span>Sim</button>
      <button class="ynb no ${d[s.k] === 'nao' ? 'on' : ''}" data-action="answer" data-k="${s.k}" data-v="nao"><span>✕</span>Não</button></div>`;
    if (answered) footer = `<button class="btn btn-primary btn-lg btn-block" data-action="wizNext">Continuar</button>`;
  } else if (s.type === 'choice') {
    body = `<div class="choices">${s.options.map(o => `<button class="choice ${d[s.k] === o ? 'on' : ''}" data-action="answer" data-k="${s.k}" data-v="${esc(o)}"><i></i>${esc(o)}</button>`).join('')}</div>`;
    if (answered) footer = `<button class="btn btn-primary btn-lg btn-block" data-action="wizNext">Continuar</button>`;
  } else if (s.type === 'motivo') {
    body = `<div class="motivos">${MOTIVOS.map(m => `<button class="motivo ${d.motivo === m.v ? 'on' : ''}" data-action="answer" data-k="motivo" data-v="${esc(m.v)}"><span>${m.e}</span>${esc(m.v)}</button>`).join('')}</div>`;
    if (answered) footer = `<button class="btn btn-primary btn-lg btn-block" data-action="wizNext">Continuar</button>`;
  } else if (s.type === 'obs') {
    const chips = w.anexos.map((a, i) => `<span class="file-chip">${a.tipo && a.tipo.startsWith('image') ? '🖼' : '📎'} ${esc(a.nome)}<button data-action="rmAnexo" data-i="${i}" aria-label="Remover">✕</button></span>`).join('');
    const old = w.anexosExistentes.map(a => `<a class="file-chip" href="${esc(a.url)}" target="_blank" rel="noopener">📎 ${esc(a.nome)}</a>`).join('');
    body = `<div class="field"><textarea id="f-observacoes" class="inp area" data-bind="observacoes" rows="5" placeholder="Informe outras informações relevantes sobre a ocorrência.">${esc(d.observacoes)}</textarea></div>
      <div class="attach"><button type="button" class="attach-btn" data-action="pickFoto"><span>📷</span>Adicionar foto</button>
      <button type="button" class="attach-btn" data-action="pickDoc"><span>📎</span>Adicionar arquivo</button></div>
      <div class="file-chips">${old}${chips}</div><p class="tiny muted">Até ${CFG.MAX_ANEXOS || 5} anexos de ${CFG.MAX_ANEXO_MB || 6} MB. Fotos são reduzidas automaticamente.</p>`;
    footer = `<button class="btn btn-primary btn-lg btn-block" data-action="wizNext">Revisar</button>`;
  } else if (s.type === 'review') {
    body = sections(d).map(sec => `<section class="rv"><header><h3>${sec.t}</h3><button class="link" data-action="editStep" data-id="${sec.step}">Editar</button></header>${rowsHtml(sec.rows)}${w.anexos.length && sec.t === 'Observações' ? `<div class="kv"><span>Anexos</span><b>${w.anexos.length} arquivo(s)</b></div>` : ''}</section>`).join('');
    footer = `<button class="btn btn-primary btn-lg btn-block" data-action="submit" ${w.sending ? 'disabled' : ''}>${w.sending ? '<span class="spinner sm"></span> Enviando…' : (w.editing ? 'Reenviar correção' : 'Enviar ocorrência')}</button>`;
  }
  return `<div class="app wiz">
    <header class="wiz-top"><button class="icon-btn" data-action="wizBack" aria-label="Voltar">‹</button>
      <div class="wiz-meta"><span class="eyebrow">${esc(s.sec)}</span><small>Etapa ${idx + 1} de ${vis.length}</small></div>
      <button class="icon-btn" data-action="wizExit" aria-label="Salvar e sair">✕</button></header>
    <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
    ${w.editing ? `<div class="edit-note">Corrigindo ${esc(w.editing)}</div>` : ''}
    <main class="wiz-body ${w.dir === 'back' ? 'in-back' : 'in-fwd'}" id="wiz-body"><h1 class="q">${esc(s.title)}</h1>${s.sub ? `<p class="muted q-sub">${esc(s.sub)}</p>` : ''}${body}</main>
    ${footer ? `<footer class="wiz-foot">${footer}</footer>` : ''}${datalists()}</div>`;
}

function renderSuccess() {
  const s = state.success || {};
  return `<main class="center-screen success">${SWOOSH}<section class="card auth-card">
    <div class="check ${s.pending ? 'pending' : ''}"><svg viewBox="0 0 24 24" fill="none"><path d="${s.pending ? 'M12 7v5l3 2' : 'M5 12.5l4.5 4.5L19 7.5'}" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <h1>${s.pending ? 'Salvo no aparelho' : s.edited ? 'Correção enviada!' : 'Ocorrência registrada!'}</h1>
    ${s.pending ? `<p class="muted">Sem conexão no momento. Sua ocorrência será enviada automaticamente assim que o sinal voltar. Não feche o aplicativo para apagar nada — ela está guardada.</p>`
      : `<div class="proto"><small>Protocolo</small><b>${esc(s.protocolo)}</b></div>
         <p class="muted">${s.edited ? 'A Qualidade foi avisada da correção.' : 'Sua ocorrência foi registrada e encaminhada para tratamento.'}</p>
         <div class="center">${pill(s.status || 'aguardando_lancamento', false)}</div>`}
    <div class="stack">
      ${!s.pending && s.protocolo ? `<button class="btn btn-primary btn-lg btn-block" data-action="openSheetAfter" data-id="${esc(s.protocolo)}">Ver ocorrência</button>` : ''}
      <button class="btn btn-ghost btn-lg btn-block" data-action="goMinhas">Minhas ocorrências</button>
      <button class="btn btn-ghost btn-lg btn-block" data-action="novaOcorrencia">Nova ocorrência</button>
      <button class="btn btn-text btn-block" data-action="goHome">Voltar ao início</button>
    </div></section></main>`;
}

/* ---------- Detalhe (colaborador: bottom sheet) ---------- */
function attachmentsHtml(o) {
  const a = o.anexos || []; if (!a.length) return '';
  return `<section class="rv"><header><h3>Anexos</h3></header><div class="file-chips pad">${a.map(x => `<a class="file-chip" href="${esc(x.url)}" target="_blank" rel="noopener">📎 ${esc(x.nome)}</a>`).join('')}</div></section>`;
}
function timelineHtml(o) {
  const h = o.historico || []; if (!h.length) return '';
  return `<section class="rv"><header><h3>Histórico</h3></header><ol class="timeline">${h.map(e => `<li><i></i><div><b>${esc(e.acao)}</b><small>${fmtDT(e.ts)} · ${esc(e.usuario)}</small></div></li>`).join('')}</ol></section>`;
}
function sheetHtml() {
  const o = findOcc(state.sheet); if (!o) return '';
  return `<div class="scrim" data-action="closeOverlay" data-self="1"><aside class="sheet" role="dialog" aria-label="Ocorrência ${esc(o.protocolo)}">
    <div class="grab"></div>
    <header class="sheet-head"><div><h2>${esc(o.protocolo)}</h2><small class="muted">${fmtDate(o.data)} às ${esc(o.hora)} · veículo ${esc(o.veiculo)}</small></div>
      <button class="icon-btn" data-action="closeOverlay" aria-label="Fechar">✕</button></header>
    <div class="sheet-body">
      <div class="row-between">${pill(o.status, false)}${o.numero_socorro ? `<span class="tiny muted">Nº do socorro <b>${esc(o.numero_socorro)}</b></span>` : ''}</div>
      ${o.status === 'correcao_solicitada' ? `<div class="alert warn"><b>A Qualidade pediu uma correção</b><p>${esc(o.correcao_mensagem)}</p>
        <button class="btn btn-primary btn-block" data-action="fixOcc" data-id="${esc(o.protocolo)}">Corrigir e reenviar</button></div>` : ''}
      ${sections(o).map(sec => `<section class="rv"><header><h3>${sec.t}</h3></header>${rowsHtml(sec.rows)}</section>`).join('')}
      ${attachmentsHtml(o)}${timelineHtml(o)}
    </div></aside></div>`;
}
function perfilHtml() {
  return `<div class="scrim center-modal" data-action="closeOverlay" data-self="1"><div class="modal">
    <div class="avatar-lg">${esc(initials(state.user.nome))}</div><h2>${esc(state.user.nome)}</h2>
    <p class="muted">Matrícula ${esc(state.user.matricula)} · ${isQA() ? 'Qualidade' : 'Colaborador'}</p>
    <div class="stack"><button class="btn btn-ghost btn-block" data-action="refreshNow">Atualizar dados</button>
    <button class="btn btn-danger btn-block" data-action="logout">Sair</button><button class="btn btn-text btn-block" data-action="closeOverlay">Fechar</button></div></div></div>`;
}

/* =========================================================
   RENDER PRINCIPAL
   ========================================================= */
function renderOverlays() {
  const layer = document.getElementById('overlay-layer'); if (!layer) return;
  let html = '';
  if (state.user && state.boot === 'app') {
    if (isQA()) html += (typeof qaOverlayHtml === 'function' ? qaOverlayHtml() : '');
    else if (state.sheet) html += sheetHtml();
    if (state.modal && state.modal.type === 'perfil') html += perfilHtml();
    if (state.modal && state.modal.type === 'confirm') html += confirmHtml();
  }
  layer.innerHTML = html;
  document.body.classList.toggle('no-scroll', !!html);
}
function confirmHtml() {
  const m = state.modal;
  return `<div class="scrim center-modal" data-action="closeModal" data-self="1"><div class="modal"><h2>${esc(m.title)}</h2><p class="muted">${esc(m.text)}</p>
    <div class="stack"><button class="btn ${m.danger ? 'btn-danger' : 'btn-primary'} btn-block" data-action="${esc(m.action)}" data-id="${esc(m.id || '')}">${esc(m.confirm)}</button>
    <button class="btn btn-ghost btn-block" data-action="closeModal">Cancelar</button></div></div></div>`;
}
function render() {
  const root = document.getElementById('root'); if (!root) return;
  let html = '';
  if (state.boot === 'setup') html = renderSetup();
  else if (state.boot === 'loading') html = renderLoading();
  else if (state.boot === 'login' || !state.user) html = renderLogin();
  else if (isQA()) html = (typeof renderQualidade === 'function') ? renderQualidade() : '';
  else if (state.route === 'wizard' && state.wiz) html = renderWizard();
  else if (state.route === 'success') html = renderSuccess();
  else if (state.route === 'minhas') html = renderMinhas();
  else html = renderHome();
  root.innerHTML = html;
  renderOverlays();
  if (state.route === 'wizard' && state.wiz && !isQA()) {
    const s = visibleFlow(state.wiz.data).find(x => x.id === state.wiz.current);
    if (s && s.type === 'fields' && s.id !== 'quando') {
      const first = s.fields.map(f => document.getElementById('f-' + f.k)).find(el => el && !el.value);
      if (first && first.focus) first.focus({ preventScroll: true });
    }
  }
}

/* =========================================================
   SINCRONIZAÇÃO
   ========================================================= */
function applySession(data) {
  const auth = API.Auth.get() || {};
  if (data.token) API.Auth.set({ token: data.token, user: data.user }); else if (auth.token) API.Auth.set({ token: auth.token, user: data.user });
  state.user = data.user; state.listas = data.listas || state.listas; state.occs = data.ocorrencias || [];
  state.lastSync = Date.now(); saveCache(); refreshDraftInfo();
}
function isTyping() { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest && a.closest('#root, #overlay-layer')); }

async function sync(silent) {
  if (!state.user || state.syncing || state.boot !== 'app') return;
  state.syncing = true; if (!silent) { render(); }
  const before = {}; state.occs.forEach(o => { before[o.protocolo] = o.status; });
  const r = await API.call('listar');
  state.syncing = false;
  if (r.ok) {
    const novas = r.data.ocorrencias;
    if (silent) {
      if (isQA()) {
        const n = novas.filter(o => !(o.protocolo in before)).length;
        if (before && Object.keys(before).length && n) toast(n === 1 ? 'Chegou 1 nova ocorrência.' : `Chegaram ${n} novas ocorrências.`);
      } else {
        novas.forEach(o => { if (before[o.protocolo] && before[o.protocolo] !== o.status) toast(`${o.protocolo}: ${statusLabel(o.status, false)}`); });
      }
    }
    state.occs = novas; state.lastSync = Date.now(); saveCache();
    if (!(silent && (isTyping() || state.route === 'wizard'))) render();
  } else if (r.code === 'AUTH') { doLogout(r.message || 'Sessão expirada.'); }
  else if (!silent) { toast(r.message || 'Não foi possível atualizar.', 'error'); render(); }
}
let pollTimer = null;
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState !== 'hidden') { flushOutbox(); sync(true); } }, CFG.REFRESH_MS || 45000);
}

/* ------------------------- Caixa de saída (sem sinal) ------------------------- */
const OUTBOX_KEY = 'univale_outbox_v2';
function loadOutbox() { state.outbox = lsGet(OUTBOX_KEY, []) || []; }
function saveOutbox() { return lsSet(OUTBOX_KEY, state.outbox); }
let flushing = false;
async function flushOutbox() {
  if (flushing || !state.user || state.boot !== 'app') return;
  const items = pendingOutbox().filter(x => !x.erro); if (!items.length) return;
  flushing = true;
  try {
    for (const it of items) {
      const r = await API.call('criar', { dados: it.dados, anexos: it.anexos, client_id: it.client_id });
      if (r.ok) {
        state.outbox = state.outbox.filter(x => x.client_id !== it.client_id); saveOutbox();
        upsertOcc(r.data.ocorrencia); toast(`Ocorrência enviada: ${r.data.ocorrencia.protocolo}`); render();
      } else if (r.network || r.code === 'AUTH') { break; }
      else { it.erro = r.message || 'Dados recusados.'; saveOutbox(); render(); }
    }
  } finally { flushing = false; }
}

/* =========================================================
   ENVIO
   ========================================================= */
async function submitWizard() {
  const w = state.wiz; if (!w || w.sending) return;
  const vis = visibleFlow(w.data);
  const bad = vis.find(s => s.type !== 'review' && screenError(s, w.data));
  if (bad) { toast(screenError(bad, w.data), 'error'); return wizGo(bad.id, 'back'); }
  const dados = {}; FORM_KEYS.forEach(k => { dados[k] = w.data[k]; });
  const anexos = w.anexos.map(a => ({ nome: a.nome, tipo: a.tipo, base64: a.base64 }));
  w.sending = true; render();
  if (w.editing) {
    const r = await API.call('reenviar', { protocolo: w.editing, dados, anexos });
    if (r.ok) { upsertOcc(r.data.ocorrencia); state.success = { protocolo: r.data.ocorrencia.protocolo, status: r.data.ocorrencia.status, edited: true };
      state.wiz = null; state.route = 'success'; render(); }
    else { w.sending = false; render(); if (r.code === 'AUTH') doLogout(r.message); else toast(r.message, 'error'); }
    return;
  }
  const client_id = uuid();
  const r = await API.call('criar', { dados, anexos, client_id });
  if (r.ok) {
    lsSet('univale_last_cidade', dados.cidade);
    upsertOcc(r.data.ocorrencia); clearDraft();
    state.success = { protocolo: r.data.ocorrencia.protocolo, status: r.data.ocorrencia.status };
    state.wiz = null; state.route = 'success'; render();
  } else if (r.network) {
    state.outbox.push({ client_id, matricula: state.user.matricula, dados, anexos, em: Date.now() });
    if (!saveOutbox()) { w.sending = false; render(); return toast('Sem sinal e sem espaço para guardar. Reduza os anexos e tente de novo.', 'error'); }
    lsSet('univale_last_cidade', dados.cidade); clearDraft();
    state.success = { pending: true }; state.wiz = null; state.route = 'success'; render();
  } else {
    w.sending = false; render();
    if (r.code === 'AUTH') doLogout(r.message); else toast(r.message || 'Não foi possível enviar.', 'error');
  }
}

/* ------------------------- Anexos ------------------------- */
function readAsDataURL(file) { return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(file); }); }
function compressImage(file) {
  return new Promise(async res => {
    const url = await readAsDataURL(file); if (!url) return res(null);
    const raw = { b64: url.split(',')[1], type: file.type || 'image/jpeg' };
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    const img = new Image();
    img.onload = () => {
      try {
        const max = 1600, sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        fin({ b64: c.toDataURL('image/jpeg', 0.8).split(',')[1], type: 'image/jpeg', jpg: true });
      } catch (e) { fin(raw); }
    };
    img.onerror = () => fin(raw); setTimeout(() => fin(raw), 6000); img.src = url;
  });
}
async function addFiles(fileList, isPhoto) {
  const w = state.wiz; if (!w) return;
  const maxN = CFG.MAX_ANEXOS || 5, maxB = (CFG.MAX_ANEXO_MB || 6) * 1024 * 1024;
  for (const f of Array.from(fileList || [])) {
    if (w.anexos.length >= maxN) { toast(`Máximo de ${maxN} anexos.`, 'error'); break; }
    let item;
    if (f.type && f.type.startsWith('image/')) {
      const c = await compressImage(f); if (!c) { toast('Não foi possível ler ' + f.name, 'error'); continue; }
      item = { nome: c.jpg ? f.name.replace(/\.[^.]+$/, '') + '.jpg' : f.name, tipo: c.type, base64: c.b64 };
    } else {
      if (f.size > maxB) { toast(`"${f.name}" passa de ${CFG.MAX_ANEXO_MB || 6} MB.`, 'error'); continue; }
      const url = await readAsDataURL(f); if (!url) { toast('Não foi possível ler ' + f.name, 'error'); continue; }
      item = { nome: f.name, tipo: f.type || 'application/octet-stream', base64: url.split(',')[1] };
    }
    if (item.base64.length * 0.75 > maxB) { toast(`"${f.name}" passa de ${CFG.MAX_ANEXO_MB || 6} MB.`, 'error'); continue; }
    w.anexos.push(item);
  }
  render();
}

/* =========================================================
   AÇÕES
   ========================================================= */
const ACTIONS = {
  togglePin() { const i = document.getElementById('lg-p'); if (i) i.type = i.type === 'password' ? 'text' : 'password'; },
  async login() {
    if (state.loginBusy) return;
    const m = (document.getElementById('lg-m') || {}).value || '', p = (document.getElementById('lg-p') || {}).value || '';
    if (!m.trim() || !p.trim()) { state.loginError = 'Informe matrícula e PIN.'; return render(); }
    state.loginBusy = true; state.loginError = ''; render();
    const r = await API.call('login', { matricula: m.trim(), pin: p.trim() });
    state.loginBusy = false;
    if (!r.ok) { state.loginError = r.message || 'Não foi possível entrar.'; return render(); }
    lsSet('univale_last_matricula', m.trim());
    applySession(r.data); loadOutbox(); state.boot = 'app'; state.route = 'home';
    state.qa.view = 'dashboard'; render(); startPolling(); flushOutbox();
  },
  logout() { doLogout(); },
  goHome() { state.route = 'home'; state.sheet = null; state.modal = null; refreshDraftInfo(); render(); },
  goMinhas() { state.route = 'minhas'; state.sheet = null; state.modal = null; render(); sync(true); },
  setMinhasFiltro(ds) { state.minhasFiltro = ds.v; render(); },
  novaOcorrencia() {
    if (!state.draftInfo) return startWizard();
    state.modal = { type: 'confirm', title: 'Começar uma nova ocorrência?', text: 'Você tem um registro em andamento. Ao começar outro, o rascunho atual será descartado.',
      confirm: 'Descartar e começar outra', action: 'newOverDraft', danger: true }; renderOverlays();
  },
  newOverDraft() { clearDraft(); startWizard(); },
  resumeDraft() { const d = state.draftInfo; if (!d) return; startWizard({ data: Object.assign(blankData(), d.data), current: d.current }); },
  discardDraft() { clearDraft(); render(); },
  openPerfil() { state.modal = { type: 'perfil' }; renderOverlays(); },
  closeOverlay() { state.sheet = null; state.modal = null; state.qa.detail = null; renderOverlays(); },
  closeModal() { state.modal = null; renderOverlays(); },
  refreshNow() { state.modal = null; renderOverlays(); sync(false); },
  openSheet(ds) { state.sheet = ds.id; renderOverlays(); },
  openSheetAfter(ds) { state.route = 'minhas'; state.sheet = ds.id; render(); },
  fixOcc(ds) {
    const o = findOcc(ds.id); if (!o) return;
    const data = {}; FORM_KEYS.forEach(k => { data[k] = o[k] || ''; });
    startWizard({ data, current: 'veic_mot', editing: o.protocolo, anexosExistentes: o.anexos || [] });
    state.wiz.returnToReview = false;
  },
  dropOutbox(ds) { state.outbox = state.outbox.filter(x => x.client_id !== ds.id); saveOutbox(); render(); },
  // assistente
  wizNext() { wizNext(false); }, wizBack() { wizBack(); }, wizExit() { wizExit(); },
  answer(ds) { setAnswer(ds.k, ds.v, true); },
  pick(ds) { setAnswer(ds.k, ds.v, false); },
  setNow() { const w = state.wiz; w.data.data = todayISO(); w.data.hora = nowHM(); saveDraft(); render(); },
  editStep(ds) { state.wiz.returnToReview = true; wizGo(ds.id, 'back'); },
  submit() { submitWizard(); },
  pickFoto() { const i = document.getElementById('file-foto'); if (i) i.click(); },
  pickDoc() { const i = document.getElementById('file-doc'); if (i) i.click(); },
  rmAnexo(ds) { state.wiz.anexos.splice(+ds.i, 1); render(); }
};

function doLogout(msg) {
  clearInterval(pollTimer);
  if (state.user) lsDel(cacheKey());
  API.Auth.clear();
  state.user = null; state.occs = []; state.wiz = null; state.sheet = null; state.modal = null; state.success = null;
  state.route = 'home'; state.boot = 'login'; state.loginError = typeof msg === 'string' ? msg : '';
  state.qa.detail = null; state.qa.view = 'dashboard';
  render();
}

/* =========================================================
   EVENTOS E INICIALIZAÇÃO
   ========================================================= */
function onClick(e) {
  const t = e.target.closest('[data-action]'); if (!t) return;
  if (t.tagName === 'A' && t.getAttribute('href')) return;
  if (t.dataset.self && e.target !== t) return;   // fundo da janela: só fecha se o clique foi no próprio fundo
  const fn = ACTIONS[t.dataset.action]; if (fn) { e.preventDefault(); fn(t.dataset, t, e); }
}
function onInput(e) {
  const t = e.target;
  if (t.dataset && t.dataset.bind && state.wiz) { state.wiz.data[t.dataset.bind] = t.value; saveDraftSoon(); return; }
  if (typeof qaOnInput === 'function') qaOnInput(t);
}
function onChange(e) {
  const t = e.target;
  if (t.dataset && t.dataset.bind && state.wiz) { state.wiz.data[t.dataset.bind] = t.value; saveDraftSoon(); return; }
  if (typeof qaOnChange === 'function') qaOnChange(t);
}
function onKey(e) {
  if (e.key === 'Escape' && (state.sheet || state.modal || state.qa.detail)) { ACTIONS.closeOverlay(); return; }
  if (e.key === 'Enter') {
    const t = e.target;
    if (t.id === 'lg-m' || t.id === 'lg-p') { e.preventDefault(); ACTIONS.login(); return; }
    if (t.tagName === 'INPUT' && t.dataset.bind && state.wiz) { e.preventDefault(); wizNext(false); return; }
    if (t.matches && t.matches('[data-action]:not(button):not(a)')) { e.preventDefault(); t.click(); }
  }
}
function makeFileInputs() {
  [['file-foto', 'image/*', true], ['file-doc', '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*', false]].forEach(([id, accept, photo]) => {
    const i = document.createElement('input'); i.type = 'file'; i.id = id; i.accept = accept; i.multiple = true; i.hidden = true;
    i.addEventListener('change', () => { addFiles(i.files, photo).then(() => { i.value = ''; }); });
    document.body.appendChild(i);
  });
}

async function init() {
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  window.addEventListener('online', () => { flushOutbox(); sync(true); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { flushOutbox(); sync(true); } });
  makeFileInputs();

  if (!CFG.API_URL) { state.boot = 'setup'; return render(); }
  loadOutbox();
  const auth = API.Auth.get();
  if (!auth || !auth.token || !auth.user) { state.boot = 'login'; return render(); }
  state.user = auth.user; loadCache(); refreshDraftInfo(); state.boot = 'app'; render();
  const r = await API.call('session');
  if (r.ok) { applySession(r.data); render(); startPolling(); flushOutbox(); }
  else if (r.code === 'AUTH') doLogout(r.message);
  else { toast('Sem conexão: mostrando os últimos dados salvos.'); startPolling(); }
}
document.addEventListener('DOMContentLoaded', init);

/* =========================================================
   UNIVALE · Ocorrências — área da Qualidade / Controlador
   (usa funções e estado definidos em script.js)
   ========================================================= */

const QA_NAV = [
  ['dashboard', '📊', 'Dashboard'], ['ocorrencias', '📋', 'Ocorrências'], ['pendencias', '⏳', 'Pendências'],
  ['historico', '🕘', 'Histórico'], ['relatorios', '📈', 'Relatórios']
];
const QA_TITLES = { dashboard: 'Dashboard', ocorrencias: 'Ocorrências', pendencias: 'Pendências', historico: 'Histórico', relatorios: 'Relatórios' };

function qaEmptyFilters() { return { q: '', from: '', to: '', status: '', setor: '', linha: '', motivo: '', impacto: '', subst: '' }; }

/* ------------------------- Filtros ------------------------- */
function qaFilter(list, f) {
  const q = (f.q || '').trim().toLowerCase();
  return list.filter(o => {
    if (q) {
      const hay = [o.protocolo, o.veiculo, o.motorista, o.numero_socorro, o.linha, o.bairro, o.cidade, o.local_especifico].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.from && o.data < f.from) return false;
    if (f.to && o.data > f.to) return false;
    if (f.status === 'concluidas') { if (!CONCLUIDAS.includes(o.status)) return false; }
    else if (f.status && o.status !== f.status) return false;
    if (f.setor && o.setor !== f.setor) return false;
    if (f.linha && o.linha !== f.linha) return false;
    if (f.motivo && o.motivo !== f.motivo) return false;
    if (f.impacto && o.houve_impacto_horario !== f.impacto) return false;
    if (f.subst && o.houve_substituicao !== f.subst) return false;
    return true;
  });
}
function qaActiveFilterCount() { const f = state.qa.f; return Object.keys(f).filter(k => k !== 'q' && f[k]).length; }
function uniqueSorted(arr) { return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })); }

/* ------------------------- Componentes ------------------------- */
function qaTable(list, opts) {
  opts = opts || {};
  if (!list.length) return `<div class="empty"><span>🔎</span>${opts.empty || 'Nenhuma ocorrência encontrada.'}</div>`;
  const cp = opts.compact ? ' class="cp"' : '';
  const rows = list.map(o => `<tr tabindex="0" role="button" data-action="qaOpen" data-id="${esc(o.protocolo)}">
    <td data-l="Protocolo"><b class="mono">${esc(o.protocolo)}</b></td>
    <td data-l="Quando">${fmtDate(o.data)} <small>${esc(o.hora)}</small></td>
    <td data-l="Veículo">${esc(o.veiculo)}</td>
    <td data-l="Setor · Linha">${esc(o.setor)}<small>${esc(o.linha)}</small></td>
    <td data-l="Motivo">${motivoEmoji(o.motivo)} ${esc(o.motivo)}</td>
    <td data-l="Nº Socorro" class="mono${o.numero_socorro ? '' : ' nosoc'}">${o.numero_socorro ? esc(o.numero_socorro) : '<span class="dash">—</span>'}</td>
    <td data-l="Há"><span class="age ${(o.status === 'aguardando_lancamento' && Date.now() - new Date(o.criado_em) > 3600000) ? 'late' : ''}">${ago(o.criado_em)}</span></td>
    <td data-l="Status">${pill(o.status, true)}</td></tr>`).join('');
  return `<div class="table-wrap"><table class="tbl${opts.compact ? ' compact' : ''}"><thead><tr><th>Protocolo</th><th>Quando</th><th>Veículo</th><th>Setor · Linha</th><th>Motivo</th><th>Nº Socorro</th><th>Há</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function bars(items, max) {
  if (!items.length) return '<div class="empty small"><span>—</span>Sem dados no período.</div>';
  const m = max || Math.max(1, ...items.map(i => i[1]));
  return `<div class="bars">${items.map(i => `<div class="bar"><span>${esc(i[0])}</span><div class="track"><i style="width:${Math.round(i[1] / m * 100)}%"></i></div><b>${i[1]}</b></div>`).join('')}</div>`;
}
function countBy(list, fn) { const m = {}; list.forEach(o => { const k = fn(o); if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }
function qaEvents(limit) {
  const ev = [];
  state.occs.forEach(o => (o.historico || []).forEach(h => ev.push(Object.assign({ protocolo: o.protocolo }, h))));
  return ev.sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, limit);
}
function eventItem(e) {
  return `<li><button class="ev" data-action="qaOpen" data-id="${esc(e.protocolo)}"><i></i><div><b>${esc(e.acao)}</b><small>${esc(e.protocolo)} · ${fmtDT(e.ts)} · ${esc(e.usuario)}</small></div></button></li>`;
}

/* ------------------------- Telas ------------------------- */
function qaDashboard() {
  const all = state.occs; const c = s => all.filter(o => o.status === s).length;
  const kpi = (label, n, s, cls) => `<button class="kpi ${cls || ''}" data-action="qaKpi" data-s="${s}"><b>${n}</b><span>${label}</span></button>`;
  const aguard = all.filter(o => o.status === 'aguardando_lancamento').sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
  const analise = all.filter(o => o.status === 'em_analise').sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const recentes = all.filter(o => o.data >= since);
  return `<div class="kpis">${kpi('Aguardando nº do socorro', c('aguardando_lancamento'), 'aguardando_lancamento', 'amber')}${kpi('Em análise', c('em_analise'), 'em_analise', 'blue')}
    ${kpi('Correção solicitada', c('correcao_solicitada'), 'correcao_solicitada', 'orange')}${kpi('Concluídas', c('validada') + c('encerrada'), 'concluidas', 'green')}${kpi('Total', all.length, '', 'total')}</div>
    <div class="grid2"><div class="col">
      <section class="panel"><header><h2>Precisa de atenção <small>aguardando nº do socorro</small></h2></header>${qaTable(aguard.slice(0, 6), { compact: true, empty: 'Tudo em dia: nenhuma ocorrência aguardando lançamento. 🎉' })}
        ${aguard.length > 6 ? `<footer><button class="link" data-action="qaKpi" data-s="aguardando_lancamento">Ver as ${aguard.length} ocorrências</button></footer>` : ''}</section>
      <section class="panel"><header><h2>A validar <small>socorro já vinculado</small></h2></header>${qaTable(analise.slice(0, 5), { compact: true, empty: 'Nada aguardando validação.' })}</section>
    </div><div class="col">
      <section class="panel"><header><h2>Motivos <small>últimos 30 dias</small></h2></header><div class="pad">${bars(countBy(recentes, o => o.motivo).slice(0, 8))}</div></section>
      <section class="panel"><header><h2>Atividade recente</h2></header><ol class="events">${qaEvents(8).map(eventItem).join('') || '<div class="empty small"><span>—</span>Sem atividade.</div>'}</ol></section>
    </div></div>`;
}

function qaFiltersPanel() {
  const f = state.qa.f;
  const sel = (key, label, opts) => `<label class="fl"><span>${label}</span><select data-filter="${key}"><option value="">Todos</option>${opts.map(o => { const v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return `<option value="${esc(v)}" ${f[key] === v ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select></label>`;
  const setores = uniqueSorted([].concat(state.listas.setores || [], state.occs.map(o => o.setor)));
  const linhas = uniqueSorted([].concat(state.listas.linhas || [], state.occs.map(o => o.linha)));
  const statusOpts = Object.keys(STATUS).map(k => [k, STATUS[k].qa]).concat([['concluidas', 'Concluídas (validadas + encerradas)']]);
  return `<div class="filters"><label class="fl"><span>De</span><input type="date" data-filter="from" value="${esc(f.from)}"></label><label class="fl"><span>Até</span><input type="date" data-filter="to" value="${esc(f.to)}"></label>
    ${sel('status', 'Status', statusOpts)}${sel('setor', 'Setor', setores)}${sel('linha', 'Linha', linhas)}${sel('motivo', 'Motivo', MOTIVOS.map(m => m.v))}
    ${sel('impacto', 'Impacto no horário', [['sim', 'Sim'], ['nao', 'Não']])}${sel('subst', 'Substituição', [['sim', 'Sim'], ['nao', 'Não']])}
    <div class="fl end"><button class="btn btn-ghost btn-sm" data-action="qaClear">Limpar filtros</button></div></div>`;
}
function qaResults() {
  const list = sortRecent(qaFilter(state.occs, state.qa.f)); const lim = state.qa.limit;
  return `<div class="res-head"><b>${list.length}</b> ${list.length === 1 ? 'ocorrência' : 'ocorrências'}</div>${qaTable(list.slice(0, lim))}
    ${list.length > lim ? `<div class="more"><button class="btn btn-ghost" data-action="qaMore">Mostrar mais (${list.length - lim})</button></div>` : ''}`;
}
function qaOcorrencias() {
  const n = qaActiveFilterCount();
  return `<section class="panel"><div class="toolbar"><div class="search"><span>🔎</span><input id="qa-q" data-filter="q" value="${esc(state.qa.f.q)}" placeholder="Buscar protocolo, veículo, motorista, nº do socorro, local…" autocomplete="off"></div>
    <button class="btn btn-ghost" data-action="qaToggleFilters">Filtros${n ? ` <span class="badge">${n}</span>` : ''}</button>
    <button class="btn btn-ghost" data-action="qaExport">⬇ Exportar CSV</button></div>
    ${state.qa.showFilters ? qaFiltersPanel() : ''}<div id="qa-results">${qaResults()}</div></section>`;
}
function qaPendencias() {
  const g = s => state.occs.filter(o => o.status === s).sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
  const block = (t, sub, list, empty) => `<section class="panel"><header><h2>${t} <small>${sub}</small></h2><span class="count">${list.length}</span></header>${qaTable(list, { empty })}</section>`;
  return block('Aguardando nº do socorro', 'lance no sistema corporativo e vincule o número', g('aguardando_lancamento'), 'Nenhuma ocorrência aguardando lançamento. 🎉') +
    block('Em análise', 'socorro vinculado — falta validar', g('em_analise'), 'Nada aguardando validação.') +
    block('Correção solicitada', 'aguardando o colaborador', g('correcao_solicitada'), 'Nenhuma correção pendente.');
}
function qaHistorico() {
  const ev = qaEvents(150); if (!ev.length) return '<div class="empty"><span>🕘</span>Ainda não há atividade registrada.</div>';
  const groups = {}; ev.forEach(e => { const d = fmtDate(String(e.ts).slice(0, 10)); (groups[d] = groups[d] || []).push(e); });
  return `<section class="panel">${Object.keys(groups).map(d => `<div class="day"><h3>${d}</h3><ol class="events">${groups[d].map(eventItem).join('')}</ol></div>`).join('')}</section>`;
}
function relRange() {
  const r = state.qa.rel;
  if (!r.from) r.from = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  if (!r.to) r.to = todayISO();
  return r;
}
function qaStats(list) {
  const n = list.length, pc = fn => n ? Math.round(list.filter(fn).length / n * 100) + '%' : '—';
  const tempos = list.filter(o => o.data_lancamento_socorro && o.criado_em).map(o => (new Date(o.data_lancamento_socorro) - new Date(o.criado_em)) / 36e5).filter(x => x >= 0);
  const media = tempos.length ? (tempos.reduce((a, b) => a + b, 0) / tempos.length) : null;
  return { n, pass: pc(o => o.possui_passageiros === 'sim'), bald: pc(o => o.houve_baldeio === 'sim'), imp: pc(o => o.houve_impacto_horario === 'sim'),
    subst: pc(o => o.houve_substituicao === 'sim'), rem: pc(o => o.houve_remocao === 'sim'),
    media: media === null ? '—' : media < 1 ? Math.round(media * 60) + ' min' : media.toFixed(1).replace('.', ',') + ' h' };
}
function qaRelatorios() {
  const r = relRange(); const list = state.occs.filter(o => o.data >= r.from && o.data <= r.to); const s = qaStats(list);
  const stat = (l, v) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  return `<section class="panel"><div class="toolbar"><label class="fl inline"><span>De</span><input type="date" data-rel="from" value="${esc(r.from)}"></label>
    <label class="fl inline"><span>Até</span><input type="date" data-rel="to" value="${esc(r.to)}"></label><span class="grow"></span>
    <button class="btn btn-primary" data-action="qaExportRel">⬇ Exportar período (.csv)</button></div>
    <div class="stats">${stat('Ocorrências', s.n)}${stat('Com passageiros', s.pass)}${stat('Com baldeio', s.bald)}${stat('Impacto no horário', s.imp)}${stat('Com substituição', s.subst)}${stat('Com remoção', s.rem)}${stat('Tempo até lançar o socorro', s.media)}</div></section>
    <div class="grid2"><div class="col"><section class="panel"><header><h2>Por motivo</h2></header><div class="pad">${bars(countBy(list, o => o.motivo))}</div></section>
      <section class="panel"><header><h2>Por setor</h2></header><div class="pad">${bars(countBy(list, o => o.setor))}</div></section></div>
    <div class="col"><section class="panel"><header><h2>Linhas com mais ocorrências</h2></header><div class="pad">${bars(countBy(list, o => o.linha).slice(0, 8))}</div></section>
      <section class="panel"><header><h2>Veículos reincidentes <small>mais ocorrências</small></h2></header><div class="pad">${bars(countBy(list, o => o.veiculo).slice(0, 8))}</div></section></div></div>`;
}

function renderQualidade() {
  const v = state.qa.view; const pend = state.occs.filter(o => o.status === 'aguardando_lancamento').length;
  const navBtn = (n, cls) => `<button class="${cls} ${v === n[0] ? 'on' : ''}" data-action="qaNav" data-v="${n[0]}"><span class="ti">${n[1]}</span><em>${n[2]}</em>${n[0] === 'pendencias' && pend ? `<i class="nb">${pend}</i>` : ''}</button>`;
  const content = v === 'dashboard' ? qaDashboard() : v === 'ocorrencias' ? qaOcorrencias() : v === 'pendencias' ? qaPendencias() : v === 'historico' ? qaHistorico() : qaRelatorios();
  const sync = state.lastSync ? `Atualizado há ${ago(new Date(state.lastSync).toISOString())}` : '';
  return `<div class="qa"><aside class="qa-side"><div class="qa-brand">${LOGO}</div>
      <nav>${QA_NAV.map(n => navBtn(n, 'nav')).join('')}</nav>
      <div class="qa-user"><span class="avatar-sm">${esc(initials(state.user.nome))}</span><div><b>${esc(state.user.nome)}</b><small>Qualidade</small></div>
      <button class="icon-btn" data-action="logout" title="Sair" aria-label="Sair">⏻</button></div></aside>
    <div class="qa-main"><header class="qa-top"><div class="qa-top-l"><span class="qa-mlogo">${LOGO}</span><h1>${QA_TITLES[v]}</h1></div>
      <div class="qa-top-r"><small class="muted sync">${sync}</small><button class="btn btn-ghost btn-sm ${state.syncing ? 'spin' : ''}" data-action="refreshNow">↻ Atualizar</button>
      <button class="avatar-btn mobile-only" data-action="openPerfil" aria-label="Perfil">${esc(initials(state.user.nome))}</button></div></header>
      <main class="qa-content">${content}</main></div>
    <nav class="qa-bottom">${QA_NAV.map(n => navBtn(n, 'bn')).join('')}</nav></div>`;
}

/* ------------------------- Drawer da ocorrência ------------------------- */
function qaOverlayHtml() {
  let html = '';
  const o = state.qa.detail ? findOcc(state.qa.detail) : null;
  if (o) html += qaDrawer(o);
  if (state.modal && state.modal.type === 'correcao') html += correcaoModal();
  return html;
}
function qaDrawer(o) {
  const d = state.qa.drafts, busy = state.busy, enc = o.status === 'encerrada';
  const canValidate = !!o.numero_socorro && o.status === 'em_analise';
  const hint = enc ? 'Ocorrência encerrada: somente consulta.' : o.status === 'correcao_solicitada' ? 'Aguardando o colaborador corrigir.' : !o.numero_socorro ? 'Vincule o nº do socorro para poder validar.' : '';
  return `<div class="scrim right" data-action="closeOverlay" data-self="1"><aside class="drawer" role="dialog" aria-label="Ocorrência ${esc(o.protocolo)}">
    <header class="drawer-head"><div><h2>${esc(o.protocolo)}</h2><small class="muted">${fmtDate(o.data)} às ${esc(o.hora)} · registrada por ${esc(o.criado_por)} (${esc(o.matricula_criador)})</small></div>
      <button class="icon-btn" data-action="closeOverlay" aria-label="Fechar">✕</button></header>
    <div class="drawer-body">
      <div class="row-between">${pill(o.status, true)}<small class="muted">Registrada há ${ago(o.criado_em)}</small></div>
      ${o.status === 'correcao_solicitada' ? `<div class="alert warn"><b>Aguardando correção do colaborador</b><p>${esc(o.correcao_mensagem)}</p></div>` : ''}
      <section class="socorro"><h3>Controle do socorro</h3>
        <label class="lbl-w" for="qa-soc">Nº do socorro no sistema corporativo</label>
        <input id="qa-soc" class="inp-w" data-qa="socorro" value="${esc(d.socorro)}" placeholder="Ex.: 458721" inputmode="numeric" ${enc ? 'disabled' : ''} autocomplete="off">
        <label class="lbl-w" for="qa-obs">Observação da Qualidade <em>(opcional)</em></label>
        <textarea id="qa-obs" class="inp-w area" data-qa="obs" rows="3" placeholder="Ex.: Socorro lançado no sistema corporativo." ${enc ? 'disabled' : ''}>${esc(d.obs)}</textarea>
        <button class="btn btn-white btn-block" data-action="qaVincular" ${busy || enc ? 'disabled' : ''}>${busy ? '<span class="spinner sm dark"></span>' : ''}${o.numero_socorro ? 'Salvar alterações' : 'Vincular socorro'}</button>
        ${o.numero_socorro ? `<p class="linked">✓ Socorro nº <b>${esc(o.numero_socorro)}</b> vinculado${o.responsavel_qualidade ? ` por <b>${esc(o.responsavel_qualidade)}</b>` : ''} em ${fmtDT(o.data_lancamento_socorro)}</p>` : ''}</section>
      <div class="actions"><button class="btn btn-primary" data-action="qaValidar" ${busy || !canValidate ? 'disabled' : ''}>✓ Validar</button>
        <button class="btn btn-ghost" data-action="qaCorrecaoOpen" ${busy || enc ? 'disabled' : ''}>✎ Solicitar correção</button>
        <button class="btn btn-ghost" data-action="qaEncerrarAsk" data-id="${esc(o.protocolo)}" ${busy || enc ? 'disabled' : ''}>■ Encerrar</button></div>
      ${hint ? `<p class="tiny muted">${hint}</p>` : ''}
      ${sections(o).map(sec => `<section class="rv"><header><h3>${sec.t}</h3></header>${rowsHtml(sec.rows)}</section>`).join('')}
      ${attachmentsHtml(o)}${timelineHtml(o)}
    </div></aside></div>`;
}
function correcaoModal() {
  const o = findOcc(state.modal.id); const busy = state.busy;
  return `<div class="scrim center-modal" data-action="closeModal" data-self="1"><div class="modal"><h2>Solicitar correção</h2>
    <p class="muted">${esc(o ? o.protocolo : '')} · o colaborador verá este texto no aplicativo.</p>
    <label class="lbl" for="qa-cor">O que precisa ser corrigido?</label>
    <textarea id="qa-cor" class="inp area" data-qa="correcao" rows="4" placeholder="Ex.: Favor corrigir o local da ocorrência.">${esc(state.qa.drafts.correcao)}</textarea>
    <div class="stack"><button class="btn btn-primary btn-block" data-action="qaCorrecaoSend" ${busy ? 'disabled' : ''}>Enviar pedido de correção</button>
      <button class="btn btn-ghost btn-block" data-action="closeModal">Cancelar</button></div></div></div>`;
}

/* ------------------------- Interação ------------------------- */
function qaResetDrafts(o) { state.qa.draftFor = o.protocolo; state.qa.drafts = { socorro: o.numero_socorro || '', obs: o.observacao_qualidade || '', correcao: '' }; }
function qaRefreshResults() {
  const el = document.getElementById('qa-results'); if (el) el.innerHTML = qaResults();
}
function qaOnInput(t) {
  if (t.dataset.qa) { state.qa.drafts[t.dataset.qa] = t.value; return; }
  if (t.dataset.filter && t.type !== 'date') { state.qa.f[t.dataset.filter] = t.value; state.qa.limit = 100; qaRefreshResults(); }
}
function qaOnChange(t) {
  if (t.dataset.qa) { state.qa.drafts[t.dataset.qa] = t.value; return; }
  if (t.dataset.filter) { state.qa.f[t.dataset.filter] = t.value; state.qa.limit = 100; qaRefreshResults(); const b = document.querySelector('[data-action="qaToggleFilters"]'); if (b) b.innerHTML = 'Filtros' + (qaActiveFilterCount() ? ` <span class="badge">${qaActiveFilterCount()}</span>` : ''); return; }
  if (t.dataset.rel) { state.qa.rel[t.dataset.rel] = t.value; render(); }
}
async function qaCall(action, payload, okMsg) {
  if (state.busy) return; state.busy = true; renderOverlays();
  const r = await API.call(action, payload); state.busy = false;
  if (r.ok) {
    upsertOcc(r.data.ocorrencia); qaResetDrafts(r.data.ocorrencia); state.modal = null;
    if (okMsg) toast(okMsg); render();
  } else if (r.code === 'AUTH') { doLogout(r.message); }
  else { toast(r.message || 'Não foi possível concluir a ação.', 'error'); renderOverlays(); }
}

/* ------------------------- Exportação CSV ------------------------- */
function csvCell(v) {
  let s = (v === undefined || v === null) ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // evita fórmulas ao abrir no Excel
  s = s.replace(/"/g, '""');
  return /[;"\n\r]/.test(s) ? `"${s}"` : s;
}
function exportCsv(list, nome) {
  const cols = [['protocolo', 'Protocolo'], ['data', 'Data', fmtDate], ['hora', 'Hora'], ['veiculo', 'Veículo'], ['setor', 'Setor'], ['linha', 'Linha'], ['motorista', 'Motorista'],
    ['cidade', 'Cidade'], ['bairro', 'Bairro'], ['local_especifico', 'Rua / local'], ['possui_passageiros', 'Passageiros', yn], ['houve_baldeio', 'Baldeio', yn],
    ['houve_impacto_horario', 'Impacto horário', yn], ['tipo_impacto', 'Tipo de impacto'], ['descricao_impacto', 'Descrição do impacto'],
    ['houve_substituicao', 'Substituição', yn], ['substituicao_fora_ponto_apoio', 'Fora do ponto de apoio', yn], ['local_substituicao', 'Local da substituição'],
    ['detalhamento_substituicao', 'Detalhe do local'], ['veiculo_substituto', 'Veículo substituto'], ['motorista_substituto', 'Motorista substituto'],
    ['manutencao_acionada', 'Manutenção acionada', yn], ['manutencao_deslocou', 'Manutenção deslocou', yn], ['retorno_proprio', 'Retorno próprio', yn],
    ['houve_remocao', 'Remoção', yn], ['tipo_remocao', 'Tipo de remoção'], ['motivo', 'Motivo'], ['descricao_motivo', 'Descrição do motivo'], ['observacoes', 'Observações'],
    ['numero_socorro', 'Nº Socorro'], ['status', 'Status', s => statusLabel(s, true)], ['responsavel_qualidade', 'Responsável pelo lançamento'],
    ['data_lancamento_socorro', 'Data do lançamento', fmtDT], ['observacao_qualidade', 'Observação da Qualidade'], ['criado_por', 'Criado por'], ['criado_em', 'Criado em', fmtDT]];
  const head = cols.map(c => csvCell(c[1])).join(';');
  const body = list.map(o => cols.map(c => csvCell(c[2] ? (c[2] === yn && !o[c[0]] ? '' : c[2](o[c[0]])) : o[c[0]])).join(';'));
  const csv = '\uFEFF' + [head].concat(body).join('\r\n');
  state.lastCsv = csv;
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `${nome}-${todayISO()}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast('Não foi possível gerar o arquivo.', 'error'); return; }
  toast(`${list.length} ocorrência(s) exportada(s).`);
}

/* ------------------------- Ações ------------------------- */
Object.assign(ACTIONS, {
  qaNav(ds) { state.qa.view = ds.v; state.qa.detail = null; render(); window.scrollTo && window.scrollTo(0, 0); },
  qaKpi(ds) { state.qa.f = qaEmptyFilters(); state.qa.f.status = ds.s; state.qa.view = 'ocorrencias'; state.qa.showFilters = !!ds.s; state.qa.limit = 100; render(); },
  qaToggleFilters() { state.qa.showFilters = !state.qa.showFilters; render(); },
  qaClear() { state.qa.f = qaEmptyFilters(); state.qa.limit = 100; render(); },
  qaMore() { state.qa.limit += 100; qaRefreshResults(); },
  qaExport() { exportCsv(sortRecent(qaFilter(state.occs, state.qa.f)), 'univale-ocorrencias'); },
  qaExportRel() { const r = relRange(); exportCsv(sortRecent(state.occs.filter(o => o.data >= r.from && o.data <= r.to)), 'univale-relatorio'); },
  async qaOpen(ds) {
    const o = findOcc(ds.id); if (!o) return;
    state.qa.detail = o.protocolo; state.modal = null; qaResetDrafts(o); renderOverlays();
    if (!(o.historico || []).some(h => h.acao === 'Recebida pelo controlador.')) {
      const r = await API.call('receber', { protocolo: o.protocolo });
      if (r.ok) { const keep = Object.assign({}, state.qa.drafts); upsertOcc(r.data.ocorrencia); if (state.qa.detail === o.protocolo) { state.qa.drafts = keep; if (!isTyping()) renderOverlays(); } }
      else if (r.code === 'AUTH') doLogout(r.message);
    }
  },
  qaVincular() {
    const o = findOcc(state.qa.detail); if (!o) return;
    const n = (state.qa.drafts.socorro || '').trim();
    if (!n) return toast('Informe o número do socorro.', 'error');
    qaCall('vincular', { protocolo: o.protocolo, numero_socorro: n, observacao_qualidade: state.qa.drafts.obs || '' }, o.numero_socorro ? 'Alterações salvas.' : `Socorro nº ${n} vinculado.`);
  },
  qaValidar() { const o = findOcc(state.qa.detail); if (o) qaCall('validar', { protocolo: o.protocolo }, 'Ocorrência validada.'); },
  qaCorrecaoOpen() { state.qa.drafts.correcao = ''; state.modal = { type: 'correcao', id: state.qa.detail }; renderOverlays(); },
  qaCorrecaoSend() {
    const m = (state.qa.drafts.correcao || '').trim();
    if (!m) return toast('Descreva o que precisa ser corrigido.', 'error');
    qaCall('correcao', { protocolo: state.modal.id, mensagem: m }, 'Pedido de correção enviado ao colaborador.');
  },
  qaEncerrarAsk(ds) {
    state.modal = { type: 'confirm', title: 'Encerrar esta ocorrência?', text: 'Depois de encerrada ela fica somente para consulta e não poderá mais ser alterada.', confirm: 'Encerrar ocorrência', action: 'qaEncerrar', id: ds.id, danger: true };
    renderOverlays();
  },
  qaEncerrar(ds) { qaCall('encerrar', { protocolo: ds.id }, 'Ocorrência encerrada.'); }
});
