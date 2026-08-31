/* =========================================================
   UNIVALE · Registro de Ocorrência Veicular
   Protótipo front-end (localStorage simula a planilha de controle)
   ========================================================= */
'use strict';

/* ---------------------------------------------------------
   1. CONSTANTES E DADOS DE TESTE
   --------------------------------------------------------- */
const LS_KEYS = { OCC:'univale_occurrences_v1', SESSION:'univale_session_v1', SEEDED:'univale_seeded_v1' };

const USERS = [
  { id:'u1', nome:'João Silva',        papel:'colaborador', setor:'Fretamento', avatar:'JS' },
  { id:'u2', nome:'Maria Santos',      papel:'colaborador', setor:'Urbano',     avatar:'MS' },
  { id:'u3', nome:'Isabella Ferreira', papel:'qualidade', cargo:'Analista de Qualidade', avatar:'IF' },
  { id:'u4', nome:'Carlos Mendes',     papel:'qualidade', cargo:'Controlador de Frota',  avatar:'CM' },
];

const VEICULOS   = ['1234','1456','1567','1890','1102','2201'];
const MOTORISTAS = ['João da Silva','Pedro Costa','Ana Paula Souza','Roberto Alves','Fernanda Souza','Lucas Pereira','Marcos Vinícius'];
const SETORES    = ['Fretamento','Urbano','Escolar','Executivo'];
const LINHAS     = ['501 - Centro / Bairro','502 - Industrial','310 - Universitário','120 - Rodoviária','045 - Zona Sul'];

const MOTIVOS = [
  { id:'mecanica',    label:'Falha mecânica',      emoji:'⚙️' },
  { id:'eletrica',    label:'Falha elétrica',      emoji:'⚡' },
  { id:'pneu',        label:'Pneu',                emoji:'🛞' },
  { id:'ar',          label:'Ar-condicionado',     emoji:'❄️' },
  { id:'carroceria',  label:'Carroceria',          emoji:'🔧' },
  { id:'combustivel', label:'Combustível',         emoji:'⛽' },
  { id:'sistema',     label:'Sistema/equipamento', emoji:'💻' },
  { id:'outro',       label:'Outro',               emoji:'➕' },
];

const STATUS_META = {
  aguardando_lancamento: { label:'Aguardando nº do socorro', cls:'pill-amber'  },
  em_analise:            { label:'Em análise',               cls:'pill-blue'   },
  correcao_solicitada:   { label:'Correção solicitada',      cls:'pill-orange' },
  validada:              { label:'Validada',                 cls:'pill-green'  },
  encerrada:             { label:'Encerrada',                cls:'pill-gray'   },
};

const STEP_ORDER  = ['dados','passageiros','horario','substituicao','manutencao','retorno','motivo','observacoes','revisao'];
const STEP_LABELS = { dados:'Dados', passageiros:'Passageiros', horario:'Horário', substituicao:'Substituição', manutencao:'Manutenção', retorno:'Retorno', motivo:'Motivo', observacoes:'Observações', revisao:'Revisão' };

const QA_NAV = [
  { id:'dashboard',   label:'Dashboard',   ic:'📊' },
  { id:'ocorrencias', label:'Ocorrências', ic:'📋' },
  { id:'pendencias',  label:'Pendências',  ic:'⏳' },
  { id:'historico',   label:'Histórico',   ic:'🕘' },
  { id:'relatorios',  label:'Relatórios',  ic:'📈' },
];

/* ---------------------------------------------------------
   2. ESTADO GLOBAL
   --------------------------------------------------------- */
function blankOccurrenceData(){
  return {
    veiculo:'', data:'', hora:'', setor:'', linha:'', motorista:'',
    cidade:'', bairro:'', local_especifico:'',
    possui_passageiros:'', houve_baldeio:'',
    houve_impacto_horario:'', tipo_impacto:'', descricao_impacto:'',
    houve_substituicao:'', substituicao_fora_ponto_apoio:'', local_substituicao:'',
    detalhamento_substituicao:'', veiculo_substituto:'', motorista_substituto:'',
    manutencao_acionada:'', manutencao_deslocou:'',
    retorno_proprio:'', houve_remocao:'', tipo_remocao:'',
    motivo:'', descricao_motivo:'',
    observacoes:'', anexos:[],
  };
}

let state = {
  user:null,
  route:'home',
  qaView:'dashboard',
  qaFilters:{ q:'', status:'', setor:'', motivo:'' },
  wizard:{ step:0, data:blankOccurrenceData(), editingId:null },
  modal:null,
  detailId:null,
  openAccordions:{},
  lastProtocolo:null,
  lastWasEdit:false,
};

/* ---------------------------------------------------------
   3. UTILITÁRIOS
   --------------------------------------------------------- */
function esc(v){
  if(v===undefined || v===null) return '';
  return String(v).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function uid(){ return 'id'+Math.random().toString(36).slice(2,9)+Date.now().toString(36); }
function formatDateBR(d){ if(!d) return '—'; const p=d.split('-'); if(p.length!==3) return d; return `${p[2]}/${p[1]}/${p[0]}`; }
function formatDateTimeBR(iso){ if(!iso) return '—'; const dt=new Date(iso); return dt.toLocaleDateString('pt-BR')+' '+dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
function nowParts(){ const d=new Date(); return { data:d.toLocaleDateString('pt-BR'), hora:d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) }; }
function ynLabel(v){ return v==='sim' ? 'Sim' : v==='nao' ? 'Não' : '—'; }
function motivoLabel(id){ const m=MOTIVOS.find(x=>x.id===id); return m ? `${m.emoji} ${m.label}` : '—'; }
function findOccByProtocolo(p){ return getOccurrences().find(o=>o.protocolo===p); }

function toast(msg, type){
  type = type || 'success';
  const c = document.getElementById('toast-container');
  if(!c) return;
  const el = document.createElement('div');
  el.className = 'toast '+type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(()=>{ el.classList.add('leaving'); setTimeout(()=>el.remove(), 300); }, 2800);
}

/* ---------------------------------------------------------
   4. PERSISTÊNCIA (simula a planilha de controle)
   --------------------------------------------------------- */
function getOccurrences(){
  try{ return JSON.parse(localStorage.getItem(LS_KEYS.OCC)) || []; }
  catch(e){ return []; }
}
function saveOccurrences(list){
  try{ localStorage.setItem(LS_KEYS.OCC, JSON.stringify(list)); }
  catch(e){ toast('Não foi possível salvar os dados no navegador.', 'error'); }
}
function getSession(){
  try{ return JSON.parse(localStorage.getItem(LS_KEYS.SESSION)); }
  catch(e){ return null; }
}
function setSession(u){ localStorage.setItem(LS_KEYS.SESSION, JSON.stringify(u)); }
function clearSession(){ localStorage.removeItem(LS_KEYS.SESSION); }

function nextProtocol(list){
  const year = new Date().getFullYear();
  let max = 0;
  list.forEach(o=>{
    const m = /OC-(\d{4})-(\d+)/.exec(o.protocolo || '');
    if(m && +m[1]===year) max = Math.max(max, +m[2]);
  });
  return `OC-${year}-${String(max+1).padStart(5,'0')}`;
}

/* ---------------------------------------------------------
   5. DADOS DE TESTE (seed)
   --------------------------------------------------------- */
function daysAgoIso(n, hour, min){
  const d = new Date();
  d.setDate(d.getDate()-n);
  d.setHours(hour!==undefined?hour:8, min!==undefined?min:30, 0, 0);
  return d.toISOString();
}
function hist(entries){
  // entries: [acao, usuario, diasAtras, minutosOffset]
  return entries.map(e=>{
    const [acao, usuario, diasAtras, minOff] = e;
    const iso = daysAgoIso(diasAtras, 8, 30 + (minOff||0));
    const dt = new Date(iso);
    return { acao, usuario, ts:iso, data:dt.toLocaleDateString('pt-BR'), hora:dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) };
  });
}

