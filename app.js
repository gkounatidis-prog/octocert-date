const KEY='octocert-records-v1';
const $=s=>document.querySelector(s);
function today(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Athens'}).format(new Date());}
function offsetDate(days){const d=new Date(today()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function daysUntil(date,base=today()){return Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(base+'T00:00:00Z'))/86400000);}
function status(date,base=today()){const days=daysUntil(date,base);return days<0?'late':days<=30?'soon':'ok';}
function normalize(v){return v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('el').replace(/ς/g,'σ');}
function matches(r,q){return normalize([r.client,r.facility,r.number].join(' ')).includes(normalize(q.trim()));}
const seeds=()=>[
['Αττική Τρόφιμα Α.Ε.','Μονάδα παραγωγής · Ασπρόπυργος','OCT-2026-001',-18],
['Ξενοδοχείο Αιγαίο','Κεντρικό κτίριο · Πειραιάς','OCT-2026-002',-5],
['Δήμος Χαλανδρίου','Δημοτικό κολυμβητήριο','OCT-2026-003',0],
['Ελληνική Logistics','Αποθήκη Β · Μάνδρα','OCT-2026-004',12],
['Αφοί Νικολάου Ο.Ε.','Εργαστήριο · Περιστέρι','OCT-2026-005',30],
['Ιατρικό Κέντρο Ίασις','Κεντρική μονάδα · Μαρούσι','OCT-2026-006',65],
['Πράσινη Ενέργεια Α.Ε.','Φωτοβολταϊκό πάρκο · Θήβα','OCT-2026-007',120],
['Αρτοποιία Δήμητρα','Κατάστημα · Αθήνα','OCT-2026-008',180]
].map(([client,facility,number,days],i)=>({id:String(i+1),client,facility,number,issued:offsetDate(-365),due:offsetDate(days)}));
let records;let loadError=false;
try{const saved=localStorage.getItem(KEY);records=saved?JSON.parse(saved):seeds();if(!Array.isArray(records)||records.some(r=>!['id','client','facility','number','issued','due'].every(k=>typeof r[k]==='string')))throw Error();if(!saved)localStorage.setItem(KEY,JSON.stringify(records));}catch{records=seeds();loadError=true;}
function save(next){try{localStorage.setItem(KEY,JSON.stringify(next));records=next;return true;}catch{$('#form-error').textContent='Δεν ήταν δυνατή η αποθήκευση. Ελέγξτε τις ρυθμίσεις αποθήκευσης του browser.';return false;}}
const labels={late:'Εκπρόθεσμο',soon:'Εντός 30 ημερών',ok:'Σε ισχύ'};
const fmt=d=>new Intl.DateTimeFormat('el-GR').format(new Date(d+'T12:00:00Z'));
function cell(text){const el=document.createElement('td');el.textContent=text;return el;}
function render(){
$('#today').textContent=new Intl.DateTimeFormat('el-GR',{dateStyle:'long',timeZone:'Europe/Athens'}).format(new Date());
$('#stats').replaceChildren();
[['all','Σύνολο πιστοποιητικών','Στο μητρώο σας','▤'],['late','Εκπρόθεσμοι επανέλεγχοι','Χρειάζονται προσοχή','!'],['soon','Εντός 30 ημερών','Από σήμερα έως και +30 ημέρες','◷'],['ok','Σε ισχύ','Επανέλεγχος μετά τις 30 ημέρες','✓']].forEach(([key,label,sub,symbol])=>{const div=document.createElement('div');div.className='stat '+key;const count=key==='all'?records.length:records.filter(r=>status(r.due)===key).length;div.innerHTML=`<span class="label">${label}</span><span class="symbol">${symbol}</span><span class="value">${String(count).padStart(2,'0')}</span><small>${sub}</small>`;$('#stats').append(div);});
const visible=records.filter(r=>matches(r,$('#search').value)&&($('#filter').value==='all'||status(r.due)===$('#filter').value)).sort((a,b)=>a.due.localeCompare(b.due));
$('#rows').replaceChildren();visible.forEach(r=>{const tr=document.createElement('tr');const client=cell('');const strong=document.createElement('strong');strong.textContent=r.client;const small=document.createElement('small');small.textContent=r.facility;client.append(strong,small);tr.append(client,cell(r.number),cell(fmt(r.issued)));const due=cell(fmt(r.due));const detail=document.createElement('small');const days=daysUntil(r.due);detail.textContent=days<0?`Καθυστέρηση ${-days} ημερών`:days===0?'Σήμερα':`Σε ${days} ημέρες`;due.append(detail);tr.append(due);const state=cell('');const badge=document.createElement('span');badge.className='badge '+status(r.due);badge.textContent='● '+labels[status(r.due)];state.append(badge);tr.append(state);const action=cell('');const edit=document.createElement('button');edit.className='edit';edit.textContent='Επεξεργασία';edit.setAttribute('aria-label','Επεξεργασία '+r.number);edit.onclick=()=>openForm(r);action.append(edit);tr.append(action);$('#rows').append(tr);});$('#count').textContent=`${visible.length} από ${records.length} πιστοποιητικά`;$('#empty').hidden=visible.length!==0;}
function openForm(record){$('#form').reset();$('#form-error').textContent='';$('#form-title').textContent=record?'Επεξεργασία πιστοποιητικού':'Νέο πιστοποιητικό';for(const k of ['id','client','facility','number','issued','due'])$('#form').elements[k].value=record?record[k]:'';$('#dialog').showModal();}
$('#add').onclick=()=>openForm();$('#close').onclick=$('#cancel').onclick=()=>$('#dialog').close();$('#search').oninput=render;$('#filter').onchange=render;
$('#form').onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));for(const key of ['client','facility','number'])data[key]=data[key].trim();if(!data.client||!data.facility||!data.number){$('#form-error').textContent='Συμπληρώστε όλα τα πεδία.';return;}if(data.due<data.issued){$('#form-error').textContent='Ο επανέλεγχος δεν μπορεί να είναι πριν από την έκδοση.';return;}if(records.some(r=>r.id!==data.id&&normalize(r.number)===normalize(data.number))){$('#form-error').textContent='Αυτός ο αριθμός πιστοποιητικού υπάρχει ήδη.';return;}const editing=Boolean(data.id);data.id=data.id||crypto.randomUUID();const next=editing?records.map(r=>r.id===data.id?data:r):[...records,data];if(save(next)){$('#dialog').close();render();$('#message').textContent='Το πιστοποιητικό αποθηκεύτηκε σε αυτόν τον browser.';}};
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(records,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='octocert-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('#message').textContent='Η εξαγωγή ξεκίνησε. Κρατήστε το αρχείο ως αντίγραφο ασφαλείας.';};
render();if(loadError)$('#message').textContent='Δεν φορτώθηκαν αποθηκευμένα στοιχεία. Εμφανίζονται δοκιμαστικά δεδομένα· η τοπική αποθήκευση μπορεί να μην είναι διαθέσιμη.';
setInterval(render,60000);
