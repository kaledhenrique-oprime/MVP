const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { businessDate, isShiftCurrent } = require('../business-date');

const projectRoot = path.resolve(__dirname, '..');
let server;
let tempRoot;
let baseUrl;
let html;

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.text();
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('Servidor não ficou disponível a tempo.');
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function appContext() {
  const elements = new Map();
  const storage = new Map();
  const get = id => {
    if (!elements.has(id)) {
      const classes = new Set(id === 'app' ? ['hidden'] : ['hidden']);
      elements.set(id, {
        id,
        innerHTML: '',
        textContent: '',
        value: '',
        style: { setProperty() {} },
        classList: {
          add(...values) { values.forEach(value => classes.add(value)); },
          remove(...values) { values.forEach(value => classes.delete(value)); },
          toggle(value, force) { if (force === undefined) force = !classes.has(value); force ? classes.add(value) : classes.delete(value); return force; },
          contains(value) { return classes.has(value); }
        }
      });
    }
    return elements.get(id);
  };
  const context = vm.createContext({
    document: {
      getElementById: get,
      documentElement: { style: { setProperty() {} } },
      body: { style: {} }
    },
    fetch: async () => ({ ok: true, json: async () => ({ consultants: [], activeShifts: [] }) }),
    setInterval() {},
    setTimeout() {},
    clearInterval() {},
    console,
    Intl,
    Date,
    alert() {},
    confirm() { return true; },
    location: { reload() {} },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    }
  });
  context.window = context;
  context.__elements = elements;
  context.__storage = storage;
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'public/app.js'), 'utf8'), context);
  return context;
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-shift-test-'));
  fs.cpSync(projectRoot, tempRoot, {
    recursive: true,
    filter: source => !source.includes(`${path.sep}.git${path.sep}`) &&
      !source.includes(`${path.sep}node_modules${path.sep}`) &&
      !source.includes(`${path.sep}test${path.sep}`)
  });
  fs.writeFileSync(path.join(tempRoot, 'data/db.json'), JSON.stringify({
    consultants: [{ id: 'c1', name: 'Kalled', startTime: '08:00', dailyGoal: 300, backgroundColor: '#f4f6f8', photo: 'data:image/png;base64,abc' }],
    messages: [
      { id: 'legacy-m1', consultantId: 'c1', date: '2026-08-20', sentAt: '2026-08-20T08:30:00.000Z' },
      { id: 'legacy-m2', consultantId: 'c1', date: '2026-08-20', sentAt: '2026-08-20T10:30:00.000Z' }
    ],
    activities: [
      { id: 'legacy-a1', consultantId: 'c1', type: 'matriculas', date: '2026-08-20', createdAt: '2026-08-20T08:40:00.000Z' },
      { id: 'legacy-a2', consultantId: 'c1', type: 'visitas', date: '2026-08-20', createdAt: '2026-08-20T10:40:00.000Z' }
    ],
    shifts: [
      { id: 'legacy-s1', consultantId: 'c1', date: '2026-08-20', startedAt: '2026-08-20T08:00:00.000Z', endedAt: '2026-08-20T09:00:00.000Z' },
      { id: 'legacy-s2', consultantId: 'c1', date: '2026-08-20', startedAt: '2026-08-20T10:00:00.000Z', endedAt: '2026-08-20T11:00:00.000Z' }
    ],
    cancellationPendings: []
  }, null, 2));
  const port = 42000 + Math.floor(Math.random() * 1000);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], {
    cwd: tempRoot,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  html = await waitForServer(baseUrl);
});

