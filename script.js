/* =========================================================
   CONFIGURAÇÃO — a única linha que você precisa editar:
   cole em API_URL o endereço do Web App (termina com /exec).
   ========================================================= */
'use strict';
const CFG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxnt9oGcOZcuVTrsLZCb6npXoQYaCx8Jfu2ySs_mlLK7sHkrkrfSPf6-efBIxEm4yI5/exec',
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
const MESMO_MOTORISTA = 'Mesmo motorista';
const MOTIVOS = [
  { v: 'Falha mecânica', i: 'cog' }, { v: 'Falha elétrica', i: 'zap' }, { v: 'Pneu', i: 'circle-dot' },
  { v: 'Ar-condicionado', i: 'snowflake' }, { v: 'Carroceria', i: 'car-front' }, { v: 'Combustível', i: 'fuel' },
  { v: 'Sistema/equipamento', i: 'monitor' }, { v: 'Outro', i: 'ellipsis' }
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

/* Ícones Lucide (ISC License) — https://lucide.dev */
const ICONS = {"house":"<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\" /><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\" />","plus":"<path d=\"M5 12h14\" /><path d=\"M12 5v14\" />","clipboard-list":"<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" /><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" /><path d=\"M12 11h4\" /><path d=\"M12 16h4\" /><path d=\"M8 11h.01\" /><path d=\"M8 16h.01\" />","layout-dashboard":"<rect width=\"7\" height=\"9\" x=\"3\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"5\" x=\"14\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"9\" x=\"14\" y=\"12\" rx=\"1\" /><rect width=\"7\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\" />","hourglass":"<path d=\"M5 22h14\" /><path d=\"M5 2h14\" /><path d=\"M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22\" /><path d=\"M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2\" />","history":"<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /><path d=\"M3 3v5h5\" /><path d=\"M12 7v5l4 2\" />","chart-column":"<path d=\"M3 3v16a2 2 0 0 0 2 2h16\" /><path d=\"M18 17V9\" /><path d=\"M13 17V5\" /><path d=\"M8 17v-3\" />","log-out":"<path d=\"m16 17 5-5-5-5\" /><path d=\"M21 12H9\" /><path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\" />","refresh-cw":"<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" /><path d=\"M21 3v5h-5\" /><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" /><path d=\"M8 16H3v5\" />","search":"<path d=\"m21 21-4.34-4.34\" /><circle cx=\"11\" cy=\"11\" r=\"8\" />","sliders-horizontal":"<path d=\"M10 5H3\" /><path d=\"M12 19H3\" /><path d=\"M14 3v4\" /><path d=\"M16 17v4\" /><path d=\"M21 12h-9\" /><path d=\"M21 19h-5\" /><path d=\"M21 5h-7\" /><path d=\"M8 10v4\" /><path d=\"M8 12H3\" />","download":"<path d=\"M12 15V3\" /><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /><path d=\"m7 10 5 5 5-5\" />","x":"<path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" />","chevron-left":"<path d=\"m15 18-6-6 6-6\" />","chevron-right":"<path d=\"m9 18 6-6-6-6\" />","check":"<path d=\"M20 6 9 17l-5-5\" />","eye":"<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />","eye-off":"<path d=\"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49\" /><path d=\"M14.084 14.158a3 3 0 0 1-4.242-4.242\" /><path d=\"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143\" /><path d=\"m2 2 20 20\" />","paperclip":"<path d=\"m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551\" />","camera":"<path d=\"M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z\" /><circle cx=\"12\" cy=\"13\" r=\"3\" />","file-text":"<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /><path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /><path d=\"M10 9H8\" /><path d=\"M16 13H8\" /><path d=\"M16 17H8\" />","image":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /><circle cx=\"9\" cy=\"9\" r=\"2\" /><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />","triangle-alert":"<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\" /><path d=\"M12 9v4\" /><path d=\"M12 17h.01\" />","info":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 16v-4\" /><path d=\"M12 8h.01\" />","send":"<path d=\"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z\" /><path d=\"m21.854 2.147-10.94 10.939\" />","user":"<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\" /><circle cx=\"12\" cy=\"7\" r=\"4\" />","lock":"<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /><path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />","key-round":"<path d=\"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z\" /><circle cx=\"16.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />","cloud-off":"<path d=\"M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057\" /><path d=\"M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78\" /><path d=\"m2 2 20 20\" />","upload":"<path d=\"M12 3v12\" /><path d=\"m17 8-5-5-5 5\" /><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />","bus":"<path d=\"M8 6v6\" /><path d=\"M15 6v6\" /><path d=\"M2 12h19.6\" /><path d=\"M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3\" /><circle cx=\"7\" cy=\"18\" r=\"2\" /><path d=\"M9 18h5\" /><circle cx=\"16\" cy=\"18\" r=\"2\" />","wrench":"<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z\" />","zap":"<path d=\"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z\" />","circle-dot":"<circle cx=\"12\" cy=\"12\" r=\"1\" /><circle cx=\"12\" cy=\"12\" r=\"10\" />","snowflake":"<path d=\"m10 20-1.25-2.5L6 18\" /><path d=\"M10 4 8.75 6.5 6 6\" /><path d=\"m14 20 1.25-2.5L18 18\" /><path d=\"m14 4 1.25 2.5L18 6\" /><path d=\"m17 21-3-6h-4\" /><path d=\"m17 3-3 6 1.5 3\" /><path d=\"M2 12h6.5L10 9\" /><path d=\"m20 10-1.5 2 1.5 2\" /><path d=\"M22 12h-6.5L14 15\" /><path d=\"m4 10 1.5 2L4 14\" /><path d=\"m7 21 3-6-1.5-3\" /><path d=\"m7 3 3 6h4\" />","fuel":"<path d=\"M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5\" /><path d=\"M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16\" /><path d=\"M2 21h13\" /><path d=\"M3 9h11\" />","monitor":"<rect width=\"20\" height=\"14\" x=\"2\" y=\"3\" rx=\"2\" /><line x1=\"8\" x2=\"16\" y1=\"21\" y2=\"21\" /><line x1=\"12\" x2=\"12\" y1=\"17\" y2=\"21\" />","circle-plus":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M8 12h8\" /><path d=\"M12 8v8\" />","cog":"<path d=\"M11 10.27 7 3.34\" /><path d=\"m11 13.73-4 6.93\" /><path d=\"M12 22v-2\" /><path d=\"M12 2v2\" /><path d=\"M14 12h8\" /><path d=\"m17 20.66-1-1.73\" /><path d=\"m17 3.34-1 1.73\" /><path d=\"M2 12h2\" /><path d=\"m20.66 17-1.73-1\" /><path d=\"m20.66 7-1.73 1\" /><path d=\"m3.34 17 1.73-1\" /><path d=\"m3.34 7 1.73 1\" /><circle cx=\"12\" cy=\"12\" r=\"2\" /><circle cx=\"12\" cy=\"12\" r=\"8\" />","map-pin":"<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\" /><circle cx=\"12\" cy=\"10\" r=\"3\" />","calendar":"<path d=\"M8 2v3\" /><path d=\"M16 2v3\" /><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" /><path d=\"M3 9h18\" />","clock":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 6v6l4 2\" />","users":"<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /><path d=\"M16 3.128a4 4 0 0 1 0 7.744\" /><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\" /><circle cx=\"9\" cy=\"7\" r=\"4\" />","repeat":"<path d=\"m17 2 4 4-4 4\" /><path d=\"M3 11v-1a4 4 0 0 1 4-4h14\" /><path d=\"m7 22-4-4 4-4\" /><path d=\"M21 13v1a4 4 0 0 1-4 4H3\" />","truck":"<path d=\"M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2\" /><path d=\"M15 18H9\" /><path d=\"M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14\" /><circle cx=\"17\" cy=\"18\" r=\"2\" /><circle cx=\"7\" cy=\"18\" r=\"2\" />","circle-check":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m16 9-5.5 5.5L8 12\" />","pencil":"<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\" /><path d=\"m15 5 4 4\" />","archive":"<rect width=\"20\" height=\"5\" x=\"2\" y=\"3\" rx=\"1\" /><path d=\"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8\" /><path d=\"M10 12h4\" />","badge-check":"<path d=\"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z\" /><path d=\"m16 9-5.5 5.5L8 12\" />","shield-check":"<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" /><path d=\"m9 12 2 2 4-4\" />","id-card":"<path d=\"M13 19a4 4 0 00-8 0\" /><path d=\"M16 10h2\" /><path d=\"M16 14h2\" /><circle cx=\"9\" cy=\"12\" r=\"3\" /><rect x=\"2\" y=\"5\" width=\"20\" height=\"14\" rx=\"2\" />","route":"<circle cx=\"6\" cy=\"19\" r=\"3\" /><path d=\"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15\" /><circle cx=\"18\" cy=\"5\" r=\"3\" />","circle-help":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\" /><path d=\"M12 17h.01\" />","sparkles":"<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\" /><path d=\"M20 2v4\" /><path d=\"M22 4h-4\" /><circle cx=\"4\" cy=\"20\" r=\"2\" />","car-front":"<path d=\"m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8\" /><path d=\"M7 14h.01\" /><path d=\"M17 14h.01\" /><rect width=\"18\" height=\"8\" x=\"3\" y=\"10\" rx=\"2\" /><path d=\"M5 18v2\" /><path d=\"M19 18v2\" />","ellipsis":"<circle cx=\"12\" cy=\"12\" r=\"1\" /><circle cx=\"19\" cy=\"12\" r=\"1\" /><circle cx=\"5\" cy=\"12\" r=\"1\" />","arrow-right":"<path d=\"M5 12h14\" /><path d=\"m12 5 7 7-7 7\" />","circle-x":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m15 9-6 6\" /><path d=\"m9 9 6 6\" />","file-check":"<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /><path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /><path d=\"m9 15 2 2 4-4\" />","timer":"<line x1=\"10\" x2=\"14\" y1=\"2\" y2=\"2\" /><line x1=\"12\" x2=\"15\" y1=\"14\" y2=\"11\" /><circle cx=\"12\" cy=\"14\" r=\"8\" />","party-popper":"<path d=\"M5.8 11.3 2 22l10.7-3.79\" /><path d=\"M4 3h.01\" /><path d=\"M22 8h.01\" /><path d=\"M15 2h.01\" /><path d=\"M22 20h.01\" /><path d=\"m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10\" /><path d=\"m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17\" /><path d=\"m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7\" /><path d=\"M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z\" />","inbox":"<polyline points=\"22 12 16 12 14 15 10 15 8 12 2 12\" /><path d=\"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\" />"};
function ic(name, size, cls) {
  const s = size || 20;
  return `<svg class="ic${cls ? ' ' + cls : ''}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ------------------------- Estado ------------------------- */
const state = {
  boot: 'loading',            // loading | setup | login | newpass | app
  user: null,
  listas: { setores: [], linhas: [], veiculos: [], motoristas: [] },
  occs: [], lastSync: 0, syncing: false,
  route: 'home',              // colaborador: home | wizard | minhas | success
  minhasFiltro: 'todas',
  wiz: null, success: null, sheet: null, modal: null,
  outbox: [], draftInfo: null, loginError: '', loginBusy: false, passError: '', passBusy: false, busy: false,
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
function motivoIcon(v, size) { const m = MOTIVOS.find(x => x.v === v); return ic(m ? m.i : 'circle-help', size || 20); }
function statusLabel(s, qa) { const m = STATUS[s]; return m ? (qa ? m.qa : m.colab) : s; }
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
      { k: 'motorista_substituto', label: 'Motorista substituto', kind: 'combo', list: 'motoristas', ph: 'Nome do motorista', mesmo: true }] },
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
  { id: 'motivo_desc', sec: 'Motivo', type: 'fields',
    title: d => d.motivo === 'Outro' ? 'Descreva o motivo' : 'Quer detalhar o que aconteceu?',
    sub: d => d.motivo === 'Outro' ? 'Explique qual foi o motivo da ocorrência.' : 'Opcional. Ajuda a Qualidade a entender o problema.',
    fields: [{ k: 'descricao_motivo', label: 'Descrição do motivo', kind: 'area', ph: 'Ex.: Pneu traseiro direito furado.', optional: d => d.motivo !== 'Outro' }] },

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

function isOpt(f, d) { return typeof f.optional === 'function' ? f.optional(d) : !!f.optional; }
function screenErr(s, d) {          // devolve {k, msg} do primeiro problema da tela, ou null
  if (s.type === 'fields') {
    for (const f of s.fields) {
      if (isOpt(f, d)) continue;
      if (!String(d[f.k] || '').trim()) return { k: f.k, msg: `Preencha: ${f.label}.` };
    }
    if (s.id === 'quando') {
      if (d.data > todayISO()) return { k: 'data', msg: 'A data não pode ser no futuro.' };
      if (d.data === todayISO() && d.hora > nowHM()) return { k: 'hora', msg: 'O horário não pode ser no futuro.' };
    }
    return null;
  }
  if (['yn', 'choice', 'motivo'].includes(s.type) && !d[s.k]) return { k: s.k, msg: 'Escolha uma opção para continuar.' };
  return null;
}
function screenError(s, d) { const e = screenErr(s, d); return e ? e.msg : ''; }
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
    dir: 'fwd', sending: false, anexos: [], anexosExistentes: opts.anexosExistentes || [], token: 0, err: null };
  state.route = 'wizard'; state.sheet = null; state.modal = null;
  render();
}
function wizGo(id, dir) { state.wiz.err = null; state.wiz.current = id; state.wiz.dir = dir || 'fwd'; state.wiz.token++; saveDraft(); render(); window.scrollTo && window.scrollTo(0, 0); }
function wizNext(fromAuto) {
  const w = state.wiz; if (!w) return;
  const vis = visibleFlow(w.data); const idx = vis.findIndex(s => s.id === w.current); const scr = vis[idx];
  const err = scr ? screenErr(scr, w.data) : null;
  if (err) { if (!fromAuto) { w.err = err; render(); toast(err.msg, 'error'); } return; }
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
  w.data[k] = v; w.err = null; pruneHidden(w.data); saveDraft();
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
    { t: 'Motivo', step: 'motivo', rows: rows([['Motivo', o.motivo],
      o.descricao_motivo ? ['Descrição', o.descricao_motivo] : ['', ''],
    ]) },
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
        <li>Crie uma planilha no Google Sheets e abra <b>Extensões &gt; Apps Script</b>.</li>
        <li>Cole o conteúdo do arquivo <b>Code.gs</b>, execute a função <code>configurar</code> e publique como <b>App da Web</b>.</li>
        <li>Copie a URL gerada (termina com <code>/exec</code>) e cole em <code>API_URL</code>, na linha 7 do arquivo <code>script.js</code>. Depois publique de novo.</li>
      </ol></section></main>`;
}
function renderLoading() { return `<main class="center-screen">${SWOOSH}<div class="loader-wrap">${LOGO}<div class="spinner"></div><p class="muted">Carregando…</p></div></main>`; }

function renderLogin() {
  const last = state.loginMat || lsGet('univale_last_matricula', '') || '';
  return `<main class="center-screen">${SWOOSH}
    <section class="card auth-card">
      <div class="auth-logo">${LOGO}</div>
      <h1>Registro de Ocorrências</h1>
      <p class="muted">Entre com sua matrícula e sua senha.</p>
      <label class="lbl" for="lg-m">Matrícula</label>
      <input id="lg-m" class="inp" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(last)}" placeholder="Sua matrícula" />
      <label class="lbl" for="lg-p">Senha</label>
      <div class="pin-wrap"><input id="lg-p" class="inp" type="password" autocomplete="current-password" placeholder="Sua senha" />
        <button type="button" class="eye" data-action="togglePin" data-for="lg-p" aria-label="Mostrar senha">${ic('eye', 20)}</button></div>
      ${state.loginError ? `<div class="alert err" role="alert">${esc(state.loginError)}</div>` : ''}
      <button class="btn btn-primary btn-lg btn-block" data-action="login" ${state.loginBusy ? 'disabled' : ''}>${state.loginBusy ? '<span class="spinner sm"></span> Entrando…' : 'Entrar'}</button>
      <p class="tiny muted center">Primeiro acesso? Digite sua matrícula também no campo senha. Em seguida você cria uma nova senha.</p>
      <p class="tiny muted center">Esqueceu a senha? Procure a Qualidade para redefinir.</p>
    </section></main>`;
}
function renderNewPass() {
  const nome = state.user ? state.user.nome.split(' ')[0] : '';
  return `<main class="center-screen">${SWOOSH}
    <section class="card auth-card">
      <div class="auth-logo">${LOGO}</div>
      <h1>Crie sua senha</h1>
      <p class="muted">Olá, ${esc(nome)}! Este é seu primeiro acesso. Escolha uma senha só sua, com pelo menos 6 caracteres.</p>
      <label class="lbl" for="np1">Nova senha</label>
      <div class="pin-wrap"><input id="np1" class="inp" type="password" autocomplete="new-password" placeholder="Mínimo de 6 caracteres" />
        <button type="button" class="eye" data-action="togglePin" data-for="np1,np2" aria-label="Mostrar senha">${ic('eye', 20)}</button></div>
      <label class="lbl" for="np2">Repita a nova senha</label>
      <input id="np2" class="inp" type="password" autocomplete="new-password" placeholder="Digite de novo" />
      ${state.passError ? `<div class="alert err" role="alert">${esc(state.passError)}</div>` : ''}
      <button class="btn btn-primary btn-lg btn-block" data-action="savePass" ${state.passBusy ? 'disabled' : ''}>${state.passBusy ? '<span class="spinner sm"></span> Salvando…' : 'Salvar senha e entrar'}</button>
      <button class="btn btn-text btn-block" data-action="logout">Cancelar</button>
    </section></main>`;
}

/* ---------- Colaborador: casca (menu lateral no desktop, abas no celular) ---------- */
const SECOES = [
  { n: 'Identificação', i: 'id-card' }, { n: 'Impacto', i: 'users' }, { n: 'Substituição', i: 'repeat' },
  { n: 'Manutenção', i: 'wrench' }, { n: 'Retorno', i: 'route' }, { n: 'Motivo', i: 'clipboard-list' }, { n: 'Fechamento', i: 'file-check' }
];
function secIcon(n) { const x = SECOES.find(z => z.n === n); return x ? x.i : 'circle-help'; }
function myOccs() { return sortRecent(state.occs); }
function pendingOutbox() { return state.outbox.filter(x => state.user && x.matricula === state.user.matricula); }

function cside(active) {
  const item = (id, icon, label, act) => `<button class="nav ${active === id ? 'on' : ''}" data-action="${act}">${ic(icon, 20)}<em>${label}</em></button>`;
  return `<aside class="qa-side cside"><div class="qa-brand">${LOGO}</div>
    <button class="btn btn-primary btn-block cside-cta" data-action="novaOcorrencia">${ic('plus', 20)} Nova ocorrência</button>
    <nav>${item('home', 'house', 'Início', 'goHome')}${item('minhas', 'clipboard-list', 'Minhas ocorrências', 'goMinhas')}</nav>
    <div class="qa-user"><span class="avatar-sm">${esc(initials(state.user.nome))}</span><div><b>${esc(state.user.nome)}</b><small>Matrícula ${esc(state.user.matricula)}</small></div>
    <button class="icon-btn" data-action="logout" title="Sair" aria-label="Sair">${ic('log-out', 16)}</button></div></aside>`;
}
function tabbar(active) {
  return `<nav class="tabbar" aria-label="Navegação">
    <button class="tab ${active === 'home' ? 'on' : ''}" data-action="goHome"><span class="ti">${ic('house', 22)}</span>Início</button>
    <button class="tab fab" data-action="novaOcorrencia" aria-label="Nova ocorrência"><span>${ic('plus', 30)}</span></button>
    <button class="tab ${active === 'minhas' ? 'on' : ''}" data-action="goMinhas"><span class="ti">${ic('clipboard-list', 22)}</span>Minhas</button>
  </nav>`;
}
function topbar() {
  return `<header class="topbar">${LOGO}
    <button class="avatar-btn" data-action="openPerfil" aria-label="Perfil e sair">${esc(initials(state.user.nome))}</button></header>`;
}
const SHORT = { aguardando_lancamento: 'Aguardando', em_analise: 'Em análise', correcao_solicitada: 'Corrigir', validada: 'Validada', encerrada: 'Encerrada' };
function pillShort(s) { const m = STATUS[s] || { tone: 'gray' }; return `<span class="pill tone-${m.tone}"><i></i>${esc(SHORT[s] || s)}</span>`; }
function occItem(o) {
  return `<button class="occ" data-action="openSheet" data-id="${esc(o.protocolo)}">
    <span class="occ-ic">${motivoIcon(o.motivo, 22)}</span>
    <span class="occ-main"><b>${esc(o.protocolo)}</b><small>Veículo ${esc(o.veiculo)} · ${fmtDate(o.data)} ${esc(o.hora)}</small></span>
    ${pillShort(o.status)}</button>`;
}
function outboxItem(x) {
  return `<div class="occ pending"><span class="occ-ic">${ic('upload', 22)}</span><span class="occ-main"><b>${x.erro ? 'Não foi possível enviar' : 'Aguardando envio'}</b>
    <small>Veículo ${esc(x.dados.veiculo)} · ${fmtDate(x.dados.data)} ${esc(x.dados.hora)}${x.erro ? ' · ' + esc(x.erro) : ''}</small></span>
    ${x.erro ? `<button class="btn btn-ghost btn-sm" data-action="dropOutbox" data-id="${esc(x.client_id)}">Descartar</button>` : `<span class="pill tone-amber">${ic('cloud-off', 13)} Sem sinal</span>`}</div>`;
}
function emptyBox(icon, text) { return `<div class="empty"><span>${ic(icon, 32)}</span>${text}</div>`; }

function renderHome() {
  const mine = myOccs();
  const andamento = mine.filter(o => ['aguardando_lancamento', 'em_analise'].includes(o.status)).length;
  const corrigir = mine.filter(o => o.status === 'correcao_solicitada');
  const ok = mine.filter(o => CONCLUIDAS.includes(o.status)).length;
  const ob = pendingOutbox(); const d = state.draftInfo;
  return `<div class="cshell">${cside('home')}<div class="cmain">${topbar()}
    <main class="content">
      ${d ? `<section class="banner info"><span class="b-ic">${ic('pencil', 20)}</span><div><b>Registro em andamento</b><small>Você parou no meio de uma ocorrência (${esc(d.data.veiculo || 'sem veículo')}).</small></div>
        <div class="banner-actions"><button class="btn btn-ghost btn-sm" data-action="discardDraft">Descartar</button><button class="btn btn-primary btn-sm" data-action="resumeDraft">Continuar</button></div></section>` : ''}
      ${corrigir.length ? `<section class="banner warn"><span class="b-ic">${ic('triangle-alert', 20)}</span><div><b>${corrigir.length === 1 ? '1 ocorrência precisa de correção' : corrigir.length + ' ocorrências precisam de correção'}</b>
        <small>A Qualidade pediu um ajuste.</small></div><button class="btn btn-primary btn-sm" data-action="openSheet" data-id="${esc(corrigir[0].protocolo)}">Ver</button></section>` : ''}
      <div class="home-grid">
        <section class="hero card">${SWOOSH}
          <p class="eyebrow">Olá, ${esc(state.user.nome.split(' ')[0])}</p>
          <h1>Aconteceu algo com um veículo?</h1>
          <p class="muted">Registre em poucos toques. Só perguntamos o que é necessário.</p>
          <button class="btn btn-primary btn-lg" data-action="novaOcorrencia">${ic('plus', 22)} Nova ocorrência</button>
        </section>
        <section class="tiles">
          <div class="tile"><span class="t-ic">${ic('hourglass', 20)}</span><b>${andamento}</b><span>Em andamento</span></div>
          <div class="tile ${corrigir.length ? 'alert' : ''}"><span class="t-ic">${ic('pencil', 20)}</span><b>${corrigir.length}</b><span>Para corrigir</span></div>
          <div class="tile"><span class="t-ic">${ic('circle-check', 20)}</span><b>${ok}</b><span>Concluídas</span></div>
        </section>
      </div>
      <h2 class="sec-title">Últimas ocorrências <button class="link" data-action="goMinhas">Ver todas</button></h2>
      <div class="list">${ob.map(outboxItem).join('')}${mine.slice(0, 6).map(occItem).join('') || (ob.length ? '' : emptyBox('inbox', 'Você ainda não registrou nenhuma ocorrência.'))}</div>
    </main>${tabbar('home')}</div></div>`;
}

function renderMinhas() {
  const f = state.minhasFiltro; let list = myOccs();
  if (f === 'andamento') list = list.filter(o => ['aguardando_lancamento', 'em_analise'].includes(o.status));
  if (f === 'corrigir') list = list.filter(o => o.status === 'correcao_solicitada');
  if (f === 'concluidas') list = list.filter(o => CONCLUIDAS.includes(o.status));
  const chip = (id, t) => `<button class="chip ${f === id ? 'on' : ''}" data-action="setMinhasFiltro" data-v="${id}">${t}</button>`;
  return `<div class="cshell">${cside('minhas')}<div class="cmain">${topbar()}
    <main class="content"><h1 class="page-title">Minhas ocorrências</h1>
      <div class="chips">${chip('todas', 'Todas')}${chip('andamento', 'Em andamento')}${chip('corrigir', 'Para corrigir')}${chip('concluidas', 'Concluídas')}</div>
      <div class="list">${pendingOutbox().map(outboxItem).join('')}${list.map(occItem).join('') || emptyBox('search', 'Nenhuma ocorrência aqui.')}</div>
    </main>${tabbar('minhas')}</div></div>`;
}

/* ---------- Colaborador: assistente de perguntas ---------- */
function datalists() {
  return ['veiculos', 'motoristas', 'linhas'].map(k => `<datalist id="dl-${k}">${(state.listas[k] || []).map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist>`).join('');
}
function errMsg(k) { const e = state.wiz && state.wiz.err; return e && e.k === k ? `<p class="err-msg" role="alert">${ic('triangle-alert', 15)} ${esc(e.msg)}</p>` : ''; }
function fieldHtml(f, d) {
  const v = d[f.k] || '';
  const bad = state.wiz && state.wiz.err && state.wiz.err.k === f.k ? ' bad' : '';
  const lbl = `<label class="lbl" for="f-${f.k}">${esc(f.label)}</label>`;
  const em = errMsg(f.k);
  if (f.kind === 'pills') {
    const list = state.listas[f.list] || [];
    if (list.length) return `<div class="field">${lbl.replace(/ for="[^"]*"/, '')}<div class="pills">${list.map(x => `<button type="button" class="pillbtn ${v === x ? 'on' : ''}" data-action="pick" data-k="${f.k}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>${em}</div>`;
    return `<div class="field">${lbl}<input id="f-${f.k}" class="inp${bad}" data-bind="${f.k}" value="${esc(v)}" placeholder="${esc(f.ph || '')}" autocomplete="off" />${em}</div>`;
  }
  if (f.kind === 'area') return `<div class="field">${lbl}<textarea id="f-${f.k}" class="inp area${bad}" data-bind="${f.k}" placeholder="${esc(f.ph || '')}" rows="4">${esc(v)}</textarea>${em}</div>`;
  if (f.kind === 'date') return `<div class="field">${lbl}<input id="f-${f.k}" class="inp${bad}" type="date" data-bind="${f.k}" value="${esc(v)}" max="${todayISO()}" />${em}</div>`;
  if (f.kind === 'time') return `<div class="field">${lbl}<input id="f-${f.k}" class="inp${bad}" type="time" data-bind="${f.k}" value="${esc(v)}" />${em}</div>`;
  const list = f.kind === 'combo' ? ` list="dl-${f.list}"` : '';
  const mesmo = f.mesmo && v === MESMO_MOTORISTA;
  const toggle = f.mesmo ? `<button type="button" class="togglebtn ${mesmo ? 'on' : ''}" data-action="mesmoMotorista">${ic(mesmo ? 'circle-check' : 'users', 18)} Foi o mesmo motorista (sem troca)</button>` : '';
  return `<div class="field">${lbl}${toggle}<input id="f-${f.k}" class="inp${bad}" data-bind="${f.k}" value="${esc(v)}" placeholder="${esc(f.ph || '')}" autocomplete="off"${list}${mesmo ? ' readonly' : ''} />${em}</div>`;
}
function wizSteps(vis, idx) {       // estado de cada seção: concluída / atual / a fazer
  return SECOES.map(sec => {
    const ids = vis.map((s, i) => s.sec === sec.n ? i : -1).filter(i => i >= 0);
    const first = ids[0], last = ids[ids.length - 1];
    return Object.assign({}, sec, { st: idx > last ? 'done' : idx >= first ? 'cur' : 'todo' });
  });
}
function renderWizard() {
  const w = state.wiz; const vis = visibleFlow(w.data);
  let idx = vis.findIndex(s => s.id === w.current); if (idx < 0) { idx = 0; w.current = vis[0].id; }
  const s = vis[idx]; const d = w.data; const pct = Math.max(4, Math.round((idx / (vis.length - 1)) * 100));
  const steps = wizSteps(vis, idx);
  const title = typeof s.title === 'function' ? s.title(d) : s.title, sub = typeof s.sub === 'function' ? s.sub(d) : s.sub;
  let body = '', primary = '';
  const answered = s.k && d[s.k];
  const next = (label) => `<button class="btn btn-primary btn-lg btn-primary-main" data-action="wizNext">${label || 'Continuar'} ${ic('arrow-right', 20)}</button>`;
  if (s.type === 'fields') {
    body = s.fields.map(f => fieldHtml(f, d)).join('');
    if (s.id === 'quando') body += `<button type="button" class="link" data-action="setNow">Usar data e hora de agora</button>`;
    primary = next();
  } else if (s.type === 'yn') {
    body = `<div class="yn"><button class="ynb yes ${d[s.k] === 'sim' ? 'on' : ''}" data-action="answer" data-k="${s.k}" data-v="sim"><span>${ic('check', 24)}</span>Sim</button>
      <button class="ynb no ${d[s.k] === 'nao' ? 'on' : ''}" data-action="answer" data-k="${s.k}" data-v="nao"><span>${ic('x', 24)}</span>Não</button></div>${errMsg(s.k)}`;
    if (answered) primary = next();
  } else if (s.type === 'choice') {
    body = `<div class="choices">${s.options.map(o => `<button class="choice ${d[s.k] === o ? 'on' : ''}" data-action="answer" data-k="${s.k}" data-v="${esc(o)}"><i></i>${esc(o)}</button>`).join('')}</div>${errMsg(s.k)}`;
    if (answered) primary = next();
  } else if (s.type === 'motivo') {
    body = `<div class="motivos">${MOTIVOS.map(m => `<button class="motivo ${d.motivo === m.v ? 'on' : ''}" data-action="answer" data-k="motivo" data-v="${esc(m.v)}"><span>${ic(m.i, 30)}</span>${esc(m.v).replace('/', '/<wbr>')}</button>`).join('')}</div>${errMsg('motivo')}`;
    if (answered) primary = next();
  } else if (s.type === 'obs') {
    const chips = w.anexos.map((a, i) => `<span class="file-chip">${ic(a.tipo && a.tipo.startsWith('image') ? 'image' : 'paperclip', 15)} ${esc(a.nome)}<button data-action="rmAnexo" data-i="${i}" aria-label="Remover">${ic('x', 14)}</button></span>`).join('');
    const old = w.anexosExistentes.map(a => `<a class="file-chip" href="${esc(a.url)}" target="_blank" rel="noopener">${ic('paperclip', 15)} ${esc(a.nome)}</a>`).join('');
    body = `<div class="field"><textarea id="f-observacoes" class="inp area" data-bind="observacoes" rows="5" placeholder="Informe outras informações relevantes sobre a ocorrência.">${esc(d.observacoes)}</textarea></div>
      <div class="attach"><button type="button" class="attach-btn" data-action="pickFoto"><span>${ic('camera', 28)}</span>Adicionar foto</button>
      <button type="button" class="attach-btn" data-action="pickDoc"><span>${ic('paperclip', 28)}</span>Adicionar arquivo</button></div>
      <div class="file-chips">${old}${chips}</div><p class="tiny muted">Até ${CFG.MAX_ANEXOS || 5} anexos de ${CFG.MAX_ANEXO_MB || 6} MB. Fotos são reduzidas automaticamente.</p>`;
    primary = next('Revisar');
  } else if (s.type === 'review') {
    body = sections(d).map(sec => `<section class="rv"><header><h3>${sec.t}</h3><button class="link" data-action="editStep" data-id="${sec.step}">${ic('pencil', 14)} Editar</button></header>${rowsHtml(sec.rows)}${w.anexos.length && sec.t === 'Observações' ? `<div class="kv"><span>Anexos</span><b>${w.anexos.length} arquivo(s)</b></div>` : ''}</section>`).join('');
    primary = `<button class="btn btn-primary btn-lg btn-primary-main" data-action="submit" ${w.sending ? 'disabled' : ''}>${w.sending ? '<span class="spinner sm"></span> Enviando…' : `${ic('send', 20)} ${w.editing ? 'Reenviar correção' : 'Enviar ocorrência'}`}</button>`;
  }
  const segs = steps.map(x => `<i class="seg ${x.st}" title="${esc(x.n)}"></i>`).join('');
  const vsteps = steps.map(x => `<li class="vs ${x.st}"><span class="vdot">${ic(x.st === 'done' ? 'check' : x.i, 16)}</span><b>${esc(x.n)}</b></li>`).join('');
  return `<div class="wshell wiz">
    <aside class="wside"><div class="qa-brand">${LOGO}</div>
      <h2>${w.editing ? 'Corrigir ocorrência' : 'Nova ocorrência'}</h2><p class="muted">Etapa ${idx + 1} de ${vis.length}</p>
      <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <ol class="vsteps">${vsteps}</ol><button class="link wside-exit" data-action="wizExit">${ic('x', 14)} Salvar e sair</button></aside>
    <section class="wmain">
      <header class="wiz-top"><button class="icon-btn" data-action="wizBack" aria-label="Voltar">${ic('chevron-left', 22)}</button>
        <div class="wiz-meta"><span class="eyebrow">${ic(secIcon(s.sec), 14)} ${esc(s.sec)}</span><small>Etapa ${idx + 1} de ${vis.length}</small></div>
        <button class="icon-btn" data-action="wizExit" aria-label="Salvar e sair">${ic('x', 20)}</button></header>
      <div class="segs" aria-hidden="true">${segs}</div>
      ${w.editing ? `<div class="edit-note">${ic('pencil', 15)} Corrigindo ${esc(w.editing)}</div>` : ''}
      <div class="wcard"><main class="wiz-body ${w.dir === 'back' ? 'in-back' : 'in-fwd'}" id="wiz-body"><h1 class="q">${esc(title)}</h1>${sub ? `<p class="muted q-sub">${esc(sub)}</p>` : ''}${body}</main>
        <footer class="wiz-foot ${primary ? '' : 'nomain'}"><button class="btn btn-ghost btn-lg btn-back" data-action="wizBack">${ic('chevron-left', 20)} Voltar</button>${primary}</footer></div>
    </section>${datalists()}</div>`;
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
  return `<section class="rv"><header><h3>Anexos</h3></header><div class="file-chips pad">${a.map(x => `<a class="file-chip" href="${esc(x.url)}" target="_blank" rel="noopener">${ic('paperclip', 15)} ${esc(x.nome)}</a>`).join('')}</div></section>`;
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
      <button class="icon-btn" data-action="closeOverlay" aria-label="Fechar">${ic('x', 20)}</button></header>
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
  else if (state.boot === 'newpass' && state.user) html = renderNewPass();
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
      const bad = state.wiz.err && document.getElementById('f-' + state.wiz.err.k);
      const first = bad || s.fields.map(f => document.getElementById('f-' + f.k)).find(el => el && !el.value && !el.readOnly);
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
  togglePin(ds, btn) {
    let show = false;
    String(ds.for || 'lg-p').split(',').forEach(id => { const i = document.getElementById(id); if (i) { i.type = i.type === 'password' ? 'text' : 'password'; show = i.type === 'text'; } });
    if (btn) btn.innerHTML = ic(show ? 'eye-off' : 'eye', 20);
  },
  mesmoMotorista() { const w = state.wiz; w.data.motorista_substituto = w.data.motorista_substituto === MESMO_MOTORISTA ? '' : MESMO_MOTORISTA; w.err = null; saveDraft(); render(); },
  async login() {
    if (state.loginBusy) return;
    const m = (document.getElementById('lg-m') || {}).value || '', p = (document.getElementById('lg-p') || {}).value || '';
    state.loginMat = m.trim();   // não perde a matrícula digitada se errar a senha
    if (!m.trim() || !p.trim()) { state.loginError = 'Informe matrícula e senha.'; return render(); }
    state.loginBusy = true; state.loginError = ''; render();
    const r = await API.call('login', { matricula: m.trim(), senha: p.trim() });
    state.loginBusy = false;
    if (!r.ok) { state.loginError = r.message || 'Não foi possível entrar.'; return render(); }
    lsSet('univale_last_matricula', m.trim());
    if (r.data.primeiroAcesso) {            // 1º acesso: precisa criar a própria senha
      API.Auth.set({ token: r.data.token, user: r.data.user });
      state.user = r.data.user; state.passError = ''; state.boot = 'newpass'; return render();
    }
    enterApp(r.data);
  },
  async savePass() {
    if (state.passBusy) return;
    const a = (document.getElementById('np1') || {}).value || '', b = (document.getElementById('np2') || {}).value || '';
    const fail = m => { state.passError = m; render(); };
    if (a.length < 6) return fail('A senha precisa ter pelo menos 6 caracteres.');
    if (a !== b) return fail('As duas senhas não são iguais.');
    if (a.toLowerCase() === String(state.user.matricula).toLowerCase()) return fail('A nova senha não pode ser igual à matrícula.');
    state.passBusy = true; state.passError = ''; render();
    const r = await API.call('definirSenha', { nova: a });
    state.passBusy = false;
    if (!r.ok) { if (r.code === 'AUTH') return doLogout(r.message); return fail(r.message || 'Não foi possível salvar a senha.'); }
    toast('Senha criada! Bem-vindo(a).');
    enterApp(r.data);
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

function enterApp(data) {
  applySession(data); loadOutbox(); state.boot = 'app'; state.route = 'home';
  state.qa.view = 'dashboard'; render(); startPolling(); flushOutbox();
}

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
  if (t.dataset && t.dataset.bind && state.wiz) {
    state.wiz.data[t.dataset.bind] = t.value; saveDraftSoon();
    if (state.wiz.err && state.wiz.err.k === t.dataset.bind) { state.wiz.err = null; t.classList.remove('bad'); const m = t.parentNode.querySelector('.err-msg'); if (m) m.remove(); }
    return;
  }
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
    if (t.id === 'np1' || t.id === 'np2') { e.preventDefault(); ACTIONS.savePass(); return; }
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
  else if (r.code === 'FIRST_ACCESS') { state.boot = 'newpass'; state.passError = ''; render(); }
  else if (r.code === 'AUTH') doLogout(r.message);
  else { toast('Sem conexão: mostrando os últimos dados salvos.'); startPolling(); }
}
document.addEventListener('DOMContentLoaded', init);

/* =========================================================
   UNIVALE · Ocorrências — área da Qualidade / Controlador
   (usa funções e estado definidos em script.js)
   ========================================================= */

const QA_NAV = [
  ['dashboard', 'layout-dashboard', 'Dashboard'], ['ocorrencias', 'clipboard-list', 'Ocorrências'], ['pendencias', 'hourglass', 'Pendências'],
  ['historico', 'history', 'Histórico'], ['relatorios', 'chart-column', 'Relatórios']
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
  if (!list.length) return `<div class="empty"><span>${ic('inbox', 32)}</span>${opts.empty || 'Nenhuma ocorrência encontrada.'}</div>`;
  const cp = opts.compact ? ' class="cp"' : '';
  const rows = list.map(o => `<tr tabindex="0" role="button" data-action="qaOpen" data-id="${esc(o.protocolo)}">
    <td data-l="Protocolo"><b class="mono">${esc(o.protocolo)}</b></td>
    <td data-l="Quando">${fmtDate(o.data)} <small>${esc(o.hora)}</small></td>
    <td data-l="Veículo">${esc(o.veiculo)}</td>
    <td data-l="Setor · Linha">${esc(o.setor)}<small>${esc(o.linha)}</small></td>
    <td data-l="Motivo"><span class="mi">${motivoIcon(o.motivo, 16)}</span> ${esc(o.motivo)}</td>
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
      <section class="panel"><header><h2>Precisa de atenção <small>aguardando nº do socorro</small></h2></header>${qaTable(aguard.slice(0, 6), { compact: true, empty: 'Tudo em dia: nenhuma ocorrência aguardando lançamento.' })}
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
  return `<section class="panel"><div class="toolbar"><div class="search"><span>${ic('search', 16)}</span><input id="qa-q" data-filter="q" value="${esc(state.qa.f.q)}" placeholder="Buscar protocolo, veículo, motorista, nº do socorro, local…" autocomplete="off"></div>
    <button class="btn btn-ghost" data-action="qaToggleFilters">${ic('sliders-horizontal', 16)} Filtros${n ? ` <span class="badge">${n}</span>` : ''}</button>
    <button class="btn btn-ghost" data-action="qaExport">${ic('download', 16)} Exportar CSV</button></div>
    ${state.qa.showFilters ? qaFiltersPanel() : ''}<div id="qa-results">${qaResults()}</div></section>`;
}
function qaPendencias() {
  const g = s => state.occs.filter(o => o.status === s).sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
  const block = (t, sub, list, empty) => `<section class="panel"><header><h2>${t} <small>${sub}</small></h2><span class="count">${list.length}</span></header>${qaTable(list, { empty })}</section>`;
  return block('Aguardando nº do socorro', 'lance no sistema corporativo e vincule o número', g('aguardando_lancamento'), 'Nenhuma ocorrência aguardando lançamento.') +
    block('Em análise', 'socorro vinculado — falta validar', g('em_analise'), 'Nada aguardando validação.') +
    block('Correção solicitada', 'aguardando o colaborador', g('correcao_solicitada'), 'Nenhuma correção pendente.');
}
function qaHistorico() {
  const ev = qaEvents(150); if (!ev.length) return `<div class="empty"><span>${ic('history', 32)}</span>Ainda não há atividade registrada.</div>`;
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
    <button class="btn btn-primary" data-action="qaExportRel">${ic('download', 16)} Exportar período (.csv)</button></div>
    <div class="stats">${stat('Ocorrências', s.n)}${stat('Com passageiros', s.pass)}${stat('Com baldeio', s.bald)}${stat('Impacto no horário', s.imp)}${stat('Com substituição', s.subst)}${stat('Com remoção', s.rem)}${stat('Tempo até lançar o socorro', s.media)}</div></section>
    <div class="grid2"><div class="col"><section class="panel"><header><h2>Por motivo</h2></header><div class="pad">${bars(countBy(list, o => o.motivo))}</div></section>
      <section class="panel"><header><h2>Por setor</h2></header><div class="pad">${bars(countBy(list, o => o.setor))}</div></section></div>
    <div class="col"><section class="panel"><header><h2>Linhas com mais ocorrências</h2></header><div class="pad">${bars(countBy(list, o => o.linha).slice(0, 8))}</div></section>
      <section class="panel"><header><h2>Veículos reincidentes <small>mais ocorrências</small></h2></header><div class="pad">${bars(countBy(list, o => o.veiculo).slice(0, 8))}</div></section></div></div>`;
}

function renderQualidade() {
  const v = state.qa.view; const pend = state.occs.filter(o => o.status === 'aguardando_lancamento').length;
  const navBtn = (n, cls) => `<button class="${cls} ${v === n[0] ? 'on' : ''}" data-action="qaNav" data-v="${n[0]}"><span class="ti">${ic(n[1], 20)}</span><em>${n[2]}</em>${n[0] === 'pendencias' && pend ? `<i class="nb">${pend}</i>` : ''}</button>`;
  const content = v === 'dashboard' ? qaDashboard() : v === 'ocorrencias' ? qaOcorrencias() : v === 'pendencias' ? qaPendencias() : v === 'historico' ? qaHistorico() : qaRelatorios();
  const sync = state.lastSync ? `Atualizado há ${ago(new Date(state.lastSync).toISOString())}` : '';
  return `<div class="qa"><aside class="qa-side"><div class="qa-brand">${LOGO}</div>
      <nav>${QA_NAV.map(n => navBtn(n, 'nav')).join('')}</nav>
      <div class="qa-user"><span class="avatar-sm">${esc(initials(state.user.nome))}</span><div><b>${esc(state.user.nome)}</b><small>Qualidade</small></div>
      <button class="icon-btn" data-action="logout" title="Sair" aria-label="Sair">${ic('log-out', 16)}</button></div></aside>
    <div class="qa-main"><header class="qa-top"><div class="qa-top-l"><span class="qa-mlogo">${LOGO}</span><h1>${QA_TITLES[v]}</h1></div>
      <div class="qa-top-r"><small class="muted sync">${sync}</small><button class="btn btn-ghost btn-sm ${state.syncing ? 'spin' : ''}" data-action="refreshNow">${ic('refresh-cw', 16)} Atualizar</button>
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
      <button class="icon-btn" data-action="closeOverlay" aria-label="Fechar">${ic('x', 20)}</button></header>
    <div class="drawer-body">
      <div class="row-between">${pill(o.status, true)}<small class="muted">Registrada há ${ago(o.criado_em)}</small></div>
      ${o.status === 'correcao_solicitada' ? `<div class="alert warn"><b>Aguardando correção do colaborador</b><p>${esc(o.correcao_mensagem)}</p></div>` : ''}
      <section class="socorro"><h3>Controle do socorro</h3>
        <label class="lbl-w" for="qa-soc">Nº do socorro no sistema corporativo</label>
        <input id="qa-soc" class="inp-w" data-qa="socorro" value="${esc(d.socorro)}" placeholder="Ex.: 458721" inputmode="numeric" ${enc ? 'disabled' : ''} autocomplete="off">
        <label class="lbl-w" for="qa-obs">Observação da Qualidade <em>(opcional)</em></label>
        <textarea id="qa-obs" class="inp-w area" data-qa="obs" rows="3" placeholder="Ex.: Socorro lançado no sistema corporativo." ${enc ? 'disabled' : ''}>${esc(d.obs)}</textarea>
        <button class="btn btn-white btn-block" data-action="qaVincular" ${busy || enc ? 'disabled' : ''}>${busy ? '<span class="spinner sm dark"></span>' : ''}${o.numero_socorro ? 'Salvar alterações' : 'Vincular socorro'}</button>
        ${o.numero_socorro ? `<p class="linked">${ic('circle-check', 16)} Socorro nº <b>${esc(o.numero_socorro)}</b> vinculado${o.responsavel_qualidade ? ` por <b>${esc(o.responsavel_qualidade)}</b>` : ''} em ${fmtDT(o.data_lancamento_socorro)}</p>` : ''}</section>
      <div class="actions"><button class="btn btn-primary" data-action="qaValidar" ${busy || !canValidate ? 'disabled' : ''}>${ic('check', 18)} Validar</button>
        <button class="btn btn-ghost" data-action="qaCorrecaoOpen" ${busy || enc ? 'disabled' : ''}>${ic('pencil', 18)} Solicitar correção</button>
        <button class="btn btn-ghost" data-action="qaEncerrarAsk" data-id="${esc(o.protocolo)}" ${busy || enc ? 'disabled' : ''}>${ic('archive', 18)} Encerrar</button></div>
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
  if (t.dataset.filter) { state.qa.f[t.dataset.filter] = t.value; state.qa.limit = 100; qaRefreshResults(); const b = document.querySelector('[data-action="qaToggleFilters"]'); if (b) b.innerHTML = ic('sliders-horizontal', 16) + ' Filtros' + (qaActiveFilterCount() ? ` <span class="badge">${qaActiveFilterCount()}</span>` : ''); return; }
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