function seedIfNeeded(){
  if(localStorage.getItem(LS_KEYS.SEEDED)) return;

  function mk(over){
    return Object.assign({
      id: uid(),
      numero_socorro:'', status:'aguardando_lancamento',
      criado_por:'João Silva', criado_em:daysAgoIso(0), atualizado_em:daysAgoIso(0),
      responsavel_qualidade:'', data_lancamento_socorro:'', observacao_qualidade:'', correcao_mensagem:'',
      historico:[],
    }, blankOccurrenceData(), over);
  }

  const list = [];

  list.push(mk({
    protocolo:'OC-2026-00121', veiculo:'1102', setor:'Fretamento', linha:'501 - Centro / Bairro',
    motorista:'Roberto Alves', data: isoDateDaysAgo(3), hora:'06:50',
    cidade:'Belo Horizonte', bairro:'Centro', local_especifico:'Rua da Bahia, 900',
    possui_passageiros:'sim', houve_baldeio:'nao', houve_impacto_horario:'nao',
    houve_substituicao:'nao', manutencao_acionada:'nao', retorno_proprio:'sim',
    motivo:'carroceria', observacoes:'Amassado na lateral direita após batida leve.',
    status:'validada', numero_socorro:'458690', responsavel_qualidade:'Isabella Ferreira',
    data_lancamento_socorro:daysAgoIso(3,9,10), criado_por:'João Silva', criado_em:daysAgoIso(3,6,55),
    historico: hist([
      ['Ocorrência registrada.','João Silva',3,0],
      ['Recebida pelo controlador.','Isabella Ferreira',3,10],
      ['Nº do socorro informado: 458690.','Isabella Ferreira',3,40],
      ['Socorro nº 458690 vinculado à ocorrência.','Isabella Ferreira',3,41],
      ['Ocorrência validada.','Isabella Ferreira',3,55],
    ]),
  }));

  list.push(mk({
    protocolo:'OC-2026-00122', veiculo:'1567', setor:'Urbano', linha:'120 - Rodoviária',
    motorista:'Ana Paula Souza', data: isoDateDaysAgo(2), hora:'07:58',
    cidade:'Belo Horizonte', bairro:'Savassi', local_especifico:'Av. Getúlio Vargas, 300',
    possui_passageiros:'sim', houve_baldeio:'sim', houve_impacto_horario:'sim', tipo_impacto:'Atraso',
    houve_substituicao:'nao', manutencao_acionada:'sim', manutencao_deslocou:'nao', retorno_proprio:'sim',
    motivo:'ar', observacoes:'Ar-condicionado parou de funcionar durante o trajeto.',
    status:'correcao_solicitada', criado_por:'Maria Santos', criado_em:daysAgoIso(2,7,50),
    correcao_mensagem:'Favor corrigir o horário informado — não confere com o painel de monitoramento.',
    historico: hist([
      ['Ocorrência registrada.','Maria Santos',2,0],
      ['Recebida pelo controlador.','Carlos Mendes',2,15],
      ['Correção solicitada: Favor corrigir o horário informado — não confere com o painel de monitoramento.','Carlos Mendes',2,30],
    ]),
  }));

  list.push(mk({
    protocolo:'OC-2026-00123', veiculo:'1890', setor:'Escolar', linha:'310 - Universitário',
    motorista:'Lucas Pereira', data: isoDateDaysAgo(1), hora:'07:41',
    cidade:'Belo Horizonte', bairro:'Pampulha', local_especifico:'Av. Antônio Carlos, 6600',
    possui_passageiros:'nao', houve_impacto_horario:'sim', tipo_impacto:'Viagem interrompida',
    houve_substituicao:'sim', substituicao_fora_ponto_apoio:'nao', veiculo_substituto:'2201', motorista_substituto:'Marcos Vinícius',
    manutencao_acionada:'sim', manutencao_deslocou:'sim', retorno_proprio:'nao', houve_remocao:'nao',
    motivo:'eletrica', observacoes:'Painel elétrico apresentou curto-circuito.',
    status:'em_analise', numero_socorro:'458701', responsavel_qualidade:'Isabella Ferreira',
    data_lancamento_socorro:daysAgoIso(1,8,20), criado_por:'João Silva', criado_em:daysAgoIso(1,7,45),
    historico: hist([
      ['Ocorrência registrada.','João Silva',1,0],
      ['Recebida pelo controlador.','Isabella Ferreira',1,12],
      ['Nº do socorro informado: 458701.','Isabella Ferreira',1,30],
      ['Socorro nº 458701 vinculado à ocorrência.','Isabella Ferreira',1,31],
    ]),
  }));

  // Ocorrência-exemplo completa (espelha o protótipo visual de referência)
  list.push(mk({
    protocolo:'OC-2026-00125', veiculo:'1234', setor:'Fretamento', linha:'501 - Centro / Bairro',
    motorista:'João da Silva', data: isoDateDaysAgo(0), hora:'08:32',
    cidade:'Belo Horizonte', bairro:'Centro', local_especifico:'Rua das Flores, 123',
    possui_passageiros:'sim', houve_baldeio:'nao',
    houve_impacto_horario:'sim', tipo_impacto:'Atraso',
    houve_substituicao:'sim', substituicao_fora_ponto_apoio:'sim',
    local_substituicao:'Ponto de ônibus da Av. Central', detalhamento_substituicao:'Substituição realizada próxima ao terminal, sem apoio da base.',
    veiculo_substituto:'5678', motorista_substituto:'Maria Aparecida',
    manutencao_acionada:'sim', manutencao_deslocou:'sim',
    retorno_proprio:'nao', houve_remocao:'sim', tipo_remocao:'Reboque',
    motivo:'mecanica', observacoes:'Veículo apresentou pane no motor durante o percurso.',
    status:'aguardando_lancamento', criado_por:'João Silva', criado_em:daysAgoIso(0,8,32),
    historico: hist([ ['Ocorrência registrada.','João Silva',0,0] ]),
  }));

  list.push(mk({
    protocolo:'OC-2026-00126', veiculo:'1456', setor:'Executivo', linha:'045 - Zona Sul',
    motorista:'Fernanda Souza', data: isoDateDaysAgo(5), hora:'17:20',
    cidade:'Belo Horizonte', bairro:'Buritis', local_especifico:'Av. Raja Gabaglia, 2000',
    possui_passageiros:'sim', houve_baldeio:'nao', houve_impacto_horario:'nao',
    houve_substituicao:'nao', manutencao_acionada:'nao', retorno_proprio:'sim',
    motivo:'sistema', observacoes:'Sistema de bilhetagem eletrônica travou.',
    status:'encerrada', numero_socorro:'458650', responsavel_qualidade:'Carlos Mendes',
    data_lancamento_socorro:daysAgoIso(5,17,45), criado_por:'Maria Santos', criado_em:daysAgoIso(5,17,25),
    historico: hist([
      ['Ocorrência registrada.','Maria Santos',5,0],
      ['Recebida pelo controlador.','Carlos Mendes',5,10],
      ['Nº do socorro informado: 458650.','Carlos Mendes',5,20],
      ['Socorro nº 458650 vinculado à ocorrência.','Carlos Mendes',5,21],
      ['Ocorrência validada.','Carlos Mendes',5,40],
      ['Ocorrência encerrada.','Carlos Mendes',5,60],
    ]),
  }));

  list.push(mk({
    protocolo:'OC-2026-00127', veiculo:'2201', setor:'Urbano', linha:'502 - Industrial',
    motorista:'Pedro Costa', data: isoDateDaysAgo(0), hora:'10:05',
    cidade:'Belo Horizonte', bairro:'Barreiro', local_especifico:'Av. Sinfrônio Brochado, 400',
    possui_passageiros:'nao', houve_impacto_horario:'nao', houve_substituicao:'nao',
    manutencao_acionada:'nao', retorno_proprio:'sim',
    motivo:'combustivel', observacoes:'',
    status:'aguardando_lancamento', criado_por:'João Silva', criado_em:daysAgoIso(0,10,5),
    historico: hist([ ['Ocorrência registrada.','João Silva',0,0] ]),
  }));

  saveOccurrences(list);
  localStorage.setItem(LS_KEYS.SEEDED, '1');
}
function isoDateDaysAgo(n){ const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }

/* ---------------------------------------------------------
   6. COMPONENTES DE FORMULÁRIO (HTML helpers)
   --------------------------------------------------------- */
function fieldWrap(label, inner, hint){
  return `<div class="field"><label>${label}</label>${inner}${hint?`<div class="hint">${hint}</div>`:''}</div>`;
}
function ynGroup(field, value){
  return `<div class="yn-group">
    <button type="button" class="yn-btn yes ${value==='sim'?'selected':''}" data-action="setField" data-field="${field}" data-value="sim">Sim</button>
    <button type="button" class="yn-btn no ${value==='nao'?'selected':''}" data-action="setField" data-field="${field}" data-value="nao">Não</button>
  </div>`;
}
function textInput(field, value, placeholder, type){
  return `<input class="input" type="${type||'text'}" data-bind="${field}" value="${esc(value)}" placeholder="${esc(placeholder||'')}" />`;
}
function textareaInput(field, value, placeholder){
  return `<textarea class="input" data-bind="${field}" placeholder="${esc(placeholder||'')}">${esc(value)}</textarea>`;
}
function selectInput(field, value, options, placeholder){
  return `<select class="select" data-bind="${field}">
    <option value="" ${!value?'selected':''} disabled>${esc(placeholder||'Selecione')}</option>
    ${options.map(o=>`<option value="${esc(o)}" ${value===o?'selected':''}>${esc(o)}</option>`).join('')}
  </select>`;
}
function radioList(field, value, options){
  return `<div class="radio-list">
    ${options.map(o=>`<div class="radio-item ${value===o?'selected':''}" data-action="selectRadio" data-field="${field}" data-value="${esc(o)}"><span class="dot"></span>${esc(o)}</div>`).join('')}
  </div>`;
}
function subWrap(visible, html){
  return `<div class="subfields" data-anim="1" data-visible="${visible?'1':'0'}">${html}</div>`;
}
function emptyState(emoji, text){
  return `<div class="empty-state"><span class="emoji">${emoji}</span>${text}</div>`;
}

/* ---------------------------------------------------------
   7. ETAPAS DO ASSISTENTE (WIZARD)
   --------------------------------------------------------- */
