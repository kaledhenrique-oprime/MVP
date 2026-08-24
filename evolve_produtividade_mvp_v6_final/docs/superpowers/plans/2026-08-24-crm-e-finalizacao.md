# CRM e Finalização Direta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um CRM compartilhado, finalização de expediente pela seleção de perfis, fotos no histórico e cartões de atividade com melhor aproveitamento visual.

**Architecture:** O servidor Node continuará usando `data/db.json`, acrescentando `crmRecords` e rotas REST de CRUD. A interface continuará em JavaScript e HTML nativos; o CRM será um painel do aplicativo com tabela, filtros e modal de edição, enquanto a finalização direta reutilizará o relatório existente por meio de funções compartilhadas no cliente.

**Tech Stack:** Node.js 20+, HTTP nativo, HTML5, CSS3, JavaScript sem framework, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-24-crm-e-finalizacao-design.md`

## Global Constraints

- Todos os consultores podem visualizar, criar, editar, concluir e excluir registros de CRM.
- A lista de prioridades é: `none`, `when_possible`, `important`, `urgent`.
- A lista de status é: `pending`, `follow_up`, `done`.
- Marcar `completed=true` define `status="done"`; definir outro status remove a conclusão.
- Uma sessão zerada só permanece no histórico quando o usuário escolhe **Sim** em **Salvar dados?**.
- O fluxo com métricas continua salvando relatório normalmente.
- A interface deve permanecer utilizável sem rolagem horizontal na grade de atividades e na tabela de desempenho.

---

## File Structure

- `server.js`: persistência, validação e rotas de expediente, histórico e CRM.
- `public/app.js`: fluxo da seleção de perfis, relatório, histórico e controlador do CRM.
- `public/index.html`: navegação, painel CRM, modal de edição e diálogo de sessão zerada.
- `public/style.css`: seleção de perfis, histórico e estilos gerais do CRM.
- `public/activity-ui.css`: dimensionamento dos cartões e controles de atividade.
- `test/shift-experience.test.js`: contratos de API, encerramento e histórico.
- `test/ui-contract.test.js`: estrutura DOM e contratos visuais.
- `test/crm.test.js`: CRUD, validações e sincronização do CRM.

---

### Task 1: Persistência e API do CRM

**Files:**
- Modify: `server.js`
- Create: `test/crm.test.js`

**Interfaces:**
- Produces: `GET /api/crm`, `POST /api/crm`, `PATCH /api/crm/:id`, `DELETE /api/crm/:id`.
- Produces record: `{ id, completed, date, consultantId, enrollmentId, clientName, priority, subject, details, followUp, status, createdAt, updatedAt }`.

- [ ] **Step 1: Write failing CRUD and validation tests**

```js
test('CRM cria, edita, conclui e exclui um registro compartilhado', async () => {
  const created = await request('/api/crm', { method: 'POST', body: JSON.stringify({
    date: '2026-08-24', consultantId: 'c1', enrollmentId: '230078',
    clientName: 'Mateus Salgado Cavalcante', priority: 'important',
    subject: 'Negociação', details: 'Detalhes no CRM',
    followUp: 'Retornar antes do dia 30', status: 'pending'
  }) });
  assert.equal(created.completed, false);
  const edited = await request(`/api/crm/${created.id}`, {
    method: 'PATCH', body: JSON.stringify({ completed: true })
  });
  assert.equal(edited.status, 'done');
  assert.equal((await request('/api/crm')).length, 1);
  await request(`/api/crm/${created.id}`, { method: 'DELETE' });
  assert.equal((await request('/api/crm')).length, 0);
});