after(() => {
  server?.kill('SIGTERM');
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('a jornada de seis horas usa sempre o horário configurado, e não a sessão', () => {
  const context = appContext();
  const result = JSON.parse(vm.runInContext(`JSON.stringify(computeShiftTimer(
    '08:00',
    new Date(2026, 7, 24, 10, 15, 30).getTime()
  ))`, context));
  assert.deepEqual(result, {
    phase: 'active',
    startsInMs: 0,
    elapsedMs: 8130000,
    remainingMs: 13470000,
    finished: false
  });
  assert.equal(vm.runInContext("formatDuration(13470000)", context), '03:44:30');
});

test('antes do horário configurado a jornada aguarda o início exato', () => {
  const context = appContext();
  const result = JSON.parse(vm.runInContext(`JSON.stringify(computeShiftTimer(
    '05:00',
    new Date(2026, 7, 24, 4, 30, 0).getTime()
  ))`, context));
  assert.deepEqual(result, {
    phase: 'before',
    startsInMs: 1800000,
    elapsedMs: 0,
    remainingMs: 21600000,
    finished: false
  });
});

test('finalizar ou reiniciar sessões não altera o relógio da jornada configurada', () => {
  const context = appContext();
  const expression = `JSON.stringify(computeShiftTimer('05:00', new Date(2026, 7, 24, 8, 0, 0).getTime()))`;
  vm.runInContext("state.shift={id:'primeira',startedAt:'2026-08-24T07:30:00.000Z'}", context);
  const beforeFinish = vm.runInContext(expression, context);
  vm.runInContext("state.shift={id:'segunda',startedAt:'2026-08-24T08:00:00.000Z'}", context);
  const afterRestart = vm.runInContext(expression, context);
  assert.equal(afterRestart, beforeFinish);
  assert.deepEqual(JSON.parse(afterRestart), {
    phase: 'active', startsInMs: 0, elapsedMs: 10800000, remainingMs: 10800000, finished: false
  });
});

test('depois das seis horas a jornada configurada permanece concluída', () => {
  const context = appContext();
  const result = JSON.parse(vm.runInContext(`JSON.stringify(computeShiftTimer(
    '05:00',
    new Date(2026, 7, 24, 12, 0, 0).getTime()
  ))`, context));
  assert.deepEqual(result, {
    phase: 'finished', startsInMs: 0, elapsedMs: 21600000, remainingMs: 0, finished: true
  });
});

test('uma jornada noturna continua ativa depois da meia-noite', () => {
  const context = appContext();
  const result = JSON.parse(vm.runInContext(`JSON.stringify(computeShiftTimer(
    '22:00',
    new Date(2026, 7, 25, 1, 0, 0).getTime()
  ))`, context));
  assert.deepEqual(result, {
    phase: 'active', startsInMs: 0, elapsedMs: 10800000, remainingMs: 10800000, finished: false
  });
});

test('a data de negócio do servidor segue o horário de São Paulo', () => {
  assert.equal(businessDate('2026-08-25T00:30:00.000Z'), '2026-08-24');
  assert.equal(businessDate('2026-08-25T03:30:00.000Z'), '2026-08-25');
});

test('o backend mantém a sessão noturna até o fim configurado', () => {
  const shift = { date: '2026-08-24', endedAt: null };
  assert.equal(isShiftCurrent(shift, '22:00', '2026-08-25T03:59:59-03:00'), true);
  assert.equal(isShiftCurrent(shift, '22:00', '2026-08-25T04:00:00-03:00'), false);
  assert.equal(isShiftCurrent(shift, '08:00', '2026-08-25T01:00:00-03:00'), false);
});

test('apagar dados do dia deixa o servidor escolher a data local correta', async () => {
  const context = appContext();
  let payload;
  context.fetch = async (_url, options = {}) => {
    if (options.body) payload = JSON.parse(options.body);
    return { ok: true, json: async () => options.body ? ({ ok: true }) : ({ consultants: [], activeShifts: [] }) };
  };
  vm.runInContext("state.consultant={id:'c1'}; state.shift={id:'s1'}", context);
  await vm.runInContext('deleteMyDay()', context);
  assert.deepEqual(payload, { requesterId: 'c1' });
});

test('o intervalo usa uma contagem independente de quinze minutos', () => {
  const context = appContext();
  const result = JSON.parse(vm.runInContext(`JSON.stringify(computeBreakTimer(
    new Date('2026-08-24T10:15:00.000Z').getTime(),
    new Date('2026-08-24T10:05:00.000Z').getTime()
  ))`, context));
  assert.deepEqual(result, { remainingMs: 600000, finished: false });
});

test('o intervalo pode ser reiniciado, concluído e dispara Bater o ponto ao terminar', () => {
  const context = appContext();
  vm.runInContext("state.consultant={id:'c1'}; state.shift={id:'s1'}; startBreak()", context);
  const first = JSON.parse(context.__storage.get('evolve-break-c1-s1'));
  assert.ok(first.endsAt - Date.now() > 14 * 60 * 1000);

  vm.runInContext('requestFinishBreak()', context);
  assert.equal(context.__elements.get('breakDecisionModal').classList.contains('hidden'), false);
  vm.runInContext('restartBreak()', context);
  assert.equal(context.__elements.get('breakDecisionModal').classList.contains('hidden'), true);

  context.__storage.set('evolve-break-c1-s1', JSON.stringify({ endsAt: Date.now() - 1 }));
  vm.runInContext('state.breakAlerted=false; renderTimeControls()', context);
  assert.equal(context.__elements.get('breakAlertModal').classList.contains('hidden'), false);

  vm.runInContext('markBreakTaken()', context);
  assert.equal(context.__storage.has('evolve-break-c1-s1'), false);
  assert.equal(context.__elements.get('breakFinishButton').classList.contains('hidden'), true);
});

test('o alerta sonoro é preparado no clique que inicia o intervalo', () => {
  const context = appContext();
  let created = 0;
  context.AudioContext = function AudioContext() {
    created += 1;
    this.state = 'running';
    this.resume = async () => {};
  };
  vm.runInContext("state.consultant={id:'c1'}; state.shift={id:'s1'}; startBreak()", context);
  assert.equal(created, 1);

  vm.runInContext('markBreakTaken()', context);
  context.__storage.set('evolve-interface-prefs', JSON.stringify({ sound: false, compact: false }));
  vm.runInContext('startBreak()', context);
  assert.equal(created, 1);
});

test('o estado do intervalo pertence somente ao expediente em que foi iniciado', () => {
  const context = appContext();
  vm.runInContext("state.consultant={id:'c1'}; state.shift={id:'s1'}; startBreak()", context);
  assert.equal(context.__storage.has('evolve-break-c1-s1'), true);
  const nextShiftState = vm.runInContext("state.shift={id:'s2'}; readBreakState()", context);
  assert.equal(nextShiftState, null);
});

test('o relatório final segue o modelo solicitado e omite intervalo e NPS', () => {
  const context = appContext();
  const report = vm.runInContext(`buildShiftReport({
    consultant: { name: 'Kalled' },
    shift: { date: '2026-08-24' },
    stats: { messages: 12, activities: {
      matriculas: 2, cancelamentos: 1, inadimplentes: 4,
      manuais: 3, efetivadas: 2, agendamentos: 5, visitas: 6, nps: 9
    }}
  })`, context);
  assert.equal(report, [
    'RELATÓRIO DE EXPEDIENTE',
    'Consultor: Kalled',
    'Data: 24/08/2026',
    '',
    '',
    '✉️Mensagens enviadas: 12',
    '💰Vendas: 2',
    '❌Solicitações de cancelamento: 1',
    '📉Cobranças de inadimplentes: 4',
    '🤑Cobranças manuais: 3',
    '📈Cobranças efetivadas: 2',
    '🏋🏼‍♀️Agendamentos de treino: 5',
    '☀️Visitas recebidas: 6'
  ].join('\n'));
  assert.doesNotMatch(report, /NPS|Intervalo/);
});

test('o histórico é agrupado por data sem misturar relatórios', () => {
  const context = appContext();
  const grouped = JSON.parse(vm.runInContext(`JSON.stringify(groupHistoryByDate([
    { id: 's1', date: '2026-08-24' },
    { id: 's2', date: '2026-08-23' },
    { id: 's3', date: '2026-08-24' }
  ]))`, context));
  assert.deepEqual(grouped, [
    ['2026-08-24', [{ id: 's1', date: '2026-08-24' }, { id: 's3', date: '2026-08-24' }]],
    ['2026-08-23', [{ id: 's2', date: '2026-08-23' }]]
  ]);
});

test('expediente aberto só aparece ativo na data de hoje', () => {
  const context = appContext();
  const today = JSON.parse(vm.runInContext("JSON.stringify(historyShiftStatus({date:'2026-08-24',endedAt:null},'2026-08-24'))", context));
  const old = JSON.parse(vm.runInContext("JSON.stringify(historyShiftStatus({date:'2026-08-21',endedAt:null},'2026-08-24'))", context));
  assert.deepEqual(today, { className: 'open', label: 'Ativo', note: 'Este expediente ainda está em andamento.' });
  assert.deepEqual(old, { className: 'unfinished', label: 'Expediente não finalizado', note: 'Este expediente não foi finalizado nesse dia.' });
});

test('o histórico mantém ativa a jornada noturna reconhecida pelo servidor', () => {
  const context = appContext();
  const status = JSON.parse(vm.runInContext("JSON.stringify(historyShiftStatus({date:'2026-08-24',endedAt:null,isCurrent:true},'2026-08-25'))", context));
  assert.deepEqual(status, { className: 'open', label: 'Ativo', note: 'Este expediente ainda está em andamento.' });
});

test('o calendário do histórico separa o dia do mês sem texto intermediário', () => {
  const context = appContext();
  const parts = JSON.parse(vm.runInContext("JSON.stringify(historyDateParts('2026-08-24'))", context));
  assert.deepEqual(parts, { day: '24', month: 'AGO' });
});

test('expedientes antigos do mesmo dia são reconstruídos por faixa de horário', async () => {
  const history = await request('/api/history');
  const first = history.find(item => item.id === 'legacy-s1');
  const second = history.find(item => item.id === 'legacy-s2');
  assert.equal(first.stats.messages, 1);
  assert.deepEqual(first.stats.activities, { matriculas: 1 });
  assert.equal(second.stats.messages, 1);
  assert.deepEqual(second.stats.activities, { visitas: 1 });
});

test('o histórico fornece e renderiza a foto do consultor', async () => {
  const history = await request('/api/history');
  assert.equal(history[0].consultantPhoto, 'data:image/png;base64,abc');
  const context = appContext();
  const markup = vm.runInContext(`historyShiftHtml(${JSON.stringify({ consultantName: 'Kalled', consultantPhoto: 'data:image/png;base64,abc', date: '2026-08-24', startedAt: '2026-08-24T08:00:00Z', endedAt: null, stats: {} })})`, context);
  assert.match(markup, /<img class="history-avatar"/);
});

test('finalizar um expediente preserva o relatório e zera a sessão seguinte', async () => {
  await request('/api/shifts/start', { method: 'POST', body: JSON.stringify({ consultantId: 'c1' }) });
  await request('/api/messages/adjust', { method: 'POST', body: JSON.stringify({ consultantId: 'c1', delta: 1 }) });
  await request('/api/activities/adjust', { method: 'POST', body: JSON.stringify({ consultantId: 'c1', type: 'matriculas', delta: 1 }) });

  const ended = await request('/api/shifts/end', { method: 'POST', body: JSON.stringify({ consultantId: 'c1' }) });
  assert.equal(ended.stats.messages, 1);
  assert.equal(ended.stats.activities.matriculas, 1);

  await request('/api/shifts/start', { method: 'POST', body: JSON.stringify({ consultantId: 'c1' }) });
  const fresh = await request('/api/session-stats?consultantId=c1');
  assert.equal(fresh.messages, 0);
  assert.deepEqual(fresh.activities, {});

  const history = await request('/api/history');
  const finished = history.find(item => item.endedAt);
  assert.equal(finished.stats.messages, 1);
  assert.equal(finished.stats.activities.matriculas, 1);
});

test('um expediente zerado pode terminar sem permanecer no histórico', async () => {
  const started = await request('/api/shifts/start', { method: 'POST', body: JSON.stringify({ consultantId: 'c1' }) });
  const ended = await request('/api/shifts/end', { method: 'POST', body: JSON.stringify({ consultantId: 'c1', persist: false }) });
  assert.equal(ended.persisted, false);
  assert.equal((await request('/api/history')).some(item => item.id === started.id), false);
});

test('um expediente zerado pode salvar o relatório no histórico', async () => {
  const started = await request('/api/shifts/start', { method: 'POST', body: JSON.stringify({ consultantId: 'c1' }) });
  const ended = await request('/api/shifts/end', { method: 'POST', body: JSON.stringify({ consultantId: 'c1', persist: true }) });
  assert.equal(ended.persisted, true);
  assert.equal((await request('/api/history')).some(item => item.id === started.id), true);
});

test('a seleção distingue sessão zerada e oferece finalizar o perfil ativo', () => {
  const context = appContext();
  assert.equal(vm.runInContext('sessionHasRecords({messages:0,activities:{}})', context), false);
  assert.equal(vm.runInContext('sessionHasRecords({messages:0,activities:{visitas:1}})', context), true);
  const markup = vm.runInContext(`consultantCardHtml({ id:'c1', name:'Kalled', startTime:'05:00', dailyGoal:20 }, true)`, context);
  assert.match(markup, /Continuar expediente/);
  assert.match(markup, /Finalizar expediente/);
  assert.match(markup, /^<div class="consultant-btn/);
  assert.doesNotMatch(markup, /<button class="consultant-btn/);
});

test('um webhook atrasado não entra nas métricas do expediente atual', async () => {
  await request('/api/webhooks/whatsapp', {
    method: 'POST',
    body: JSON.stringify({ consultantId: 'c1', externalId: 'delayed-1', sentAt: '2000-01-01T12:00:00.000Z' })
  });
  const fresh = await request('/api/session-stats?consultantId=c1');
  assert.equal(fresh.messages, 0);
});

test('rotas destrutivas exigem uma jornada ativa do solicitante', async () => {
  const denied = await fetch(`${baseUrl}/api/consultants/c1/delete-day`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '1999-01-01' })
  });
  assert.equal(denied.status, 403);

  await request('/api/shifts/start', { method: 'POST', body: JSON.stringify({ consultantId: 'c1' }) });

  const allowed = await fetch(`${baseUrl}/api/consultants/c1/delete-day`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '1999-01-01', requesterId: 'c1' })
  });
  assert.equal(allowed.status, 200);
});