function renderStepDados(d){
  return `
    ${fieldWrap('Veículo', selectInput('veiculo', d.veiculo, VEICULOS, 'Selecione o veículo'))}
    <div class="row-2">
      ${fieldWrap('Data', textInput('data', d.data, '', 'date'))}
      ${fieldWrap('Horário', textInput('hora', d.hora, '', 'time'))}
    </div>
    ${fieldWrap('Setor', selectInput('setor', d.setor, SETORES, 'Selecione o setor'))}
    ${fieldWrap('Linha', selectInput('linha', d.linha, LINHAS, 'Selecione a linha'))}
    ${fieldWrap('Motorista', selectInput('motorista', d.motorista, MOTORISTAS, 'Selecione o motorista'))}
    ${fieldWrap('Cidade', textInput('cidade', d.cidade, 'Ex.: Belo Horizonte'))}
    ${fieldWrap('Bairro', textInput('bairro', d.bairro, 'Ex.: Centro'))}
    ${fieldWrap('Rua / local específico', textInput('local_especifico', d.local_especifico, 'Ex.: Rua das Flores, 123'))}
  `;
}
function renderStepPassageiros(d){
  return `
    ${fieldWrap('Havia passageiros no interior do veículo no momento da falha?', ynGroup('possui_passageiros', d.possui_passageiros))}
    ${subWrap(d.possui_passageiros==='sim', fieldWrap('Houve necessidade de baldeio?', ynGroup('houve_baldeio', d.houve_baldeio)))}
  `;
}
function renderStepHorario(d){
  const tipos = ['Atraso','Horário não cumprido','Viagem interrompida','Outro'];
  return `
    ${fieldWrap('A ocorrência ocasionou atraso ou impossibilitou o cumprimento do horário programado?', ynGroup('houve_impacto_horario', d.houve_impacto_horario))}
    ${subWrap(d.houve_impacto_horario==='sim', `
      ${fieldWrap('Qual foi o impacto?', radioList('tipo_impacto', d.tipo_impacto, tipos))}
      ${subWrap(d.tipo_impacto==='Outro', fieldWrap('Descreva o impacto', textInput('descricao_impacto', d.descricao_impacto, 'Descreva aqui')))}
    `)}
  `;
}
function renderStepSubstituicao(d){
  return `
    ${fieldWrap('Foi necessária a substituição do veículo?', ynGroup('houve_substituicao', d.houve_substituicao))}
    ${subWrap(d.houve_substituicao==='sim', `
      ${fieldWrap('A substituição ocorreu fora do ponto de apoio?', ynGroup('substituicao_fora_ponto_apoio', d.substituicao_fora_ponto_apoio))}
      <div class="row-2">
        ${fieldWrap('Veículo substituto', textInput('veiculo_substituto', d.veiculo_substituto, 'Ex.: 4521'))}
        ${fieldWrap('Motorista substituto', textInput('motorista_substituto', d.motorista_substituto, 'Nome do motorista'))}
      </div>
      ${subWrap(d.substituicao_fora_ponto_apoio==='sim', `
        ${fieldWrap('Local da substituição', textInput('local_substituicao', d.local_substituicao, 'Ex.: Av. Central, 500'))}
        ${fieldWrap('Detalhar local', textareaInput('detalhamento_substituicao', d.detalhamento_substituicao, 'Pontos de referência, condição da via, etc.'))}
      `)}
    `)}
  `;
}
function renderStepManutencao(d){
  return `
    ${fieldWrap('A equipe de Manutenção foi acionada para atendimento no local da ocorrência?', ynGroup('manutencao_acionada', d.manutencao_acionada))}
    ${subWrap(d.manutencao_acionada==='sim', fieldWrap('Houve deslocamento da equipe até o veículo?', ynGroup('manutencao_deslocou', d.manutencao_deslocou)))}
  `;
}
function renderStepRetorno(d){
  const tipos = ['Reboque','Guincho','Outro'];
  return `
    ${fieldWrap('O veículo conseguiu retornar por meios próprios?', ynGroup('retorno_proprio', d.retorno_proprio))}
    ${subWrap(d.retorno_proprio==='nao', `
      ${fieldWrap('Foi necessária remoção/reboque?', ynGroup('houve_remocao', d.houve_remocao))}
      ${subWrap(d.houve_remocao==='sim', fieldWrap('Tipo de remoção', selectInput('tipo_remocao', d.tipo_remocao, tipos, 'Selecione')))}
    `)}
  `;
}
function renderStepMotivo(d){
  return `
    <div class="motivo-grid">
      ${MOTIVOS.map(m=>`<div class="motivo-card ${d.motivo===m.id?'selected':''}" data-action="selectMotivo" data-value="${m.id}"><span class="emoji">${m.emoji}</span><span>${m.label}</span></div>`).join('')}
    </div>
    ${subWrap(d.motivo==='outro', fieldWrap('Descreva o motivo', textInput('descricao_motivo', d.descricao_motivo, 'Descreva aqui')))}
  `;
}
function renderStepObservacoes(d){
  const chips = (d.anexos||[]).map((a,i)=>`<span class="chip">${esc(a.name)} <button type="button" data-action="removeAnexo" data-index="${i}">✕</button></span>`).join('');
  return `
    ${fieldWrap('Há alguma informação complementar?', textareaInput('observacoes', d.observacoes, 'Informe outras informações relevantes sobre a ocorrência.'))}
    <div class="attach-row">
      <button type="button" class="attach-btn" data-action="addAnexo">📷 Adicionar foto</button>
      <button type="button" class="attach-btn" data-action="addAnexo">📎 Adicionar arquivo</button>
    </div>
    ${chips? `<div class="chip-list">${chips}</div>` : ''}
  `;
}
function reviewRow(label, val){
  if(val===undefined || val===null || val==='') return '';
  return `<div class="review-row"><span>${label}</span><span>${esc(val)}</span></div>`;
}
function buildReview(d){
  const blocks = [
    { title:'Dados', step:0, rows:[
      reviewRow('Veículo', d.veiculo), reviewRow('Setor', d.setor), reviewRow('Linha', d.linha),
      reviewRow('Motorista', d.motorista), reviewRow('Data', formatDateBR(d.data)), reviewRow('Horário', d.hora),
      reviewRow('Local', [d.cidade,d.bairro,d.local_especifico].filter(Boolean).join(' · ')),
    ]},
    { title:'Impacto', step:1, rows:[
      reviewRow('Passageiros', ynLabel(d.possui_passageiros)),
      d.possui_passageiros==='sim' ? reviewRow('Baldeio', ynLabel(d.houve_baldeio)) : '',
      reviewRow('Impacto no horário', ynLabel(d.houve_impacto_horario)),
      d.houve_impacto_horario==='sim' ? reviewRow('Tipo de impacto', d.tipo_impacto) : '',
    ]},
    { title:'Substituição', step:3, rows:[
      reviewRow('Necessária', ynLabel(d.houve_substituicao)),
      d.houve_substituicao==='sim' ? reviewRow('Fora do ponto de apoio', ynLabel(d.substituicao_fora_ponto_apoio)) : '',
      d.houve_substituicao==='sim' ? reviewRow('Veículo substituto', d.veiculo_substituto) : '',
      d.houve_substituicao==='sim' ? reviewRow('Motorista substituto', d.motorista_substituto) : '',
    ]},
    { title:'Manutenção', step:4, rows:[
      reviewRow('Acionada', ynLabel(d.manutencao_acionada)),
      d.manutencao_acionada==='sim' ? reviewRow('Deslocamento até o veículo', ynLabel(d.manutencao_deslocou)) : '',
    ]},
    { title:'Retorno', step:5, rows:[
      reviewRow('Retorno próprio', ynLabel(d.retorno_proprio)),
      d.retorno_proprio==='nao' ? reviewRow('Remoção/reboque', ynLabel(d.houve_remocao)) : '',
      d.houve_remocao==='sim' ? reviewRow('Tipo de remoção', d.tipo_remocao) : '',
    ]},
    { title:'Motivo', step:6, rows:[
      reviewRow('Motivo', motivoLabel(d.motivo)),
      d.motivo==='outro' ? reviewRow('Descrição', d.descricao_motivo) : '',
    ]},
    { title:'Observações', step:7, rows:[
      reviewRow('Observações', d.observacoes || '—'),
      (d.anexos && d.anexos.length) ? reviewRow('Anexos', d.anexos.map(a=>a.name).join(', ')) : '',
    ]},
  ];
  return blocks.map(b=>{
    const rows = b.rows.filter(Boolean).join('');
    return `<div class="review-block">
      <h4>${b.title} <button type="button" class="btn-text" style="float:right" data-action="wizardJump" data-step="${b.step}">Editar</button></h4>
      ${rows || '<div class="review-row"><span>Nenhuma informação</span><span></span></div>'}
    </div>`;
  }).join('');
}
function renderStepRevisao(d){ return buildReview(d); }

