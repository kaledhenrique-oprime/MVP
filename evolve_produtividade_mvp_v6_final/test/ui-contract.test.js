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

test('os cartões têm controles próximos e conteúdo com espaço seguro', () => {
  const stylesheet = fs.readFileSync(path.join(projectRoot, 'public/activity-ui.css'), 'utf8');
  const counter = cssRule(stylesheet, '.compact-counter');
  const cards = cssRule(stylesheet, '.activity-btn-round');
  const charges = cssRule(stylesheet, '.charge-group-card');
  const chargeHeader = cssRule(stylesheet, '.charge-group-card .activity-top');

  assert.equal(counter.width, 'max-content');
  assert.ok(Number.parseFloat(counter.gap) <= 5);
  assert.ok(Number.parseFloat(cards['min-height']) >= 188);
  assert.ok(Number.parseFloat(charges.height) >= 188);
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
});
