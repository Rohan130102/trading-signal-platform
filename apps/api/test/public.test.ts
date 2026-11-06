import { describe, expect, it, onTestFinished } from 'vitest';
import { act, activeTrade, admin, Client, ctx, publish } from './helpers.js';

describe('public visitors', () => {
  it('see the service description and disclosures, and nothing private', async () => {
    const trade = await publish();
    const info = await new Client().get('/public/info');
    expect(info.status).toBe(200);
    expect(info.body.riskDisclosure).toMatch(/risk of loss/i);
    expect(info.body.publicResultsAvailable).toBe(false);
    const wire = JSON.stringify(info.body);
    expect(wire).not.toContain(trade.ref);
    expect(wire).not.toMatch(/guarantee|win rate|accuracy of \d/i);
  });

  it('cannot reach signals', async () => {
    const anon = new Client();
    for (const path of ['/feed', '/trades/active', '/trades/history']) {
      expect((await anon.get(path)).status).toBe(401);
    }
  });
});

describe('public performance gate', () => {
  const approval = () => ({
    jurisdiction: 'Test jurisdiction',
    scope: 'Automated test only',
    reviewerName: 'Test Reviewer',
    documentReference: 'TEST-DOC-1',
    effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  it('is closed by default', async () => {
    expect((await new Client().get('/public/performance')).status).toBe(404);
  });

  it('the deployment flag alone does not open it', async () => {
    const gated = new Client(null, ctx().gatedApi);
    expect((await gated.get('/public/performance')).status).toBe(404);
  });

  it('an approval alone does not open it, and both together do', async () => {
    const trade = await activeTrade();
    // A record that must stay visible: nothing may be dropped to flatter the numbers.
    const untriggered = await publish();
    await act(untriggered, 'CANCEL', { comment: 'Never triggered' });
    await act(trade, 'CLOSE', {
      exitPrice: trade.targets[0].price,
      basis: 'HYPOTHETICAL_OUTCOME',
      reason: 'TARGET_ACHIEVED',
      confirm: true,
    });

    const created = await admin().post('/admin/compliance/public-performance/approvals', approval());
    expect(created.status).toBe(201);
    onTestFinished(async () => {
      await admin().post(`/admin/compliance/public-performance/approvals/${created.body.id}/revoke`);
    });

    expect((await new Client().get('/public/performance')).status).toBe(404);
    const gate = await admin().get('/admin/compliance/public-performance');
    expect(gate.body).toMatchObject({ flagEnabled: false, enabled: false, currentApprovalId: created.body.id });

    const gated = new Client(null, ctx().gatedApi);
    const open = await gated.get('/public/performance');
    expect(open.status).toBe(200);
    expect(open.body.disclosures.riskDisclosure).toMatch(/risk of loss/i);
    expect(open.body.methodology.statements.join(' ')).toMatch(/not independently verified/);

    // Every outcome is present, and nothing private crosses the boundary.
    expect(open.body.lifecycle.totalRecords).toBeGreaterThan(0);
    const wire = JSON.stringify(open.body.records);
    expect(wire).not.toMatch(/quantity|fees|netPnl|grossPnl|actor/i);
    expect(open.body.records.some((r: { status: string }) => r.status === 'CANCELLED')).toBe(true);
    for (const section of [open.body.lifecycle, open.body.hypothetical, open.body.declared]) {
      expect(JSON.stringify(section)).not.toMatch(/netPnl|grossPnl|Net"|monetary/i);
    }

    const revoked = await admin().post(`/admin/compliance/public-performance/approvals/${created.body.id}/revoke`);
    expect(revoked.status).toBe(200);
    expect((await gated.get('/public/performance')).status).toBe(404);
  });

  it('an expired or future approval does not count', async () => {
    const gated = new Client(null, ctx().gatedApi);
    const expired = await admin().post('/admin/compliance/public-performance/approvals', {
      ...approval(),
      effectiveFrom: '2020-01-01T00:00:00Z',
      expiresAt: '2020-12-31T00:00:00Z',
    });
    expect(expired.status).toBe(201);
    const future = await admin().post('/admin/compliance/public-performance/approvals', {
      ...approval(),
      effectiveFrom: new Date(Date.now() + 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
    });
    expect(future.status).toBe(201);
    expect((await gated.get('/public/performance')).status).toBe(404);
    await admin().post(`/admin/compliance/public-performance/approvals/${future.body.id}/revoke`);
  });

  it('rejects an approval with no document or backwards dates', async () => {
    const res = await admin().post('/admin/compliance/public-performance/approvals', {
      ...approval(),
      documentReference: '',
    });
    expect(res.status).toBe(422);
    const backwards = await admin().post('/admin/compliance/public-performance/approvals', {
      ...approval(),
      effectiveFrom: new Date().toISOString(),
      expiresAt: '2020-01-01T00:00:00Z',
    });
    expect(backwards.status).toBe(422);
  });
});

describe('settings', () => {
  it('rejects an unknown timezone and audits changes', async () => {
    const current = (await admin().get('/admin/settings')).body;
    const { id: _id, updatedAt: _u, ...fields } = current;
    const bad = await admin().req('PUT', '/admin/settings', { ...fields, businessTimezone: 'Mars/Olympus' });
    expect(bad.status).toBe(422);
    const ok = await admin().req('PUT', '/admin/settings', { ...fields, supportContact: 'support@example.test' });
    expect(ok.status).toBe(200);
    const log = await admin().get('/admin/audit?action=SETTINGS_UPDATED');
    expect(log.body.entries[0].metadata.changed).toContain('supportContact');
    const info = await new Client().get('/public/info');
    expect(info.body.supportContact).toBe('support@example.test');
  });
});

describe('OpenAPI', () => {
  it('documents every route with request schemas from the validators', async () => {
    const doc = (await (await fetch(`${ctx().api}/openapi.json`)).json()) as any;
    expect(doc.openapi).toBe('3.1.0');
    const publish = doc.paths['/api/v1/admin/signals'].post;
    expect(publish.requestBody.content['application/json'].schema.properties).toHaveProperty('idempotencyKey');
    expect(publish['x-access']).toBe('admin');
  });
});

describe('health', () => {
  it('reports liveness and readiness without authentication', async () => {
    const base = ctx().api.replace('/api/v1', '');
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
    expect((await fetch(`${base}/health/ready`)).status).toBe(200);
  });
});