test('CRM rejeita consultor, data, prioridade e status inválidos', async () => {
  for (const payload of [
    { date: '24/08/2026', consultantId: 'c1', clientName: 'Cliente', subject: 'Assunto' },
    { date: '2026-08-24', consultantId: 'inexistente', clientName: 'Cliente', subject: 'Assunto' },
    { date: '2026-08-24', consultantId: 'c1', clientName: 'Cliente', subject: 'Assunto', priority: 'alta' },
    { date: '2026-08-24', consultantId: 'c1', clientName: 'Cliente', subject: 'Assunto', status: 'aberto' }
  ]) assert.equal(await responseStatus('/api/crm', payload), 400);
});
```

- [ ] **Step 2: Run the CRM tests and verify the routes fail**

Run: `node --test test/crm.test.js`

Expected: FAIL because `/api/crm` does not exist.

- [ ] **Step 3: Add the database collection and normalization**

Add the exact property `crmRecords: []` after `cancellationPendings: []` in `DEFAULT_DB`, then add the normalization line below to `db()` after the existing collection normalizations:

```js
data.crmRecords = data.crmRecords || [];
```

- [ ] **Step 4: Add CRM validation and route handlers**

```js
const CRM_PRIORITIES = new Set(['none', 'when_possible', 'important', 'urgent']);
const CRM_STATUSES = new Set(['pending', 'follow_up', 'done']);
function normalizeCrmPayload(body, data, existing = {}) {
  const record = { ...existing, ...body };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) throw new Error('Data inválida.');
  if (!data.consultants.some(c => c.id === record.consultantId)) throw new Error('Consultor inválido.');
  if (!String(record.clientName || '').trim() || !String(record.subject || '').trim()) throw new Error('Cliente e assunto são obrigatórios.');
  if (!CRM_PRIORITIES.has(record.priority || 'none')) throw new Error('Prioridade inválida.');
  if (!CRM_STATUSES.has(record.status || 'pending')) throw new Error('Status inválido.');
  record.completed = Boolean(record.completed || record.status === 'done');
  record.status = record.completed ? 'done' : record.status;
  return record;
}
```

Add the four routes before static-file handling and return status `400` for validation errors, `404` for missing records, `201` on create and `200` on read/update/delete.

- [ ] **Step 5: Run CRM and existing tests**

Run: `node --test test/crm.test.js test/shift-experience.test.js test/ui-contract.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit the CRM backend**

```bash
git add server.js test/crm.test.js
git commit -m "feat: adiciona API compartilhada de CRM"
```

---

### Task 2: Tela CRM’s

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Modify: `test/ui-contract.test.js`

**Interfaces:**
- Consumes: CRUD `/api/crm` from Task 1.
- Produces: `openCrm()`, `closeCrm()`, `renderCrmRows()`, `applyCrmFilters()`, `openCrmForm(id)`, `saveCrmRecord()`, `toggleCrmCompleted(id, checked)`, `deleteCrmRecord(id)`.

- [ ] **Step 1: Add failing UI contract tests**

```js
test('a navegação abre a planilha CRM com todas as colunas', () => {
  assert.match(html, />CRM’s</);
  for (const label of ['Concluído', 'Data', 'Consultor', 'Matrícula/ID', 'Nome do cliente', 'Prioridade', 'Assunto', 'Detalhes do CRM', 'Acompanhamento', 'Status']) {
    assert.match(html, new RegExp(label.replace('/', '\\/')));
  }
  assert.match(html, /id="crmConsultantFilter"/);
  assert.match(html, /id="crmPriorityFilter"/);
  assert.match(html, /id="crmStatusFilter"/);
  assert.match(html, /id="crmFormModal"/);
});
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run: `node --test --test-name-pattern="planilha CRM" test/ui-contract.test.js`

Expected: FAIL because the navigation and CRM panel are absent.

- [ ] **Step 3: Add the navigation, panel and form modal**

Add a sidebar button calling `openCrm()`. Add `#crmSection` with filter selects, `#crmTableBody`, empty state and **Novo registro**. Add `#crmFormModal` containing inputs for the ten fields and buttons **Salvar registro** and **Cancelar**.

- [ ] **Step 4: Implement CRM state and rendering**

```js
state.crmRecords = [];
state.crmEditingId = null;

async function openCrm() {
  state.crmRecords = await api('/api/crm');
  populateCrmConsultants();
  renderCrmRows();
  document.getElementById('crmSection').classList.remove('hidden');
  document.getElementById('crmSection').scrollIntoView({ behavior: 'smooth' });
}

function filteredCrmRecords() {
  const consultant = document.getElementById('crmConsultantFilter').value;
  const priority = document.getElementById('crmPriorityFilter').value;
  const status = document.getElementById('crmStatusFilter').value;
  return state.crmRecords.filter(r => (!consultant || r.consultantId === consultant) && (!priority || r.priority === priority) && (!status || r.status === status));
}
```

`renderCrmRows()` must escape every text field, map `consultantId` to the consultant name and render colored classes `priority-*` and `status-*`.

- [ ] **Step 5: Implement create, edit, complete and delete actions**

```js
async function toggleCrmCompleted(id, completed) {
  await api(`/api/crm/${id}`, { method: 'PATCH', body: JSON.stringify({ completed }) });
  await openCrm();
}

async function deleteCrmRecord(id) {
  if (!confirm('Excluir este registro do CRM?')) return;
  await api(`/api/crm/${id}`, { method: 'DELETE' });
  await openCrm();
}
```

`saveCrmRecord()` serializes the form and uses `POST` when `state.crmEditingId` is null or `PATCH` otherwise. API errors are written to `#crmFormError` without closing the modal.

- [ ] **Step 6: Style the spreadsheet**