const STEPS = {
  dados:        { title:'Dados da ocorrência',     sub:'Vamos começar identificando o veículo e o local.',        render:renderStepDados },
  passageiros:  { title:'Impacto — Passageiros',   sub:'Isso ajuda a priorizar o atendimento correto.',            render:renderStepPassageiros },
  horario:      { title:'Impacto — Horário',       sub:'',                                                          render:renderStepHorario },
  substituicao: { title:'Substituição do veículo', sub:'',                                                          render:renderStepSubstituicao },
  manutencao:   { title:'Manutenção',              sub:'',                                                          render:renderStepManutencao },
  retorno:      { title:'Retorno / Remoção',       sub:'',                                                          render:renderStepRetorno },
  motivo:       { title:'Motivo da ocorrência',    sub:'Selecione a opção que melhor descreve o ocorrido.',        render:renderStepMotivo },
  observacoes:  { title:'Observações',             sub:'Campo opcional — inclua o que achar relevante.',           render:renderStepObservacoes },
  revisao:      { title:'Confira sua ocorrência',  sub:'Revise as informações antes de enviar. Você pode editar qualquer bloco.', render:renderStepRevisao },
};

function validateStep(key, d){
  switch(key){
    case 'dados':
      if(!d.veiculo) return 'Selecione o veículo.';
      if(!d.data) return 'Informe a data da ocorrência.';
      if(!d.hora) return 'Informe o horário da ocorrência.';
      if(!d.setor) return 'Selecione o setor.';
      if(!d.linha) return 'Selecione a linha.';
      if(!d.motorista) return 'Selecione o motorista.';
      if(!d.cidade) return 'Informe a cidade.';
      if(!d.bairro) return 'Informe o bairro.';
      if(!d.local_especifico) return 'Informe o local específico.';
      return null;
    case 'passageiros':
      if(!d.possui_passageiros) return 'Informe se havia passageiros.';
      if(d.possui_passageiros==='sim' && !d.houve_baldeio) return 'Informe se houve necessidade de baldeio.';
      return null;
    case 'horario':
      if(!d.houve_impacto_horario) return 'Informe se houve impacto no horário.';
      if(d.houve_impacto_horario==='sim' && !d.tipo_impacto) return 'Selecione o tipo de impacto.';
      if(d.tipo_impacto==='Outro' && !d.descricao_impacto) return 'Descreva o impacto.';
      return null;
    case 'substituicao':
      if(!d.houve_substituicao) return 'Informe se houve substituição do veículo.';
      if(d.houve_substituicao==='sim'){
        if(!d.substituicao_fora_ponto_apoio) return 'Informe se a substituição ocorreu fora do ponto de apoio.';
        if(!d.veiculo_substituto) return 'Informe o veículo substituto.';
        if(!d.motorista_substituto) return 'Informe o motorista substituto.';
        if(d.substituicao_fora_ponto_apoio==='sim'){
          if(!d.local_substituicao) return 'Informe o local da substituição.';
          if(!d.detalhamento_substituicao) return 'Detalhe o local da substituição.';
        }
      }
      return null;
    case 'manutencao':
      if(!d.manutencao_acionada) return 'Informe se a Manutenção foi acionada.';
      if(d.manutencao_acionada==='sim' && !d.manutencao_deslocou) return 'Informe se houve deslocamento da equipe.';
      return null;
    case 'retorno':
      if(!d.retorno_proprio) return 'Informe se o veículo retornou por meios próprios.';
      if(d.retorno_proprio==='nao'){
        if(!d.houve_remocao) return 'Informe se foi necessária remoção/reboque.';
        if(d.houve_remocao==='sim' && !d.tipo_remocao) return 'Selecione o tipo de remoção.';
      }
      return null;
    case 'motivo':
      if(!d.motivo) return 'Selecione o motivo da ocorrência.';
      if(d.motivo==='outro' && !d.descricao_motivo) return 'Descreva o motivo.';
      return null;
    default: return null;
  }
}
function validateAll(d){
  for(const k of STEP_ORDER){ const err = validateStep(k, d); if(err) return err; }
  return null;
}
function clearDependentFields(field, value){
  const d = state.wizard.data;
  if(field==='possui_passageiros' && value==='nao') d.houve_baldeio='';
  if(field==='houve_impacto_horario' && value==='nao'){ d.tipo_impacto=''; d.descricao_impacto=''; }
  if(field==='houve_substituicao' && value==='nao'){ d.substituicao_fora_ponto_apoio=''; d.veiculo_substituto=''; d.motorista_substituto=''; d.local_substituicao=''; d.detalhamento_substituicao=''; }
  if(field==='substituicao_fora_ponto_apoio' && value==='nao'){ d.local_substituicao=''; d.detalhamento_substituicao=''; }
  if(field==='manutencao_acionada' && value==='nao') d.manutencao_deslocou='';
  if(field==='retorno_proprio' && value==='sim'){ d.houve_remocao=''; d.tipo_remocao=''; }
  if(field==='houve_remocao' && value==='nao') d.tipo_remocao='';
}

/* ---------------------------------------------------------
   8. TELA: LOGIN
   --------------------------------------------------------- */
function loginUserCard(u){
  return `<div class="login-user" data-action="login" data-id="${u.id}">
    <div class="avatar">${u.avatar}</div>
    <div class="meta"><b>${esc(u.nome)}</b><span>${esc(u.cargo || u.setor || '')}</span></div>
    <div class="arrow">→</div>
  </div>`;
}
function renderLogin(){
  const colaboradores = USERS.filter(u=>u.papel==='colaborador');
  const qualidade = USERS.filter(u=>u.papel==='qualidade');
  return `<div class="login-screen">
    <div class="login-box">
      <img class="logo" src="assets/univale-logo.png" alt="Univale" />
      <h1>Registro de Ocorrência Veicular</h1>
      <p class="sub">Ambiente de testes — escolha um usuário para entrar</p>
      <div class="section-label" style="margin-top:0">Colaboradores</div>
      <div class="login-users">${colaboradores.map(loginUserCard).join('')}</div>
      <div class="section-label">Qualidade / Controle</div>
      <div class="login-users">${qualidade.map(loginUserCard).join('')}</div>
      <p class="login-note">Nenhuma senha real é necessária — protótipo para validação do fluxo. Os dados ficam salvos apenas no navegador deste dispositivo.</p>
    </div>
  </div>`;
}

/* ---------------------------------------------------------
   9. COLABORADOR: HOME / MINHAS OCORRÊNCIAS
   --------------------------------------------------------- */