test('preferências corrompidas voltam aos padrões sem impedir as configurações', () => {
  const context = appContext();
  context.__storage.set('evolve-interface-prefs', '{inválido');
  const prefs = JSON.parse(vm.runInContext('JSON.stringify(readInterfacePrefs())', context));
  assert.deepEqual(prefs, { sound: true, compact: false });
});

test('apagar a jornada atual devolve o usuário à seleção de perfis', () => {
  const context = appContext();
  context.document.getElementById('app').classList.remove('hidden');
  context.document.getElementById('login').classList.add('hidden');
  vm.runInContext("state.consultant={id:'c1'}; state.shift={id:'s1'}", context);
  context.__storage.set('evolve-break-c1-s1', JSON.stringify({ endsAt: Date.now() + 60000 }));
  vm.runInContext('leaveDeletedShift()', context);
  assert.equal(context.document.getElementById('app').classList.contains('hidden'), true);
  assert.equal(context.document.getElementById('login').classList.contains('hidden'), false);
  assert.equal(vm.runInContext('state.shift', context), null);
  assert.equal(context.__storage.has('evolve-break-c1-s1'), false);
});

test('a interface integra a administração às configurações', () => {
  assert.match(html, /id="breakDecisionModal"/);
  assert.match(html, /Reiniciar contagem/);
  assert.match(html, /Intervalo tirado/);
  assert.match(html, /data-settings-panel="admin"/);
  assert.doesNotMatch(html, /id="adminSettingsButton"/);
  assert.doesNotMatch(html, /id="adminModal"/);
});

test('o cartão de Kalled recebe tratamento visual permanente de administrador', () => {
  const context = appContext();
  const markup = vm.runInContext(`consultantCardHtml({
    id: 'c1', name: 'Kalled', startTime: '08:00', dailyGoal: 300
  }, false)`, context);
  assert.match(markup, /consultant-btn[^\"]* is-admin/);
  assert.match(markup, /Administrador/);

  const css = fs.readFileSync(path.join(projectRoot, 'public/style.css'), 'utf8');
  assert.doesNotMatch(css, /\.consultant-btn\.is-admin::before/);
  assert.doesNotMatch(css, /adminBorderSpin|conic-gradient/);
  assert.match(css, /@keyframes adminGlow/);
});