Add a full-width card, sticky header, compact rows, colored select-like pills, checkbox column, action buttons, horizontal overflow only inside `.crm-table-wrap`, and a one-column mobile form below `700px`.

- [ ] **Step 7: Run all tests**

Run: `node --test test/*.test.js`

Expected: all tests PASS.

- [ ] **Step 8: Commit the CRM interface**

```bash
git add public/index.html public/app.js public/style.css test/ui-contract.test.js
git commit -m "feat: adiciona tela de CRM em formato de planilha"
```

---

### Task 3: Finalização pela seleção de perfis

**Files:**
- Modify: `server.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/style.css`
- Modify: `test/shift-experience.test.js`
- Modify: `test/ui-contract.test.js`

**Interfaces:**
- Changes: `POST /api/shifts/end` accepts `{ consultantId, persist?: boolean }`.
- Produces: `finishShiftById(consultantId)`, `sessionHasRecords(stats)`, `showFinishReport(result)`.

- [ ] **Step 1: Write failing server tests for zero-session persistence**

```js
test('expediente zerado pode terminar sem entrar no histórico', async () => {
  await request('/api/shifts/start', { method: 'POST', body: JSON.stringify({ consultantId: 'c1' }) });
  await request('/api/shifts/end', { method: 'POST', body: JSON.stringify({ consultantId: 'c1', persist: false }) });
  assert.equal((await request('/api/history')).some(s => s.consultantId === 'c1' && !s.reportStats), false);
});

test('expediente zerado pode salvar relatório no histórico', async () => {
  await request('/api/shifts/start', { method: 'POST', body: JSON.stringify({ consultantId: 'c1' }) });
  const ended = await request('/api/shifts/end', { method: 'POST', body: JSON.stringify({ consultantId: 'c1', persist: true }) });
  assert.deepEqual(ended.stats, { messages: 0, goal: 300, activities: {} });
});
```

- [ ] **Step 2: Run the tests and verify `persist:false` fails**

Run: `node --test --test-name-pattern="expediente zerado" test/shift-experience.test.js`

Expected: FAIL because the server always retains the shift.

- [ ] **Step 3: Implement atomic non-persistence**

In `/api/shifts/end`, compute the snapshot first. When `b.persist === false`, remove only `shift.id` from `data.shifts`, save once and return `{ shift, consultant, stats, persisted: false }`. Otherwise retain the existing completed shift and return `persisted: true`.

- [ ] **Step 4: Add failing selection-screen UI tests**

```js
test('perfil ativo oferece continuar e finalizar sem aninhar botões', () => {
  const markup = vm.runInContext(`consultantCardHtml({ id:'c1', name:'Kalled', startTime:'05:00', dailyGoal:20 }, true)`, context);
  assert.match(markup, /Continuar expediente/);
  assert.match(markup, /Finalizar expediente/);
  assert.doesNotMatch(markup, /<button[^>]*>[\s\S]*<button/);
});
```

- [ ] **Step 5: Refactor the consultant card into a non-button container**

Render `.consultant-btn` as a `<div>` with two sibling buttons when active. Inactive profiles keep one **Iniciar expediente** button. Do not use nested interactive elements.

- [ ] **Step 6: Add the zero-session decision modal and shared report presenter**

Add `#emptyShiftDecisionModal` with **Sim** and **Não**. Implement:

```js
function sessionHasRecords(stats) {
  return Number(stats?.messages || 0) > 0 || Object.values(stats?.activities || {}).some(Number);
}

function showFinishReport(result) {
  const text = buildShiftReport(result);
  document.getElementById('finishReportContent').textContent = text;
  document.getElementById('finishReportModal').classList.remove('hidden');
  configureReportCopy(text);
}
```

`finishShiftById()` fetches `/api/session-stats`. If zero, opens the decision modal; **Sim** posts `persist:true` and calls `showFinishReport`; **Não** posts `persist:false`, closes the modal and reloads the selection. If nonzero, it confirms, ends with `persist:true` and shows the report.

- [ ] **Step 7: Make in-profile finalization use the shared presenter**

Replace duplicated modal/copy code in `finishShift()` with `showFinishReport(result)`. Preserve break cleanup, session reset and report text.

- [ ] **Step 8: Run all tests and commit**

Run: `node --test test/*.test.js`

Expected: all tests PASS.

```bash
git add server.js public/app.js public/index.html public/style.css test/shift-experience.test.js test/ui-contract.test.js
git commit -m "feat: permite finalizar expediente na seleção"
```

---

### Task 4: Foto do consultor no histórico

**Files:**
- Modify: `server.js`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Modify: `test/shift-experience.test.js`

**Interfaces:**
- Changes history record: adds `consultantPhoto: string`.

