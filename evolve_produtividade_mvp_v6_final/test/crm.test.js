const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
let server, tempRoot, baseUrl;

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const response = await fetch(baseUrl); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor não iniciou.');
}

async function response(pathname, options = {}) {
  const result = await fetch(`${baseUrl}${pathname}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  return { status: result.status, body: await result.json() };
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-crm-test-'));
  fs.cpSync(projectRoot, tempRoot, { recursive: true, filter: source => !source.includes(`${path.sep}.git${path.sep}`) && !source.includes(`${path.sep}node_modules${path.sep}`) && !source.includes(`${path.sep}test${path.sep}`) });
  fs.writeFileSync(path.join(tempRoot, 'data/db.json'), JSON.stringify({ consultants: [{ id: 'c1', name: 'Kalled', startTime: '05:00', dailyGoal: 20, photo: '' }], messages: [], activities: [], shifts: [], cancellationPendings: [] }));
  const port = 43500 + Math.floor(Math.random() * 700);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], { cwd: tempRoot, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer();
});

after(() => { server?.kill('SIGTERM'); fs.rmSync(tempRoot, { recursive: true, force: true }); });

test('CRM cria, lista, edita, conclui e exclui registros compartilhados', async () => {
  const created = await response('/api/crm', { method: 'POST', body: JSON.stringify({ date: '2026-08-24', consultantId: 'c1', enrollmentId: '230078', clientName: 'Mateus Salgado Cavalcante', priority: 'important', subject: 'Negociação', details: 'Detalhes no CRM', followUp: 'Retornar antes do dia 30', status: 'pending' }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.completed, false);
  const completed = await response(`/api/crm/${created.body.id}`, { method: 'PATCH', body: JSON.stringify({ completed: true }) });
  assert.equal(completed.body.completed, true);
  assert.equal(completed.body.status, 'done');
  const listed = await response('/api/crm');
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].clientName, 'Mateus Salgado Cavalcante');
  assert.equal((await response(`/api/crm/${created.body.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await response('/api/crm')).body, []);
});

test('CRM rejeita campos controlados e obrigatórios inválidos', async () => {
  const invalidPayloads = [
    { date: '24/08/2026', consultantId: 'c1', clientName: 'Cliente', subject: 'Assunto' },
    { date: '2026-08-24', consultantId: 'inexistente', clientName: 'Cliente', subject: 'Assunto' },
    { date: '2026-08-24', consultantId: 'c1', clientName: '', subject: 'Assunto' },
    { date: '2026-08-24', consultantId: 'c1', clientName: 'Cliente', subject: 'Assunto', priority: 'alta' },
    { date: '2026-08-24', consultantId: 'c1', clientName: 'Cliente', subject: 'Assunto', status: 'aberto' }
  ];
  for (const payload of invalidPayloads) assert.equal((await response('/api/crm', { method: 'POST', body: JSON.stringify(payload) })).status, 400);
});