function occCardColab(o){
  const meta = STATUS_META[o.status];
  return `<div class="occ-item" data-action="openColabDetail" data-id="${o.id}">
    <div class="info"><b>${o.protocolo}</b><span>Veículo ${esc(o.veiculo)} · ${formatDateBR(o.data)}</span></div>
    <span class="pill pill-dot ${meta.cls}">${meta.label}</span>
  </div>`;
}
function renderColabHome(){
  const mine = getOccurrences().filter(o=>o.criado_por===state.user.nome).sort((a,b)=>new Date(b.criado_em)-new Date(a.criado_em));
  const aguardando = mine.filter(o=>['aguardando_lancamento','em_analise'].includes(o.status)).length;
  const correcao = mine.filter(o=>o.status==='correcao_solicitada').length;
  const concluidas = mine.filter(o=>['validada','encerrada'].includes(o.status)).length;
  const recent = mine.slice(0,4);
  return `<div class="mobile-shell">
    <div class="home-hero">
      <div class="row-top">
        <img class="logo" src="assets/univale-logo.png" alt="Univale"/>
        <button class="logout-btn" data-action="logout" title="Sair">⏻</button>
      </div>
      <h1>Olá, ${esc(state.user.nome.split(' ')[0])} 👋</h1>
      <p>Registre uma ocorrência de forma rápida e simples.</p>
    </div>
    <div class="home-body">
      <div class="cta-card" data-action="novaOcorrencia">
        <div class="icon">+</div>
        <div><b>Nova ocorrência</b><span>Leva menos de 2 minutos</span></div>
      </div>
      <div class="section-label">Resumo</div>
      <div class="stat-row">
        <div class="stat-box"><b>${aguardando}</b><span>Aguardando análise</span></div>
        <div class="stat-box"><b>${correcao}</b><span>Correção solicitada</span></div>
        <div class="stat-box"><b>${concluidas}</b><span>Concluídas</span></div>
      </div>
      <div class="section-label">Minhas ocorrências <button class="btn-text" data-action="verMinhas">Ver todas</button></div>
      <div class="occ-list">${recent.length ? recent.map(occCardColab).join('') : emptyState('📋','Você ainda não registrou nenhuma ocorrência.')}</div>
    </div>
  </div>`;
}
function renderMinhasScreen(){
  const mine = getOccurrences().filter(o=>o.criado_por===state.user.nome).sort((a,b)=>new Date(b.criado_em)-new Date(a.criado_em));
  return `<div class="mobile-shell">
    <div class="wizard-header">
      <div class="wizard-topbar">
        <button class="icon-btn" data-action="goHome">←</button>
        <h2>Minhas ocorrências</h2>
      </div>
    </div>
    <div class="home-body" style="margin-top:0">
      <div class="occ-list">${mine.length ? mine.map(occCardColab).join('') : emptyState('📋','Nenhuma ocorrência encontrada.')}</div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------
   10. COLABORADOR: WIZARD
   --------------------------------------------------------- */
function renderRail(activeIdx){
  return `<div class="rail">
    ${STEP_ORDER.map((k,i)=>{
      const cls = i<activeIdx ? 'done' : i===activeIdx ? 'active' : '';
      const line = i < STEP_ORDER.length-1 ? `<div class="rail-line"><i style="width:${i<activeIdx?100:0}%"></i></div>` : '';
      return `<div class="rail-step ${cls}"><div class="rail-dot">${i<activeIdx?'✓':(i+1)}</div><span class="rail-label">${STEP_LABELS[k]}</span></div>${line}`;
    }).join('')}
  </div>`;
}
function renderWizardScreen(){
  const key = STEP_ORDER[state.wizard.step];
  const step = STEPS[key];
  const data = state.wizard.data;
  const isLast = state.wizard.step === STEP_ORDER.length-1;
  return `<div class="mobile-shell">
    <div class="wizard-header">
      <div class="wizard-topbar">
        <button class="icon-btn" data-action="wizardBack">←</button>
        <h2>${state.wizard.editingId ? 'Corrigir ocorrência' : 'Nova ocorrência'}</h2>
      </div>
      ${renderRail(state.wizard.step)}
    </div>
    <div class="step-wrap step-enter">
      <h3 class="step-title">${step.title}</h3>
      ${step.sub ? `<p class="step-sub">${step.sub}</p>` : ''}
      ${step.render(data)}
    </div>
    <div class="wizard-footer">
      ${state.wizard.step>0 ? `<button class="btn btn-ghost" data-action="wizardBack">Voltar</button>` : ''}
      <button class="btn btn-primary btn-block" data-action="${isLast?'submitOcorrencia':'wizardNext'}">${isLast?'Enviar ocorrência':'Continuar →'}</button>
    </div>
  </div>`;
}

/* ---------------------------------------------------------
   11. COLABORADOR: TELA DE SUCESSO
   --------------------------------------------------------- */
function buildConfetti(){
  const colors = ['#fff','#7FE5D3','#F5B942','#BDF3E8'];
  let out = '';
  for(let i=0;i<24;i++){
    const left = (Math.random()*100).toFixed(1);
    const delay = (Math.random()*0.6).toFixed(2);
    out += `<span style="left:${left}%;top:-10px;background:${colors[i%colors.length]};animation-delay:${delay}s;"></span>`;
  }
  return out;
}
function renderSuccessScreen(){
  const occ = findOccByProtocolo(state.lastProtocolo);
  const meta = STATUS_META[occ ? occ.status : 'aguardando_lancamento'];
  const isEdit = state.lastWasEdit;
  return `<div class="success-screen">
    <div class="confetti">${buildConfetti()}</div>
    <div class="check-wrap"><svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5L20 6" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <h1>${isEdit ? 'Ocorrência atualizada!' : 'Ocorrência registrada!'}</h1>
    <p>${isEdit ? 'Sua correção foi reenviada e já está novamente com a Qualidade.' : 'Sua ocorrência foi enviada para validação da Qualidade.'}</p>
    <div class="protocol-badge"><span>Protocolo</span><b>${state.lastProtocolo}</b></div>
    <div class="pill pill-dot" style="margin-bottom:26px;background:rgba(255,255,255,.14);color:#fff">${meta.label}</div>
    <div class="success-actions">
      <button class="btn btn-primary" data-action="verOcorrenciaSucesso">Ver ocorrência</button>
      <button class="btn btn-ghost" data-action="verMinhas">Minhas ocorrências</button>
      <button class="btn btn-ghost" data-action="novaAposSucesso">Nova ocorrência</button>
    </div>
  </div>`;
}

/* ---------------------------------------------------------
   12. COLABORADOR: dispatcher + modal de detalhe
   --------------------------------------------------------- */
function renderColaborador(){
  if(state.route==='wizard') return renderWizardScreen();
  if(state.route==='success') return renderSuccessScreen();
  if(state.route==='minhas') return renderMinhasScreen();
  return renderColabHome();
}
function modalColabDetail(id){
  const occ = getOccurrences().find(o=>o.id===id);
  if(!occ) return '';
  const meta = STATUS_META[occ.status];
  return `<div class="modal-backdrop" data-action="closeModal">
    <div class="modal-box" onclick="event.stopPropagation()">
      <h3>${occ.protocolo}</h3>
      <div class="sub">${formatDateBR(occ.data)} · ${occ.hora}</div>
      <span class="pill pill-dot ${meta.cls}" style="margin-bottom:16px;display:inline-flex">${meta.label}</span>
      ${occ.status==='correcao_solicitada' ? `<div class="deploy-note" style="background:#FCEEDD;border-color:#F0C089;color:#7A4A0B">⚠️ A Qualidade solicitou uma correção:<br><b>${esc(occ.correcao_mensagem)}</b></div>` : ''}
      ${occ.numero_socorro ? `<div class="review-row"><span>Nº do Socorro</span><span>${esc(occ.numero_socorro)}</span></div>` : ''}
      <div class="review-row"><span>Veículo</span><span>${esc(occ.veiculo)}</span></div>
      <div class="review-row"><span>Setor / Linha</span><span>${esc(occ.setor)} · ${esc(occ.linha)}</span></div>
      <div class="review-row"><span>Motorista</span><span>${esc(occ.motorista)}</span></div>
      <div class="review-row"><span>Local</span><span>${esc([occ.cidade,occ.bairro,occ.local_especifico].filter(Boolean).join(' · '))}</span></div>
      <div class="review-row"><span>Motivo</span><span>${motivoLabel(occ.motivo)}</span></div>
      <div class="section-label" style="margin-bottom:6px">Histórico</div>
      <div class="timeline">${(occ.historico||[]).map(h=>`<div class="timeline-item"><span class="tdot"></span><div><b>${esc(h.acao)}</b><div class="tmeta">${h.data} · ${h.hora} — ${esc(h.usuario)}</div></div></div>`).join('')}</div>
      <div class="modal-actions">
        ${occ.status==='correcao_solicitada'
          ? `<button class="btn btn-primary btn-block" data-action="corrigirReenviar" data-id="${occ.id}">Corrigir e reenviar</button>`
          : `<button class="btn btn-ghost btn-block" data-action="closeModal">Fechar</button>`}
      </div>
    </div>
  </div>`;
}
function modalCorrecao(id){
  const occ = getOccurrences().find(o=>o.id===id);
  return `<div class="modal-backdrop" data-action="closeModal">
    <div class="modal-box" onclick="event.stopPropagation()">
      <h3>Solicitar correção</h3>
      <div class="sub">${occ ? occ.protocolo : ''} — descreva o que o colaborador precisa corrigir.</div>
      <div class="field"><textarea class="input" id="correcao-texto" placeholder="Ex.: Favor corrigir o local da ocorrência."></textarea></div>
      <div class="modal-actions">
        <button class="btn btn-ghost btn-block" data-action="closeModal">Cancelar</button>
        <button class="btn btn-primary btn-block" data-action="confirmarCorrecao" data-id="${id}">Confirmar</button>
      </div>
    </div>
  </div>`;
}
function renderModal(){
  const layer = document.getElementById('modal-layer');
  if(!layer) return;
  if(!state.modal){ layer.innerHTML = ''; return; }
  if(state.modal.type==='colabDetail') layer.innerHTML = modalColabDetail(state.modal.id);
  else if(state.modal.type==='correcao') layer.innerHTML = modalCorrecao(state.modal.id);
}

/* ---------------------------------------------------------
   13. QUALIDADE: dashboard, listas, filtros
   --------------------------------------------------------- */
function countBy(list, status){ return list.filter(o=>o.status===status).length; }
function filterOccurrences(list){
  const f = state.qaFilters;
  return list.filter(o=>{
    if(f.q){
      const q = f.q.toLowerCase();
      const hay = `${o.protocolo} ${o.veiculo} ${o.motorista}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    if(f.status && o.status!==f.status) return false;
    if(f.setor && o.setor!==f.setor) return false;
    if(f.motivo && o.motivo!==f.motivo) return false;
    return true;
  }).sort((a,b)=>new Date(b.criado_em)-new Date(a.criado_em));
}
function buildTable(list){
  if(!list.length) return `<div class="empty-cell">Nenhuma ocorrência encontrada.</div>`;
  return `<table class="data-table">
    <thead><tr><th>Protocolo</th><th>Data/Hora</th><th>Veículo</th><th>Setor</th><th>Motivo</th><th>Nº Socorro</th><th>Status</th></tr></thead>
    <tbody>
      ${list.map(o=>{
        const meta = STATUS_META[o.status];
        return `<tr data-action="qaOpenDetail" data-id="${o.id}">
          <td class="mono">${o.protocolo}</td>
          <td>${formatDateBR(o.data)} ${o.hora||''}</td>
          <td>${esc(o.veiculo)}</td>
          <td>${esc(o.setor)}</td>
          <td>${motivoLabel(o.motivo)}</td>
          <td class="mono">${o.numero_socorro || '—'}</td>
          <td><span class="pill pill-dot ${meta.cls}">${meta.label}</span></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}
