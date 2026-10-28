import { today, daysUntil, status, matches, validate } from './core.mjs';
import { OctoCertClient } from './client.mjs';
const $ = selector => document.querySelector(selector);
const SESSION_KEY = 'octocert-shared-session-v1';
let client, records = [], editing = null, ready = false, generation = 0, loading = false, saving = false;
function persistSession() {
  try {
    if (client.session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(client.session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* Session remains in memory when browser storage is unavailable. */ }
}
function markReady(value) {
  ready = value;
  $('#add').disabled = !value;
  $('#export').disabled = !value;
}
function showLogin(message = '') {
  generation += 1;
  client?.setSession(null);
  if (client) persistSession();
  records = []; editing = null; markReady(false);
  $('#workspace').hidden = true; $('#login').hidden = false;
  $('#dialog').close(); $('#history-dialog').close();
  $('#form').reset(); $('#history-content').replaceChildren(); $('#message').textContent = '';
  $('#code').value = ''; $('#email-form').hidden = false; $('#code-form').hidden = true;
  $('#login-message').textContent = message;
  render();
}
async function handleError(error, target = '#message') {
  if (error.status === 401 || error.status === 403) { showLogin(error.message); return; }
  $(target).textContent = error.message;
}
async function loadRecords() {
  if (!client?.session || loading) return;
  loading = true;
  const current = generation;
  try {
    if (!await client.isMember()) {
      if (current === generation) showLogin('Δεν έχει ενεργοποιηθεί η πρόσβασή σας. Επικοινωνήστε με τον διαχειριστή.');
      return;
    }
    const result = await client.list();
    if (current !== generation) return;
    records = result; persistSession(); markReady(true); render();
    $('#sync').textContent = '● Ενημερώθηκε ' + new Intl.DateTimeFormat('el-GR', { timeStyle: 'medium', timeZone: 'Europe/Athens' }).format(new Date());
    $('#sync').className = '';
  } catch (error) {
    if (current !== generation) return;
    markReady(false); render();
    $('#sync').textContent = '⚠ Δεν επιβεβαιώθηκε η ενημέρωση · Απαιτείται ανανέωση';
    $('#sync').className = 'stale';
    await handleError(error);
  } finally { loading = false; }
}
async function startSession() {
  const current = generation;
  if (!await client.isMember()) throw new Error('Το email σας δεν έχει ενεργή πρόσβαση στο μητρώο. Επικοινωνήστε με τον διαχειριστή.');
  if (current !== generation) return;
  persistSession();
  $('#account').textContent = client.session.user.email;
  $('#login').hidden = true; $('#workspace').hidden = false;
  $('#code').value = ''; $('#login-message').textContent = '';
  await loadRecords();
}
const labels={late:'Εκπρόθεσμο',soon:'Εντός 30 ημερών',ok:'Σε ισχύ'};
const fmt=d=>new Intl.DateTimeFormat('el-GR').format(new Date(d+'T12:00:00Z'));
function cell(text){const el=document.createElement('td');el.textContent=text;return el;}
function render(){
$('#today').textContent=new Intl.DateTimeFormat('el-GR',{dateStyle:'long',timeZone:'Europe/Athens'}).format(new Date());
$('#stats').replaceChildren();
[['all','Σύνολο πιστοποιητικών','Στο μητρώο σας','▤'],['late','Εκπρόθεσμοι επανέλεγχοι','Χρειάζονται προσοχή','!'],['soon','Εντός 30 ημερών','Από σήμερα έως και +30 ημέρες','◷'],['ok','Σε ισχύ','Επανέλεγχος μετά τις 30 ημέρες','✓']].forEach(([key,label,sub,symbol])=>{const div=document.createElement('div');div.className='stat '+key;const count=key==='all'?records.length:records.filter(r=>status(r.due)===key).length;div.innerHTML=`<span class="label">${label}</span><span class="symbol">${symbol}</span><span class="value">${String(count).padStart(2,'0')}</span><small>${sub}</small>`;$('#stats').append(div);});
const visible=records.filter(r=>matches(r,$('#search').value)&&($('#filter').value==='all'||status(r.due)===$('#filter').value)).sort((a,b)=>a.due.localeCompare(b.due));
$('#rows').replaceChildren();visible.forEach(r=>{const tr=document.createElement('tr');const client=cell('');const strong=document.createElement('strong');strong.textContent=r.client;const small=document.createElement('small');small.textContent=r.facility;client.append(strong,small);tr.append(client,cell(r.number),cell(fmt(r.issued)));const due=cell(fmt(r.due));const detail=document.createElement('small');const days=daysUntil(r.due);detail.textContent=days<0?`Καθυστέρηση ${-days} ημερών`:days===0?'Σήμερα':`Σε ${days} ημέρες`;due.append(detail);tr.append(due);const state=cell('');const badge=document.createElement('span');badge.className='badge '+status(r.due);badge.textContent='● '+labels[status(r.due)];state.append(badge);tr.append(state);const action=cell('');const edit=document.createElement('button');edit.className='edit';edit.textContent='Επεξεργασία';edit.setAttribute('aria-label','Επεξεργασία '+r.number);edit.onclick=()=>openForm(r);edit.disabled=!ready;const history=document.createElement('button');history.className='edit';history.textContent='Ιστορικό';history.onclick=()=>showHistory(r);action.append(edit,history);tr.append(action);$('#rows').append(tr);});$('#count').textContent=`${visible.length} από ${records.length} πιστοποιητικά`;$('#empty').hidden=visible.length!==0;}
function openForm(record) {
  if (!ready) return;
  editing = record ? { ...record } : null;
  $('#form').reset(); $('#form-error').textContent = '';
  $('#form').querySelector('[type="submit"]').disabled = false;
  $('#form-title').textContent = record ? 'Επεξεργασία πιστοποιητικού' : 'Νέο πιστοποιητικό';
  for (const key of ['id', 'client', 'facility', 'number', 'issued', 'due']) $('#form').elements[key].value = record ? record[key] : '';
  $('#dialog').showModal();
}
async function showHistory(record) {
  const current = generation;
  $('#history-content').textContent = 'Φόρτωση…'; $('#history-dialog').showModal();
  try {
    const rows = await client.history(record.id);
    if (current !== generation || !$('#history-dialog').open) return;
    persistSession(); $('#history-content').replaceChildren();
    if (!rows.length) $('#history-content').textContent = 'Δεν βρέθηκαν αλλαγές.';
    const names = { client: 'Πελάτης', facility: 'Εγκατάσταση', number: 'Αριθμός', issued: 'Έκδοση', due: 'Επανέλεγχος' };
    rows.forEach(row => {
      const details = document.createElement('details'); details.className = 'history-entry';
      const summary = document.createElement('summary');
      summary.textContent = (row.action === 'INSERT' ? 'Δημιουργία' : 'Αλλαγή') + ' · ' + row.actor_email + ' · ' + new Intl.DateTimeFormat('el-GR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Athens' }).format(new Date(row.changed_at));
      const list = document.createElement('dl');
      for (const [key, name] of Object.entries(names)) {
        if (row.before_data && row.before_data[key] === row.after_data[key]) continue;
        const label = document.createElement('dt'); label.textContent = name;
        const value = document.createElement('dd'); value.textContent = (row.before_data ? row.before_data[key] + ' → ' : '') + row.after_data[key];
        list.append(label, value);
      }
      details.append(summary, list); $('#history-content').append(details);
    });
  } catch (error) { if (current === generation) await handleError(error, '#history-content'); }
}
$('#add').onclick = () => openForm();
$('#close').onclick = $('#cancel').onclick = () => $('#dialog').close();
$('#close-history').onclick = () => $('#history-dialog').close();
$('#search').oninput = render; $('#filter').onchange = render;
$('#refresh').onclick = async () => { $('#message').textContent = ''; await loadRecords(); };
$('#form').onsubmit = async event => {
  event.preventDefault();
  if (saving || !client?.session) return;
  const current = generation;
  const submit = $('#form').querySelector('[type="submit"]');
  let conflict = false;
  try {
    const record = validate(Object.fromEntries(new FormData(event.target)));
    saving = true; submit.disabled = true; $('#form-error').textContent = '';
    const result = await client.save(record, editing);
    if (current !== generation) return;
    persistSession();
    records = [...records.filter(row => row.id !== result.id), result];
    $('#dialog').close(); render();
    $('#message').textContent = 'Το πιστοποιητικό αποθηκεύτηκε στην κοινή βάση.';
    await loadRecords();
  } catch (error) {
    conflict = error.status === 412;
    if (current === generation) await handleError(error, '#form-error');
  } finally { saving = false; submit.disabled = conflict; }
};
$('#export').onclick = async () => {
  const current = generation; const button = $('#export'); button.disabled = true;
  try {
    if (!await client.isMember()) throw Object.assign(new Error('Η πρόσβασή σας έχει απενεργοποιηθεί.'), { status: 403 });
    const snapshot = await client.list();
    if (current !== generation) return;
    persistSession();
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'octocert-certificates-v2', exportedAt: new Date().toISOString(), records: snapshot }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'octocert-' + today() + '.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('#message').textContent = 'Η εξαγωγή των τρεχόντων πιστοποιητικών ξεκίνησε. Δεν περιλαμβάνει το ιστορικό.';
  } catch (error) { if (current === generation) await handleError(error); }
  finally { button.disabled = !ready; }
};
let sentEmail = '';
$('#email-form').onsubmit = async event => {
  event.preventDefault();
  const button = $('#send-code'); button.disabled = true;
  try {
    sentEmail = $('#email').value.trim().toLowerCase();
    await client.sendCode(sentEmail);
    $('#email-form').hidden = true; $('#code-form').hidden = false;
    $('#login-message').textContent = 'Ελέγξτε το email σας και τα ανεπιθύμητα. Αν ο λογαριασμός είναι ενεργός, θα λάβετε κωδικό σύνδεσης.';
    $('#code').focus();
  } catch (error) { $('#login-message').textContent = error.message; }
  finally { button.disabled = false; }
};
$('#change-email').onclick = () => {
  $('#code-form').hidden = true; $('#email-form').hidden = false; $('#code').value = ''; $('#login-message').textContent = '';
};
$('#code-form').onsubmit = async event => {
  event.preventDefault(); const button = $('#verify-code'); button.disabled = true;
  try {
    await client.verifyCode(sentEmail, $('#code').value.trim());
    await startSession();
  } catch (error) { showLogin(error.message); }
  finally { button.disabled = false; }
};
$('#logout').onclick = async () => {
  const logout = client.logout();
  showLogin('Αποσυνδεθήκατε από αυτή την καρτέλα.');
  try { await logout; }
  catch { $('#login-message').textContent = 'Η τοπική συνεδρία έκλεισε. Δεν επιβεβαιώθηκε η ανάκλησή της στον διακομιστή λόγω προβλήματος σύνδεσης.'; }
};
markReady(false); render();
try {
  client = new OctoCertClient(window.OCTOCERT_CONFIG || {});
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { saved = null; }
  if (saved?.user?.id && saved.access_token && saved.refresh_token && Number.isFinite(saved.expires_at)) {
    client.setSession(saved);
    startSession().catch(error => showLogin(error.message));
  }
} catch (error) {
  $('#login-message').textContent = error.message;
  $('#send-code').disabled = true;
}
setInterval(() => { if (!document.hidden && !saving && !$('#workspace').hidden) loadRecords(); }, 15000);
window.addEventListener('online', () => { if (!$('#workspace').hidden) loadRecords(); });