- [ ] **Step 1: Write failing API and rendering tests**

```js
test('histórico fornece e renderiza a foto do consultor', async () => {
  const history = await request('/api/history');
  assert.equal(typeof history[0].consultantPhoto, 'string');
  const markup = vm.runInContext(`historyShiftHtml(${JSON.stringify({
    consultantName: 'Kalled', consultantPhoto: 'data:image/png;base64,abc',
    date: '2026-08-24', startedAt: '2026-08-24T08:00:00Z', endedAt: null, stats: {}
  })})`, appContext());
  assert.match(markup, /<img[^>]+history-avatar/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test --test-name-pattern="foto do consultor" test/shift-experience.test.js`

Expected: FAIL because history returns and renders initials only.

- [ ] **Step 3: Return and render the photo**

Add `consultantPhoto: c?.photo || ''` to `/api/history`. In `historyShiftHtml`, call `avatarHtml({ name: x.consultantName, photo: x.consultantPhoto }, 'history-avatar')` rather than hardcoding initials. Style `.history-avatar` for both `<img>` and `<div>` with `object-fit: cover`.

- [ ] **Step 4: Run tests and commit**

Run: `node --test test/*.test.js`

Expected: all tests PASS.

```bash
git add server.js public/app.js public/style.css test/shift-experience.test.js
git commit -m "fix: exibe fotos no histórico de expedientes"
```

---

### Task 5: Aproveitamento visual dos cartões

**Files:**
- Modify: `public/activity-ui.css`
- Modify: `test/ui-contract.test.js`

**Interfaces:**
- Preserves: four columns on desktop and existing card height.

- [ ] **Step 1: Tighten the CSS contract test**

```js
test('cartões usam controles e conteúdo maiores sem crescer a grade', () => {
  const css = fs.readFileSync(path.join(projectRoot, 'public/activity-ui.css'), 'utf8');
  const button = cssRule(css, '.counter-btn');
  const value = cssRule(css, '.counter-value');
  const card = cssRule(css, '.activity-btn-round');
  assert.ok(Number.parseFloat(button.width) >= 44);
  assert.ok(Number.parseFloat(button.height) >= 44);
  assert.ok(Number.parseFloat(value['font-size']) >= 20);
  assert.equal(card['min-height'], '188px');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test --test-name-pattern="conteúdo maiores" test/ui-contract.test.js`

Expected: FAIL because controls are `38px` and values are `18px`.

- [ ] **Step 3: Increase content scale without increasing card height**

Set regular counter buttons to `44px`, counter values to `20px`, activity icons to at least `54px`, titles to `16px` and descriptions to `12.5px`. Reduce unused spacing between the top content and control row. Keep the compact charge-card counters and timer card dimensions unchanged so all eight cards remain aligned.

- [ ] **Step 4: Run UI and full tests, then commit**

Run: `node --test test/ui-contract.test.js && node --test test/*.test.js`

Expected: all tests PASS.

```bash
git add public/activity-ui.css test/ui-contract.test.js
git commit -m "style: amplia controles dos cartões de atividade"
```

---

### Task 6: Integration Verification and Delivery

**Files:**
- Modify only if verification exposes a scoped defect.

**Interfaces:**
- Consumes every interface from Tasks 1–5.
- Produces a verified GitHub commit and downloadable ZIP.

- [ ] **Step 1: Run syntax and full automated checks**

```bash
node --check server.js
node --check business-date.js
node --check public/app.js
node --check public/activity-ui.js
node --test test/*.test.js
```

Expected: all checks exit `0`.

- [ ] **Step 2: Review the complete diff against the spec**

Check every spec section: activity controls, login finalization, zero-data decision, report copy, history photo, ten CRM columns, filters, CRUD, controlled values, validations and responsive behavior.

- [ ] **Step 3: Request independent code review**

Ask the reviewer to prioritize data-loss risks, nested interactive controls, API validation, zero-report semantics, HTML escaping and mobile overflow. Fix important findings with a new failing test before changing production code.

- [ ] **Step 4: Re-run the full suite after review fixes**

Run the five commands from Step 1 again and confirm fresh passing output.

- [ ] **Step 5: Publish one fast-forward commit to `main`**

Verify the remote head immediately before publishing. Create blobs and a tree based on that head; update `main` with `force:false`.

- [ ] **Step 6: Build and verify the ZIP**

```bash
zip -qr MVP-consultor-crm-atualizado.zip evolve_produtividade_mvp_v6_final
unzip -t MVP-consultor-crm-atualizado.zip
```

Extract into a fresh temporary directory and run `node --test test/*.test.js` from the extracted project. Deliver the repository, commit and ZIP links.