function renderQaDashboard(){
  const list = getOccurrences();
  const recent = [...list].sort((a,b)=>new Date(b.criado_em)-new Date(a.criado_em)).slice(0,6);
  return `
    <div class="kpi-grid">
      <div class="kpi-card"><b>${countBy(list,'aguardando_lancamento')}</b><span>Aguardando nº do socorro</span></div>
      <div class="kpi-card"><b>${countBy(list,'em_analise')}</b><span>Em análise</span></div>
      <div class="kpi-card"><b>${countBy(list,'correcao_solicitada')}</b><span>Correção solicitada</span></div>
      <div class="kpi-card"><b>${countBy(list,'validada')+countBy(list,'encerrada')}</b><span>Concluídas</span></div>
      <div class="kpi-card total"><b>${list.length}</b><span>Total</span></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Ocorrências recentes</h3><button class="btn-text" data-action="qaNav" data-view="ocorrencias">Ver todas</button></div>
      ${buildTable(recent)}
    </div>`;
}
function renderQaOcorrencias(){
  const filtered = filterOccurrences(getOccurrences());
  return `<div class="panel">
    <div class="panel-head"><h3>Todas as ocorrências (${filtered.length})</h3><button class="btn btn-sm btn-ghost" data-action="exportCsv">⬇ Exportar planilha (.csv)</button></div>
    <div class="filters-bar">
      <input class="grow" type="text" id="qa-search-input" placeholder="Buscar por protocolo, veículo ou motorista..." value="${esc(state.qaFilters.q)}"/>
      <select data-filter="status"><option value="">Status: todos</option>${Object.entries(STATUS_META).map(([k,v])=>`<option value="${k}" ${state.qaFilters.status===k?'selected':''}>${v.label}</option>`).join('')}</select>
      <select data-filter="setor"><option value="">Setor: todos</option>${SETORES.map(s=>`<option value="${s}" ${state.qaFilters.setor===s?'selected':''}>${s}</option>`).join('')}</select>
      <select data-filter="motivo"><option value="">Motivo: todos</option>${MOTIVOS.map(m=>`<option value="${m.id}" ${state.qaFilters.motivo===m.id?'selected':''}>${m.label}</option>`).join('')}</select>
      <button class="btn btn-sm btn-ghost" data-action="clearFilters">Limpar</button>
    </div>
    <div id="qa-rows-slot">${buildTable(filtered)}</div>
  </div>`;
}
function updateQaRows(){
  const slot = document.getElementById('qa-rows-slot');
  if(!slot) return;
  slot.innerHTML = buildTable(filterOccurrences(getOccurrences()));
}
function renderQaPendencias(){
  const list = getOccurrences().filter(o=>['aguardando_lancamento','correcao_solicitada'].includes(o.status)).sort((a,b)=>new Date(a.criado_em)-new Date(b.criado_em));
  return `<div class="panel"><div class="panel-head"><h3>Pendências (${list.length})</h3></div>${buildTable(list)}</div>`;
}
function renderQaHistorico(){
  const list = getOccurrences();
  let events = [];
  list.forEach(o=>(o.historico||[]).forEach(h=>events.push(Object.assign({}, h, { protocolo:o.protocolo, id:o.id }))));
  events.sort((a,b)=>new Date(b.ts||0)-new Date(a.ts||0));
  events = events.slice(0,60);
  if(!events.length) return `<div class="panel"><div class="empty-cell">Nenhum evento registrado ainda.</div></div>`;
  return `<div class="panel"><div class="panel-head"><h3>Atividade recente</h3></div>
    <div style="padding:18px 22px"><div class="timeline">
      ${events.map(e=>`<div class="timeline-item" style="cursor:pointer" data-action="qaOpenDetail" data-id="${e.id}"><span class="tdot"></span><div><b>${esc(e.acao)}</b><div class="tmeta">${e.protocolo} · ${e.data} ${e.hora} — ${esc(e.usuario)}</div></div></div>`).join('')}
    </div></div></div>`;
}
function renderQaRelatorios(){
  const list = getOccurrences();
  const counts = {};
  MOTIVOS.forEach(m=>counts[m.id]=0);
  list.forEach(o=>{ if(o.motivo) counts[o.motivo]=(counts[o.motivo]||0)+1; });
  const max = Math.max(1, ...Object.values(counts));
  return `<div class="panel">
    <div class="panel-head"><h3>Ocorrências por motivo</h3><button class="btn btn-sm btn-ghost" data-action="exportCsv">⬇ Exportar planilha (.csv)</button></div>
    <div style="padding:20px 24px">
      ${MOTIVOS.map(m=>{
        const c = counts[m.id]||0;
        const pct = Math.round((c/max)*100);
        return `<div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px"><span>${m.emoji} ${m.label}</span><b>${c}</b></div>
          <div style="background:var(--gray-100);border-radius:8px;height:10px;overflow:hidden"><div style="width:${pct}%;height:100%;background:linear-gradient(90deg,var(--teal-500),var(--teal-300));border-radius:8px"></div></div>
        </div>`;
      }).join('')}
    </div>
    <div style="padding:0 24px 22px"><div class="deploy-note">Protótipo: os dados exibidos aqui vêm do armazenamento local deste navegador. Ao integrar com o sistema corporativo (planilha ou API), os relatórios passam a refletir a base real de todos os usuários.</div></div>
  </div>`;
}

/* ---------------------------------------------------------
   14. QUALIDADE: detalhe da ocorrência
   --------------------------------------------------------- */
