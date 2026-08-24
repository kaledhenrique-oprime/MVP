const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

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

function cssRule(stylesheet, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesheet.match(new RegExp(`(?:^|})${escaped}\\{([^}]*)\\}`));
  assert.ok(match, `regra CSS ausente: ${selector}`);
  return Object.fromEntries(match[1].split(';').filter(Boolean).map(entry => {
    const separator = entry.indexOf(':');
    return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
  }));
}

function cssLastRule(stylesheet, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...stylesheet.matchAll(new RegExp(`(?:^|})\\s*${escaped}\\{([^}]*)\\}`, 'g'))];
  const match = matches.at(-1);
  assert.ok(match, `regra CSS ausente: ${selector}`);
  return Object.fromEntries(match[1].split(';').filter(Boolean).map(entry => {
    const separator = entry.indexOf(':');
    return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
  }));
}

function createFakeDom() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        innerHTML: '',
        textContent: '',
        value: '',
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
      });
    }
    return elements.get(id);
  };
  return { elements, document: { getElementById: get } };
}

function createTabbedDom() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) {
      const classes = new Set(['hidden']);
      elements.set(id, {
        id, innerHTML: '', textContent: '', value: '', checked: false, disabled: false,
        style: {},
        classList: {
          add(...names) { names.forEach(name => classes.add(name)); },
          remove(...names) { names.forEach(name => classes.delete(name)); },
          toggle(name, force) { if (force === undefined ? !classes.has(name) : force) classes.add(name); else classes.delete(name); },
          contains(name) { return classes.has(name); }
        },
        scrollIntoView() { this.scrolled = true; }
      });
    }
    return elements.get(id);
  };
  return { elements, document: { getElementById: get, querySelectorAll: () => [] } };
}

function renderActivityMarkup() {
  const { elements, document } = createFakeDom();
  const context = vm.createContext({
    document,
    state: {
      consultant: { id: 'c1' },
      stats: { rows: [{ id: 'c1', messages: 3, activities: {} }] }
    },
    hasCancellationPending: () => false,
    ICONS: {
      mensagens: '✉', matriculas: '♟', cancelamentos: '♟',
      agendamentos: '▣', visitas: '♟', nps: '★'
    },
    ICON_CLASS: {
      mensagens: 'messages', matriculas: 'matriculas', cancelamentos: 'cancelamentos',
      agendamentos: 'agendamentos', visitas: 'visitas', nps: 'nps'
    },
    DESCRIPTIONS: {
      mensagens: 'Conversas enviadas no atendimento.', matriculas: 'Novos contratos concluídos.',
      cancelamentos: 'Solicitações concluídas no turno.', agendamentos: 'Treinos marcados para alunos.',
      visitas: 'Pessoas recebidas na unidade.', nps: 'Avaliações de satisfação coletadas.'
    }
  });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'public/activity-ui.js'), 'utf8'), context);
  context.renderActivities();
  return elements.get('activityButtons').innerHTML;
}

