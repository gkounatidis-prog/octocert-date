// Run ONLY against a disposable test project. Creates one QA certificate and its history.
// Tokens must be supplied via the execution environment, never committed or pasted into chat.
import assert from 'node:assert/strict';
import { OctoCertClient } from '../client.mjs';
if (process.env.OCTOCERT_LIVE_TEST !== '1') {
  console.log('SKIPPED: live security/concurrency tests require a configured disposable Supabase project.');
  process.exit(0);
}
const config = { supabaseUrl: process.env.OCTOCERT_TEST_URL, publishableKey: process.env.OCTOCERT_TEST_KEY };
function sessionClient(token) {
  assert(token, 'Provide test tokens for two members and one non-member.');
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert(claims.exp * 1000 > Date.now() + 60000, 'Use a fresh test session.');
  const client = new OctoCertClient(config);
  client.setSession({ access_token: token, expires_at: claims.exp * 1000, user: { id: claims.sub } });
  return client;
}
const a = sessionClient(process.env.OCTOCERT_TEST_MEMBER_A_TOKEN);
const b = sessionClient(process.env.OCTOCERT_TEST_MEMBER_B_TOKEN);
const outsider = sessionClient(process.env.OCTOCERT_TEST_NONMEMBER_TOKEN);
assert.notEqual(a.session.user.id, b.session.user.id);
assert(await a.isMember()); assert(await b.isMember()); assert.equal(await outsider.isMember(), false);
const anonymous = await fetch(config.supabaseUrl + '/rest/v1/octocert_certificates?select=id', { headers: { apikey: config.publishableKey } });
assert([401, 403].includes(anonymous.status), 'Anonymous certificate reads must be denied.');
assert.deepEqual(await outsider.list(), [], 'Non-members must not read any certificates.');
const record = { client: 'QA — δοκιμή πρόσβασης', facility: 'Δοκιμαστικό περιβάλλον', number: 'QA-' + crypto.randomUUID(), issued: '2026-01-01', due: '2027-01-01' };
await assert.rejects(outsider.save(record));
const created = await a.save(record);
assert.equal(created.version, 1);
assert((await b.list()).some(row => row.id === created.id));
const outcomes = await Promise.allSettled([
  a.save({ ...record, client: 'Συνεργάτης A' }, created),
  b.save({ ...record, client: 'Συνεργάτης B' }, created)
]);
assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1, 'Exactly one concurrent update must succeed.');
assert.equal(outcomes.find(outcome => outcome.status === 'rejected').reason.status, 412);
const history = await b.history(created.id);
assert.equal(history.length, 2, 'Creation and successful update must each be logged.');
assert(history.every(row => row.actor_email && row.after_data));
assert(history.some(row => row.action === 'UPDATE' && row.before_data.version === 1 && row.after_data.version === 2));
const token = await a.token();
for (const [path, method, body] of [
  ['/rest/v1/octocert_members?user_id=eq.' + outsider.session.user.id, 'PATCH', { active: true }],
  ['/rest/v1/octocert_history?certificate_id=eq.' + created.id, 'DELETE', null],
  ['/rest/v1/octocert_certificates?id=eq.' + created.id, 'DELETE', null],
  ['/rest/v1/octocert_certificates?id=eq.' + created.id, 'PATCH', { version: 100 }]
]) {
  const response = await fetch(config.supabaseUrl + path, { method, headers: { apikey: config.publishableKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert([401, 403].includes(response.status), 'Privileged mutation must be denied.');
}
console.log('PASS: live membership, anonymous/outsider isolation, shared reads, concurrent edits, immutable audit history and protected membership. One QA record remains in the test database.');