function accordion(key, title, rowsHtml, openDefault){
  const open = state.openAccordions[key]!==undefined ? state.openAccordions[key] : !!openDefault;
  return `<div class="accordion-item ${open?'open':''}">
    <div class="accordion-head" data-action="toggleAccordion" data-key="${key}"><span>${title}</span><span class="chev">⌄</span></div>
    <div class="accordion-body">${rowsHtml}</div>
  </div>`;
}
function basicRows(o){
  return reviewRow('Veículo', o.veiculo) + reviewRow('Setor', o.setor) + reviewRow('Linha', o.linha) +
    reviewRow('Motorista', o.motorista) + reviewRow('Data', formatDateBR(o.data)) + reviewRow('Horário', o.hora) +
    reviewRow('Local', [o.cidade,o.bairro,o.local_especifico].filter(Boolean).join(' · '));
}
function impactoRows(o){
  return reviewRow('Passageiros no veículo', ynLabel(o.possui_passageiros)) +
    (o.possui_passageiros==='sim' ? reviewRow('Necessidade de baldeio', ynLabel(o.houve_baldeio)) : '') +
    reviewRow('Impacto no horário', ynLabel(o.houve_impacto_horario)) +
    (o.houve_impacto_horario==='sim' ? reviewRow('Tipo de impacto', o.tipo_impacto) : '') +
    (o.tipo_impacto==='Outro' ? reviewRow('Descrição', o.descricao_impacto) : '');
}
function substituicaoRows(o){
  const rows = reviewRow('Substituição necessária', ynLabel(o.houve_substituicao)) +
    (o.houve_substituicao==='sim' ? reviewRow('Fora do ponto de apoio', ynLabel(o.substituicao_fora_ponto_apoio)) : '') +
    (o.houve_substituicao==='sim' ? reviewRow('Veículo substituto', o.veiculo_substituto) : '') +
    (o.houve_substituicao==='sim' ? reviewRow('Motorista substituto', o.motorista_substituto) : '') +
    (o.substituicao_fora_ponto_apoio==='sim' ? reviewRow('Local da substituição', o.local_substituicao) : '') +
    (o.substituicao_fora_ponto_apoio==='sim' ? reviewRow('Detalhamento', o.detalhamento_substituicao) : '');
  return rows || '<p style="font-size:13px;color:var(--gray-500)">Não houve substituição.</p>';
}
function manutencaoRows(o){
  return reviewRow('Manutenção acionada', ynLabel(o.manutencao_acionada)) +
    (o.manutencao_acionada==='sim' ? reviewRow('Deslocamento até o veículo', ynLabel(o.manutencao_deslocou)) : '');
}
function retornoRows(o){
  return reviewRow('Retorno próprio', ynLabel(o.retorno_proprio)) +
    (o.retorno_proprio==='nao' ? reviewRow('Remoção/reboque', ynLabel(o.houve_remocao)) : '') +
    (o.houve_remocao==='sim' ? reviewRow('Tipo de remoção', o.tipo_remocao) : '');
}
function motivoRows(o){
  return reviewRow('Motivo', motivoLabel(o.motivo)) + (o.motivo==='outro' ? reviewRow('Descrição', o.descricao_motivo) : '');
}
function obsRows(o){
  const anexos = (o.anexos && o.anexos.length) ? reviewRow('Anexos', o.anexos.map(a=>a.name).join(', ')) : '';
  return reviewRow('Observações', o.observacoes || 'Nenhuma observação registrada.') + anexos;
}
function historicoBlock(o){
  if(!o.historico || !o.historico.length) return '<p style="font-size:13px;color:var(--gray-500)">Sem eventos registrados.</p>';
  return `<div class="timeline">${o.historico.map(h=>`<div class="timeline-item"><span class="tdot"></span><div><b>${esc(h.acao)}</b><div class="tmeta">${h.data} · ${h.hora} — ${esc(h.usuario)}</div></div></div>`).join('')}</div>`;
}
function socorroBox(o){
  if(o.numero_socorro){
    return `<div class="socorro-box">
      <h3>Controle do Socorro</h3>
      <div class="socorro-linked">
        <span style="opacity:.8;font-size:11px;text-transform:uppercase;letter-spacing:.04em">Nº do socorro vinculado</span>
        <b>${esc(o.numero_socorro)}</b>
        <div style="font-size:12px;opacity:.85">Lançado por ${esc(o.responsavel_qualidade)} em ${formatDateTimeBR(o.data_lancamento_socorro)}</div>
      </div>
    </div>`;
  }
  return `<div class="socorro-box">
    <h3>Controle do Socorro</h3>
    <input class="input" id="input-socorro" placeholder="Nº do Socorro no sistema corporativo"/>
    <button class="btn btn-primary" data-action="vincularSocorro" data-id="${o.id}">Vincular socorro</button>
  </div>`;
}
function renderQaDetalhe(id){
  const occ = getOccurrences().find(o=>o.id===id);
  if(!occ) return `<div class="empty-cell">Ocorrência não encontrada.</div>`;
  const meta = STATUS_META[occ.status];
  return `
    <button class="btn btn-ghost btn-sm" data-action="qaBack" style="margin-bottom:16px">← Voltar</button>
    <div class="detail-header">
      <div><h2>${occ.protocolo}</h2><div class="detail-sub">${formatDateBR(occ.data)} · ${occ.hora} — registrado por ${esc(occ.criado_por)}</div></div>
      <span class="pill pill-dot ${meta.cls}">${meta.label}</span>
    </div>
    ${occ.correcao_mensagem && occ.status==='correcao_solicitada' ? `<div class="deploy-note" style="background:#FCEEDD;border-color:#F0C089;color:#7A4A0B;margin-bottom:16px">⚠️ Correção solicitada ao colaborador: <b>${esc(occ.correcao_mensagem)}</b></div>` : ''}
    <div class="detail-grid">
      <div class="panel">
        ${accordion('acc-basicos','Dados básicos', basicRows(occ), true)}
        ${accordion('acc-impacto','Impacto da ocorrência', impactoRows(occ))}
        ${accordion('acc-subst','Substituição do veículo', substituicaoRows(occ))}
        ${accordion('acc-manut','Manutenção', manutencaoRows(occ))}
        ${accordion('acc-retorno','Retorno / Remoção', retornoRows(occ))}
        ${accordion('acc-motivo','Motivo da ocorrência', motivoRows(occ))}
        ${accordion('acc-obs','Observações e anexos', obsRows(occ))}
        ${accordion('acc-hist','Histórico', historicoBlock(occ))}
      </div>
      <div>
        ${socorroBox(occ)}
        <div class="panel" style="padding:16px">
          <div class="section-label" style="margin:0 0 10px">Ações</div>
          <div class="action-list">
            <button class="btn btn-ghost btn-block" data-action="abrirCorrecao" data-id="${occ.id}">✏️ Solicitar correção</button>
            <button class="btn btn-ghost btn-block" data-action="validarOcorrencia" data-id="${occ.id}" ${(occ.status==='validada'||occ.status==='encerrada')?'disabled':''}>✅ Validar ocorrência</button>
            <button class="btn btn-ghost btn-block" data-action="encerrarOcorrencia" data-id="${occ.id}" ${occ.status==='encerrada'?'disabled':''}>⚫ Encerrar ocorrência</button>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------
   15. QUALIDADE: shell (sidebar + topbar)
   --------------------------------------------------------- */
function renderQaSidebar(){
  return `<div class="qa-sidebar">
    <img class="logo" src="assets/univale-logo.png" alt="Univale"/>
    <div class="qa-nav">
      ${QA_NAV.map(n=>`<button class="${(state.qaView===n.id || (state.qaView==='detalhe'&&n.id==='ocorrencias'))?'active':''}" data-action="qaNav" data-view="${n.id}"><span class="ic">${n.ic}</span>${n.label}</button>`).join('')}
    </div>
    <button class="logout-link" data-action="logout">⏻ Sair</button>
  </div>`;
}
function renderQaMobileNav(){
  return `<div class="qa-mobile-nav">
    ${QA_NAV.map(n=>`<button class="${state.qaView===n.id?'active':''}" data-action="qaNav" data-view="${n.id}"><span class="ic">${n.ic}</span>${n.label}</button>`).join('')}
  </div>`;
}
function renderQaTopbar(){
  const titles = { dashboard:'Painel da Qualidade', ocorrencias:'Ocorrências', pendencias:'Pendências', historico:'Histórico', relatorios:'Relatórios', detalhe:'Detalhes da ocorrência' };
  return `<div class="qa-topbar">
    <h2>${titles[state.qaView]||''}</h2>
    <div class="user-chip" data-action="logout" title="Sair">
      <div class="avatar">${state.user.avatar}</div>
      <div class="who"><b>${esc(state.user.nome)}</b><span>${esc(state.user.cargo||'')}</span></div>
    </div>
  </div>`;
}
function renderQaContent(){
  if(state.qaView==='dashboard')   return renderQaDashboard();
  if(state.qaView==='ocorrencias') return renderQaOcorrencias();
  if(state.qaView==='pendencias')  return renderQaPendencias();
  if(state.qaView==='historico')   return renderQaHistorico();
  if(state.qaView==='relatorios')  return renderQaRelatorios();
  if(state.qaView==='detalhe')     return renderQaDetalhe(state.detailId);
  return '';
}
function renderQualidade(){
  return `<div class="qa-shell">
    ${renderQaSidebar()}
    <div class="qa-main">
      ${renderQaTopbar()}
      <div class="qa-content">${renderQaContent()}</div>
    </div>
    ${renderQaMobileNav()}
  </div>`;
}

/* ---------------------------------------------------------
   16. EXPORTAÇÃO CSV (planilha)
   --------------------------------------------------------- */
function csvEsc(v){
  if(v===undefined || v===null) return '';
  const s = String(v).replace(/"/g,'""');
  return /[;"\n]/.test(s) ? `"${s}"` : s;
}
function downloadCsv(list){
  const cols = ['protocolo','data','hora','veiculo','setor','linha','motorista','cidade','bairro','local_especifico',
    'possui_passageiros','houve_baldeio','houve_impacto_horario','tipo_impacto','houve_substituicao',
    'substituicao_fora_ponto_apoio','veiculo_substituto','motorista_substituto','manutencao_acionada','manutencao_deslocou',
    'retorno_proprio','houve_remocao','tipo_remocao','motivo','descricao_motivo','observacoes',
    'numero_socorro','status','criado_por'];
  const header = cols.join(';');
  const rows = list.map(o=>cols.map(c=>csvEsc(o[c])).join(';'));
  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `univale-ocorrencias-${Date.now()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Planilha exportada com sucesso!');
}

/* ---------------------------------------------------------
   17. AÇÕES (data-action)
   --------------------------------------------------------- */
function markReceived(id){
  const list = getOccurrences();
  const occ = list.find(o=>o.id===id);
  if(occ && !(occ.historico||[]).some(h=>h.acao==='Recebida pelo controlador.')){
    const n = nowParts();
    occ.historico = occ.historico || [];
    occ.historico.push({ acao:'Recebida pelo controlador.', usuario:state.user.nome, ts:new Date().toISOString(), data:n.data, hora:n.hora });
    saveOccurrences(list);
  }
}
function extractEditableData(occ){
  const blank = blankOccurrenceData();
  const out = {};
  Object.keys(blank).forEach(k=>{ out[k] = occ[k]!==undefined ? occ[k] : blank[k]; });
  out.anexos = occ.anexos ? occ.anexos.slice() : [];
  return out;
}

const ACTIONS = {
  login(ds){
    const u = USERS.find(x=>x.id===ds.id);
    if(!u) return;
    state.user = u; setSession(u);
    state.route = 'home'; state.qaView = 'dashboard';
    toast(`Bem-vindo(a), ${u.nome.split(' ')[0]}!`);
    render();
  },
  logout(){
    state.user = null; clearSession();
    state.route = 'home'; state.modal = null;
    render();
  },
  goHome(){ state.route='home'; render(); },
  verMinhas(){ state.route='minhas'; state.modal=null; render(); },
  novaOcorrencia(){ state.wizard = { step:0, data:blankOccurrenceData(), editingId:null }; state.route='wizard'; render(); },
  wizardBack(){
    if(state.wizard.step===0){ state.route = state.wizard.editingId ? 'minhas' : 'home'; }
    else state.wizard.step--;
    render();
  },
  wizardNext(){
    const key = STEP_ORDER[state.wizard.step];
    const err = validateStep(key, state.wizard.data);
    if(err){ toast(err,'error'); return; }
    if(state.wizard.step < STEP_ORDER.length-1) state.wizard.step++;
    render();
  },
  wizardJump(ds){ state.wizard.step = +ds.step; render(); },
  setField(ds){ state.wizard.data[ds.field] = ds.value; clearDependentFields(ds.field, ds.value); render(); },
  selectRadio(ds){ state.wizard.data[ds.field] = ds.value; render(); },
  selectMotivo(ds){ state.wizard.data.motivo = ds.value; clearDependentFields('motivo', ds.value); render(); },
  addAnexo(){ const el = document.getElementById('hiddenFileInput'); if(el) el.click(); },
  removeAnexo(ds){ state.wizard.data.anexos.splice(+ds.index,1); render(); },
  submitOcorrencia(){
    const err = validateAll(state.wizard.data);
    if(err){ toast(err,'error'); return; }
    const list = getOccurrences();
    const n = nowParts();
    if(state.wizard.editingId){
      const idx = list.findIndex(o=>o.id===state.wizard.editingId);
      if(idx>-1){
        const prevHist = list[idx].historico || [];
        list[idx] = Object.assign({}, list[idx], state.wizard.data, {
          status:'aguardando_lancamento', correcao_mensagem:'', atualizado_em:new Date().toISOString(),
          historico: prevHist.concat([{ acao:'Ocorrência reenviada após correção.', usuario:state.user.nome, ts:new Date().toISOString(), data:n.data, hora:n.hora }]),
        });
        saveOccurrences(list);
        state.lastProtocolo = list[idx].protocolo;
        state.lastWasEdit = true;
      }
    } else {
      const protocolo = nextProtocol(list);
      const occ = Object.assign({}, state.wizard.data, {
        id: uid(), protocolo, numero_socorro:'', status:'aguardando_lancamento',
        criado_por: state.user.nome, criado_em:new Date().toISOString(), atualizado_em:new Date().toISOString(),
        responsavel_qualidade:'', data_lancamento_socorro:'', observacao_qualidade:'', correcao_mensagem:'',
        historico:[{ acao:'Ocorrência registrada.', usuario:state.user.nome, ts:new Date().toISOString(), data:n.data, hora:n.hora }],
      });
      list.push(occ);
      saveOccurrences(list);
      state.lastProtocolo = protocolo;
      state.lastWasEdit = false;
    }
    state.route = 'success';
    render();
  },
  novaAposSucesso(){ state.wizard = { step:0, data:blankOccurrenceData(), editingId:null }; state.route='wizard'; render(); },
  verOcorrenciaSucesso(){
    const occ = findOccByProtocolo(state.lastProtocolo);
    state.route = 'minhas';
    if(occ) state.modal = { type:'colabDetail', id:occ.id };
    render();
  },
  openColabDetail(ds){ state.modal = { type:'colabDetail', id:ds.id }; renderModal(); },
  closeModal(){ state.modal = null; renderModal(); },
  corrigirReenviar(ds){
    const occ = getOccurrences().find(o=>o.id===ds.id);
    if(!occ) return;
    state.wizard = { step:0, editingId:occ.id, data:extractEditableData(occ) };
    state.modal = null;
    state.route = 'wizard';
    render();
  },
  qaNav(ds){ state.qaView = ds.view; state.detailId = null; render(); },
  qaOpenDetail(ds){ state.detailId = ds.id; state.qaView = 'detalhe'; markReceived(ds.id); render(); },
  qaBack(){ state.qaView = 'ocorrencias'; state.detailId = null; render(); },
  toggleAccordion(ds){ state.openAccordions[ds.key] = !state.openAccordions[ds.key]; render(); },
  vincularSocorro(ds){
    const input = document.getElementById('input-socorro');
    const val = input ? input.value.trim() : '';
    if(!val){ toast('Informe o número do socorro.','error'); return; }
    const list = getOccurrences();
    const occ = list.find(o=>o.id===ds.id);
    if(!occ) return;
    const n = nowParts();
    occ.numero_socorro = val;
    occ.responsavel_qualidade = state.user.nome;
    occ.data_lancamento_socorro = new Date().toISOString();
    occ.status = 'em_analise';
    occ.historico = occ.historico || [];
    occ.historico.push({ acao:`Nº do socorro informado: ${val}.`, usuario:state.user.nome, ts:new Date().toISOString(), data:n.data, hora:n.hora });
    occ.historico.push({ acao:`Socorro nº ${val} vinculado à ocorrência.`, usuario:state.user.nome, ts:new Date().toISOString(), data:n.data, hora:n.hora });
    saveOccurrences(list);
    toast('Número do socorro vinculado com sucesso!');
    render();
  },
  validarOcorrencia(ds){
    const list = getOccurrences();
    const occ = list.find(o=>o.id===ds.id);
    if(!occ) return;
    if(!occ.numero_socorro){ toast('Vincule o nº do socorro antes de validar.','error'); return; }
    const n = nowParts();
    occ.status = 'validada';
    occ.historico.push({ acao:'Ocorrência validada.', usuario:state.user.nome, ts:new Date().toISOString(), data:n.data, hora:n.hora });
    saveOccurrences(list);
    toast('Ocorrência validada.');
    render();
  },
  encerrarOcorrencia(ds){
    const list = getOccurrences();
    const occ = list.find(o=>o.id===ds.id);
    if(!occ) return;
    const n = nowParts();
    occ.status = 'encerrada';
    occ.historico.push({ acao:'Ocorrência encerrada.', usuario:state.user.nome, ts:new Date().toISOString(), data:n.data, hora:n.hora });
    saveOccurrences(list);
    toast('Ocorrência encerrada.');
    render();
  },
  abrirCorrecao(ds){ state.modal = { type:'correcao', id:ds.id }; renderModal(); },
  confirmarCorrecao(ds){
    const ta = document.getElementById('correcao-texto');
    const msg = ta ? ta.value.trim() : '';
    if(!msg){ toast('Descreva o que precisa ser corrigido.','error'); return; }
    const list = getOccurrences();
    const occ = list.find(o=>o.id===ds.id);
    if(!occ) return;
    const n = nowParts();
    occ.status = 'correcao_solicitada';
    occ.correcao_mensagem = msg;
    occ.historico.push({ acao:`Correção solicitada: ${msg}`, usuario:state.user.nome, ts:new Date().toISOString(), data:n.data, hora:n.hora });
    saveOccurrences(list);
    state.modal = null;
    toast('Correção solicitada ao colaborador.');
    render();
  },
  exportCsv(){ downloadCsv(getOccurrences()); },
  clearFilters(){ state.qaFilters = { q:'', status:'', setor:'', motivo:'' }; render(); },
};

/* ---------------------------------------------------------
   18. RENDER PRINCIPAL + ANIMAÇÕES
   --------------------------------------------------------- */
function mountSubfieldAnimations(scope){
  scope.querySelectorAll('.subfields[data-anim="1"]').forEach(el=>{
    const visible = el.dataset.visible==='1';
    if(visible){
      el.style.maxHeight = '0px';
      el.classList.remove('collapsed');
      requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ el.style.maxHeight = el.scrollHeight+'px'; }); });
    } else {
      el.classList.add('collapsed');
      el.style.maxHeight = '0px';
    }
  });
}
function render(){
  const root = document.getElementById('root');
  if(!root) return;
  if(!state.user) root.innerHTML = renderLogin();
  else if(state.user.papel==='colaborador') root.innerHTML = renderColaborador();
  else root.innerHTML = renderQualidade();
  renderModal();
  if(state.user && state.user.papel==='colaborador' && state.route==='wizard'){
    mountSubfieldAnimations(document);
  }
}