function renderTableHead() {
  const { elements, document } = createFakeDom();
  const context = vm.createContext({
    document,
    fetch: async () => ({ ok: true, json: async () => ({ consultants: [], activeShifts: [] }) }),
    setInterval() {},
    console,
    Intl,
    Date,
    alert() {},
    location: { reload() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'public/app.js'), 'utf8'), context);
  vm.runInContext('renderTeamTable({rows:[]})', context);
  return elements.get('teamHead').innerHTML;
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-ui-test-'));
  fs.cpSync(projectRoot, tempRoot, {
    recursive: true,
    filter: source => !source.includes(`${path.sep}.git${path.sep}`) &&
      !source.includes(`${path.sep}node_modules${path.sep}`) &&
      !source.includes(`${path.sep}test${path.sep}`)
  });
  const port = 41000 + Math.floor(Math.random() * 1000);
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

test('a página do consultor incorpora sem alterações o PNG com texto preto e símbolo vermelho', () => {
  const logoTag = html.match(/<img[^>]+class="consultant-logo"[^>]+src="([^"]+)"[^>]*>/);
  assert.ok(logoTag, 'a barra lateral deve usar uma imagem com a classe consultant-logo');
  assert.match(logoTag[1], /^data:image\/png;base64,/);
  const bytes = Buffer.from(logoTag[1].split(',')[1], 'base64');
  assert.equal(
    crypto.createHash('sha256').update(bytes).digest('hex'),
    '7a117d8ef04f70a675bc2ff8150f9c62ba344bc6c912c841018049ffb5d9ac2c'
  );
  const assetPath = path.join(tempRoot, 'tested-logo.png');
  fs.writeFileSync(assetPath, bytes);
  const histogram = execFileSync('convert', [assetPath, '-format', '%c', 'histogram:info:-'], { encoding: 'utf8' });
  let black = 0;
  let red = 0;
  for (const line of histogram.split('\n')) {
    const color = line.match(/^\s*(\d+): \((\d+),(\d+),(\d+),(\d+)\)/);
    if (!color) continue;
    const [, count, r, g, b, a] = color.map(Number);
    if (a > 150 && r < 45 && g < 45 && b < 45) black += count;
    if (a > 150 && r > 150 && g < 90 && b < 90) red += count;
  }
  assert.ok(black > 1000, 'o nome EVOLVE deve permanecer preto');
  assert.ok(red > 1000, 'o símbolo deve ser vermelho');
});

test('os cartões renderizados exibem descrições curtas e úteis', () => {
  const markup = renderActivityMarkup();
  assert.match(markup, /class="activity-description"/);
  assert.match(markup, /Conversas enviadas no atendimento/);
  assert.doesNotMatch(markup, /Adicione \+1 sempre que/);
  assert.match(markup, />Mensagens</);
  assert.match(markup, />Cobranças</);
  assert.match(markup, />Finalizar expediente</);
});

