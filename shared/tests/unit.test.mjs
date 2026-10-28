import { test } from 'node:test';
import assert from 'node:assert/strict';
import { status, daysUntil, matches, validate } from '../core.mjs';
import { OctoCertClient } from '../client.mjs';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const input = { client: ' Πελάτης ', facility: 'Κτίριο', number: 'OCT-1', issued: '2026-01-01', due: '2026-10-27' };
const config = { supabaseUrl: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' };
function logged(fetcher) {
  const client = new OctoCertClient(config, fetcher);
  client.setSession({ access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 3600000, user: { id: 'user-a' } });
  return client;
}
function ok(data) { return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
test('dates: yesterday, today, +30 inclusive, +31 and daylight-saving boundary', () => {
  assert.equal(status('2026-10-26', '2026-10-27'), 'late');
  assert.equal(status('2026-10-27', '2026-10-27'), 'soon');
  assert.equal(status('2026-11-26', '2026-10-27'), 'soon');
  assert.equal(status('2026-11-27', '2026-10-27'), 'ok');
  assert.equal(daysUntil('2026-03-30', '2026-03-29'), 1);
});
test('Greek case, accent and final sigma search', () => {
  assert(matches(input, 'ΠΕΛΑΤΗΣ'));
  assert(matches(input, 'πελάτησ'));
  assert(matches(input, 'oct-1'));
  assert(!matches(input, 'άγνωστος'));
});
test('validation trims, rejects blank/oversized fields and impossible dates', () => {
  assert.equal(validate(input).client, 'Πελάτης');
  for (const change of [{ client: '  ' }, { facility: 'a'.repeat(161) }, { due: '2026-02-30' }, { issued: 'bad' }, { due: '2025-01-01' }]) {
    assert.throws(() => validate({ ...input, ...change }));
  }
});
test('configuration rejects secret keys and insecure URLs', () => {
  assert.throws(() => new OctoCertClient({ ...config, publishableKey: 'sb_secret_test' }));
  assert.throws(() => new OctoCertClient({ ...config, supabaseUrl: 'http://example.com' }));
  const roleKey = 'eyJ.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.x';
  assert.throws(() => new OctoCertClient({ ...config, publishableKey: roleKey }));
});
test('login requests a code without opening signup', async () => {
  const client = new OctoCertClient(config, async (url, options) => {
    assert(url.endsWith('/auth/v1/otp'));
    assert.deepEqual(JSON.parse(options.body), { email: 'person@example.com', create_user: false });
    assert(!options.headers.Authorization);
    return ok({});
  });
  await client.sendCode('person@example.com');
});
test('updates contain original row version and treat no match as conflict', async () => {
  const client = logged(async (url, options) => {
    assert(url.endsWith('?id=eq.record-a&version=eq.4'));
    assert.equal(options.method, 'PATCH');
    assert.equal(options.headers.Authorization, 'Bearer access');
    assert(!('version' in JSON.parse(options.body)));
    return ok([]);
  });
  await assert.rejects(client.save(validate(input), { id: 'record-a', version: 4 }), error => error.status === 412);
});
test('create uses unique id, waits for server response and excludes audit fields', async () => {
  const client = logged(async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(options.method, 'POST');
    assert.match(body.id, /^[a-f0-9-]{36}$/);
    assert(!('updated_by' in body));
    assert.equal(options.headers.Prefer, 'return=representation');
    return ok([{ ...body, version: 1 }]);
  });
  assert.equal((await client.save(validate(input))).version, 1);
});
test('pagination reads more than one server page', async () => {
  let count = 0;
  const client = logged(async url => {
    count++;
    if (count === 1) return ok(Array.from({ length: 500 }, (_, i) => ({ id: String(i).padStart(4, '0') })));
    if (count === 2) { assert(url.includes('id=gt.0499')); return ok([{ id: '0500' }]); }
    assert(url.includes('id=gt.0500')); return ok([]);
  });
  assert.equal((await client.list()).length, 501);
});
test('network failure never reports a successful save', async () => {
  const client = logged(async () => { throw Error('offline'); });
  await assert.rejects(client.save(validate(input)), /Δεν επιβεβαιώθηκε/);
});
test('duplicate and denied requests produce useful errors', async () => {
  for (const code of [401, 403, 409, 429]) {
    const client = logged(async () => new Response('{}', { status: code }));
    await assert.rejects(client.save(validate(input)), error => error.status === code);
  }
});
test('concurrent token requests refresh just once', async () => {
  let calls = 0;
  const client = logged(async () => {
    calls++; return ok({ access_token: 'new', refresh_token: 'next', expires_in: 3600, user: { id: 'user-a' } });
  });
  client.session.expires_at = 0;
  assert.deepEqual(await Promise.all([client.token(), client.token()]), ['new', 'new']);
  assert.equal(calls, 1);
});
test('logout during refresh cannot resurrect session', async () => {
  let respond;
  const client = logged(() => new Promise(resolve => { respond = resolve; }));
  client.session.expires_at = 0;
  const pending = client.token();
  client.setSession(null);
  respond(ok({ access_token: 'new', refresh_token: 'next', expires_in: 3600, user: { id: 'user-a' } }));
  await assert.rejects(pending, error => error.status === 401);
  assert.equal(client.session, null);
});