/* ---------------------------------------------------------
   19. DELEGAÇÃO DE EVENTOS + INICIALIZAÇÃO
   --------------------------------------------------------- */
function onDocClick(e){
  const t = e.target.closest('[data-action]');
  if(!t) return;
  const action = t.dataset.action;
  if(ACTIONS[action]) ACTIONS[action](t.dataset, t, e);
}
function onDocChange(e){
  const t = e.target;
  if(t.matches && t.matches('[data-bind]')){ state.wizard.data[t.dataset.bind] = t.value; return; }
  if(t.matches && t.matches('[data-filter]')){ state.qaFilters[t.dataset.filter] = t.value; updateQaRows(); return; }
}
function onDocInput(e){
  const t = e.target;
  if(t.id==='qa-search-input'){ state.qaFilters.q = t.value; updateQaRows(); return; }
  if(t.matches && t.matches('[data-bind]') && (t.tagName==='INPUT' || t.tagName==='TEXTAREA')){
    state.wizard.data[t.dataset.bind] = t.value;
  }
}
function createHiddenFileInput(){
  const input = document.createElement('input');
  input.type = 'file'; input.id = 'hiddenFileInput'; input.style.display = 'none';
  input.addEventListener('change', ()=>{
    if(input.files && input.files[0]){
      const f = input.files[0];
      state.wizard.data.anexos = state.wizard.data.anexos || [];
      state.wizard.data.anexos.push({ name:f.name, size:f.size });
      input.value = '';
      render();
    }
  });
  document.body.appendChild(input);
}
function init(){
  seedIfNeeded();
  state.user = getSession();
  document.addEventListener('click', onDocClick);
  document.addEventListener('change', onDocChange);
  document.addEventListener('input', onDocInput);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && state.modal){ state.modal=null; renderModal(); } });
  createHiddenFileInput();
  render();
}
document.addEventListener('DOMContentLoaded', init);