test('os timers ficam empilhados no quarto cartão da segunda linha', () => {
  const markup = renderActivityMarkup();
  const actionCard = markup.match(/<div class="finish-grid-card[\s\S]*?<\/div>\s*<\/div>$/)?.[0] || markup;
  assert.match(actionCard, /id="shiftTimer"/);
  assert.match(actionCard, /id="breakButton"/);
  assert.match(actionCard, /id="breakFinishButton"/);
  assert.ok(actionCard.indexOf('id="shiftTimer"') < actionCard.indexOf('id="breakButton"'));
  assert.ok(actionCard.indexOf('id="breakButton"') < actionCard.indexOf('Finalizar expediente'));

  const profile = html.match(/<section class="profile-card">([\s\S]*?)<\/section>/)?.[1] || '';
  assert.doesNotMatch(profile, /id="shiftTimer"|id="breakButton"/);
  assert.match(profile, /aria-label="Abrir configurações"/);
});

test('os cartões têm controles próximos e conteúdo com espaço seguro', () => {
  const stylesheet = fs.readFileSync(path.join(projectRoot, 'public/activity-ui.css'), 'utf8');
  const counter = cssRule(stylesheet, '.compact-counter');
  const cards = cssLastRule(stylesheet, '.activity-btn-round');
  const charges = cssLastRule(stylesheet, '.charge-group-card');
  const chargeHeader = cssLastRule(stylesheet, '.charge-group-card .activity-top');

  assert.equal(counter.width, 'max-content');
  assert.ok(Number.parseFloat(counter.gap) <= 5);
  assert.ok(Number.parseFloat(cards['min-height']) <= 145);
  assert.equal(charges.height, '188px!important');
  assert.equal(charges['min-height'], '188px');
  assert.ok(Number.parseFloat(chargeHeader['min-height']) >= 48);
  assert.notEqual(charges.overflow, 'hidden');
});

test('Finalizar expediente fica menor e Página inicial usa botão preto com casa', () => {
  assert.match(html, /🏠 Página inicial/);
  const baseStyles = fs.readFileSync(path.join(projectRoot, 'public/style.css'), 'utf8');
  const activityStyles = fs.readFileSync(path.join(projectRoot, 'public/activity-ui.css'), 'utf8');
  const home = cssRule(baseStyles, '.logout-nav');
  const finish = cssRule(activityStyles, '.finish-grid-card');

  assert.equal(home.background, '#111827');
  assert.equal(home.color, '#fff');
  assert.ok(Number.parseFloat(finish.padding) >= 8);
});

test('a personalização de cor dos botões não aparece nas configurações', () => {
  assert.doesNotMatch(html, /id="cfgButtonColor"/);
  assert.doesNotMatch(html, /id="adminButtonColor"/);
  assert.match(html, /id="cfgBackgroundColor"/);
  assert.match(html, /id="adminBackgroundColor"/);
});

test('a tabela usa Treino e não força rolagem horizontal', () => {
  const head = renderTableHead();
  assert.match(head, />Treino</);
  assert.doesNotMatch(head, />Agendamentos</);

  const stylesheet = fs.readFileSync(path.join(projectRoot, 'public/style.css'), 'utf8');
  const wrapper = cssRule(stylesheet, '.table-wrap');
  const table = cssRule(stylesheet, 'table');
  assert.equal(wrapper['overflow-x'], 'hidden');
  assert.equal(table.width, '100%');
  assert.equal(table['table-layout'], 'fixed');
  assert.ok(!table['min-width'] || Number.parseFloat(table['min-width']) === 0);

  const activityStyles = fs.readFileSync(path.join(projectRoot, 'public/activity-ui.css'), 'utf8');
  const metricNumber = cssRule(activityStyles, '.team-card .metric-number');
  const consultantTotal = cssRule(stylesheet, '.consultant-total');
  const totalRow = cssRule(stylesheet, '.total-row td');
  assert.ok(Number.parseFloat(metricNumber['font-size']) >= 17);
  assert.ok(Number.parseFloat(consultantTotal['font-size']) >= 18);
  assert.ok(Number.parseFloat(totalRow['font-size']) >= 16);
});

test('a navegação inclui a planilha CRM com filtros e todas as colunas', () => {
  assert.match(html, />CRM’s</);
  for (const label of ['Concluído', 'Data', 'Consultor', 'Matrícula/ID', 'Nome do cliente', 'Prioridade', 'Assunto', 'Detalhes do CRM', 'Acompanhamento', 'Status']) assert.match(html, new RegExp(label.replace('/', '\\/')));
  assert.match(html, /id="crmConsultantFilter"/);
  assert.match(html, /id="crmPriorityFilter"/);
  assert.match(html, /id="crmStatusFilter"/);
  assert.match(html, /id="crmFormModal"/);
});

test('cartões usam controles compactos e bem alinhados', () => {
  const stylesheet = fs.readFileSync(path.join(projectRoot, 'public/activity-ui.css'), 'utf8');
  const button = cssLastRule(stylesheet, '.counter-btn');
  const value = cssLastRule(stylesheet, '.counter-value');
  const card = cssLastRule(stylesheet, '.activity-btn-round');
  assert.ok(Number.parseFloat(button.width) >= 32 && Number.parseFloat(button.width) <= 38);
  assert.ok(Number.parseFloat(button.height) >= 32 && Number.parseFloat(button.height) <= 38);
  assert.ok(Number.parseFloat(value['font-size']) >= 15);
  assert.ok(Number.parseFloat(card['min-height']) <= 145);
});

test('registro de atividades usa três colunas compactas, gráfico e atalho do CRM', () => {
  const markup = renderActivityMarkup();
  assert.match(markup, /class="activity-cards-grid"/);
  assert.match(markup, /class="activity-chart-card"/);
  assert.match(markup, /class="activity-donut"/);
  assert.match(markup, /Mensagens/);
  assert.match(markup, /Cobranças/);

  const activitySection = html.match(/<section id="activitySection"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(activitySection, /onclick="openCrm\(\)"/);
  assert.ok(activitySection.indexOf('Registrar atividade') < activitySection.indexOf('CRM’s'));
  assert.match(activitySection, /id="activityTabContent"/);
  assert.match(activitySection, /id="crmTabContent"/);

  const stylesheet = fs.readFileSync(path.join(projectRoot, 'public/activity-ui.css'), 'utf8');
  const cardsGrid = cssLastRule(stylesheet, '.activity-cards-grid');
  assert.match(cardsGrid['grid-template-columns'], /repeat\(3/);
});

test('cartões são empilhados em colunas independentes sem espaços de linhas maiores', () => {
  const markup = renderActivityMarkup();
  const first = markup.indexOf('data-activity-column="primary"');
  const second = markup.indexOf('data-activity-column="secondary"');
  const third = markup.indexOf('data-activity-column="special"');
  assert.ok(first >= 0 && first < second && second < third);

  const primary = markup.slice(first, second);
  const secondary = markup.slice(second, third);
  const special = markup.slice(third);
  assert.ok(primary.indexOf('Mensagens') < primary.indexOf('Agendamentos de treino'));
  assert.ok(primary.indexOf('Agendamentos de treino') < primary.indexOf('Visitas recebidas'));
  assert.ok(secondary.indexOf('Matrículas') < secondary.indexOf('NPS'));
  assert.ok(secondary.indexOf('NPS') < secondary.indexOf('Cancelamentos'));
  assert.ok(special.indexOf('Cobranças') < special.indexOf('Finalizar expediente'));

  const stylesheet = fs.readFileSync(path.join(projectRoot, 'public/activity-ui.css'), 'utf8');
  const column = cssLastRule(stylesheet, '.activity-card-column');
  assert.equal(column['flex-direction'], 'column');
  assert.ok(Number.parseFloat(column.gap) <= 12);
});

test('tipos de cobrança recebem três tons visuais distintos', () => {
  const markup = renderActivityMarkup();
  assert.match(markup, /charge-row charge-inadimplentes/);
  assert.match(markup, /charge-row charge-manuais/);
  assert.match(markup, /charge-row charge-efetivadas/);

  const stylesheet = fs.readFileSync(path.join(projectRoot, 'public/activity-ui.css'), 'utf8');
  const backgrounds = ['.charge-inadimplentes', '.charge-manuais', '.charge-efetivadas']
    .map(selector => cssLastRule(stylesheet, selector).background);
  assert.equal(new Set(backgrounds).size, 3);
  backgrounds.forEach(background => assert.match(background, /^#/));
});

test('Cobranças e timers preservam o tamanho original de 188px', () => {
  const stylesheet = fs.readFileSync(path.join(projectRoot, 'public/activity-ui.css'), 'utf8');
  const charges = cssLastRule(stylesheet, '.charge-group-card');
  const finish = cssLastRule(stylesheet, '.finish-grid-card');
  assert.equal(charges.height, '188px!important');
  assert.equal(charges['min-height'], '188px');
  assert.equal(finish.height, '188px');
  assert.equal(finish['min-height'], '188px');
});

test('CRM abre como segunda aba no lugar das atividades e permite voltar', async () => {
  const { elements, document } = createTabbedDom();
  const context = vm.createContext({
    document,
    fetch: async url => ({ ok: true, json: async () => String(url).includes('/api/crm') ? [] : { consultants: [], activeShifts: [] } }),
    setInterval() {}, setTimeout() {}, clearTimeout() {}, console, Intl, Date,
    alert() {}, confirm: () => true, location: { reload() {} }, localStorage: { getItem() { return null; }, setItem() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'public/app.js'), 'utf8'), context);
  await vm.runInContext('openCrm()', context);
  assert.equal(elements.get('activityTabContent').classList.contains('hidden'), true);
  assert.equal(elements.get('crmTabContent').classList.contains('hidden'), false);
  assert.equal(elements.get('crmSection')?.scrolled, undefined);
  vm.runInContext('showActivityTab()', context);
  assert.equal(elements.get('activityTabContent').classList.contains('hidden'), false);
  assert.equal(elements.get('crmTabContent').classList.contains('hidden'), true);
});

test('configurações incluem limpeza total protegida para Kalled', () => {
  assert.match(html, /id="resetDatabaseCard"/);
  assert.match(html, /id="resetDatabaseModal"/);
  assert.match(html, /Apagar banco de dados/);
  assert.match(html, /preservados/);
});
