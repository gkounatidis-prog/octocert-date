export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}
export class OctoCertClient {
  constructor(config, fetcher = fetch) {
    let url;
    try { url = new URL(config.supabaseUrl); } catch { throw new Error('Χρειάζεται σύνδεση με την κοινή βάση δεδομένων. Δείτε τις οδηγίες ρύθμισης.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !config.publishableKey) throw new Error('Ελέγξτε τη ρύθμιση της κοινής βάσης δεδομένων.');
    if (config.publishableKey.startsWith('sb_secret_')) throw new Error('Χρησιμοποιήστε μόνο το δημόσιο publishable key.');
    if (config.publishableKey.startsWith('eyJ')) {
      try { if (JSON.parse(atob(config.publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role !== 'anon') throw new Error(); }
      catch { throw new Error('Χρησιμοποιήστε μόνο publishable key ή anon key, ποτέ service_role.'); }
    }
    this.url = url.origin; this.key = config.publishableKey; this.fetcher = fetcher; this.session = null; this.epoch = 0;
  }
  setSession(session) { this.session = session; this.epoch += 1; }
  async request(path, { method = 'GET', body, token, headers = {} } = {}) {
    let response;
    try {
      response = await this.fetcher(this.url + path, {
        method,
        headers: { apikey: this.key, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000)
      });
    } catch { throw new ApiError('Δεν επιβεβαιώθηκε η επικοινωνία με τη βάση. Ελέγξτε τη σύνδεση και ανανεώστε τη λίστα πριν επαναλάβετε αποθήκευση.'); }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) throw new ApiError('Η σύνδεση έληξε. Συνδεθείτε ξανά.', 401);
      if (response.status === 403) throw new ApiError('Δεν έχετε δικαίωμα πρόσβασης. Επικοινωνήστε με τον διαχειριστή.', 403);
      if (response.status === 409) throw new ApiError('Ο αριθμός πιστοποιητικού υπάρχει ήδη ή η καταχώριση έχει ήδη αποθηκευτεί. Ανανεώστε τη λίστα.', 409);
      if (response.status === 429) throw new ApiError('Έγιναν πολλές προσπάθειες. Περιμένετε λίγο και δοκιμάστε ξανά.', 429);
      if (path.startsWith('/auth/')) throw new ApiError('Η σύνδεση δεν ολοκληρώθηκε. Ελέγξτε το email ή ζητήστε νέο κωδικό.', response.status);
      throw new ApiError('Η ενέργεια δεν ολοκληρώθηκε. Ελέγξτε τα στοιχεία ή επικοινωνήστε με τον διαχειριστή.', response.status);
    }
    return data;
  }
  async sendCode(email) {
    return this.request('/auth/v1/otp', { method: 'POST', body: { email, create_user: false } });
  }
  async verifyCode(email, token) {
    const data = await this.request('/auth/v1/verify', { method: 'POST', body: { email, token, type: 'email' } });
    if (!data?.access_token || !data.refresh_token || !data.user?.id) throw new ApiError('Η σύνδεση δεν ολοκληρώθηκε.');
    const session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000, user: data.user };
    this.setSession(session); return session;
  }
  async token() {
    if (!this.session) throw new ApiError('Συνδεθείτε ξανά.', 401);
    if (this.session.expires_at > Date.now() + 60000) return this.session.access_token;
    if (!this.refreshing) {
      const epoch = this.epoch;
      const refreshToken = this.session.refresh_token;
      this.refreshing = this.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } })
        .then(data => {
          if (epoch !== this.epoch) throw new ApiError('Η συνεδρία έχει κλείσει.', 401);
          if (!data?.access_token || !data.refresh_token || !data.user?.id) throw new ApiError('Συνδεθείτε ξανά.', 401);
          this.session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000, user: data.user };
          return data.access_token;
        }).finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  async isMember() {
    const token = await this.token();
    const rows = await this.request('/rest/v1/octocert_members?select=user_id&user_id=eq.' + encodeURIComponent(this.session.user.id) + '&active=eq.true', { token });
    return Array.isArray(rows) && rows.length === 1;
  }
  async list() {
    const token = await this.token();
    const rows = [];
    // Keyset pagination keeps insertions from shifting page offsets.
    let lastId = '';
    while (true) {
      const page = await this.request('/rest/v1/octocert_certificates?select=*&order=id.asc&limit=500' + (lastId ? '&id=gt.' + encodeURIComponent(lastId) : ''), { token });
      if (!Array.isArray(page)) throw new ApiError('Μη αναμενόμενη απάντηση από τη βάση.');
      rows.push(...page);
      if (page.length === 0) return rows;
      const nextId = page[page.length - 1].id;
      if (lastId && nextId <= lastId) throw new ApiError('Δεν επιβεβαιώθηκε η πλήρης φόρτωση της λίστας. Ανανεώστε ξανά.');
      lastId = nextId;
    }
  }
  async save(record, previous) {
    const token = await this.token();
    const updating = Boolean(previous);
    const path = '/rest/v1/octocert_certificates' + (updating ? '?id=eq.' + encodeURIComponent(previous.id) + '&version=eq.' + previous.version : '');
    const result = await this.request(path, { method: updating ? 'PATCH' : 'POST', body: updating ? record : { ...record, id: crypto.randomUUID() }, token, headers: { Prefer: 'return=representation' } });
    if (!Array.isArray(result) || result.length !== 1) throw new ApiError('Κάποιος συνεργάτης άλλαξε ήδη αυτό το πιστοποιητικό ή η πρόσβασή σας άλλαξε. Κρατήστε τις αλλαγές σας, ακυρώστε και ανανεώστε τη λίστα πριν ξαναδοκιμάσετε.', 412);
    return result[0];
  }
  async history(id) {
    const token = await this.token();
    return this.request('/rest/v1/octocert_history?select=actor_email,changed_at,action,before_data,after_data&certificate_id=eq.' + encodeURIComponent(id) + '&order=changed_at.desc&limit=100', { token });
  }
  async logout() {
    const token = this.session?.access_token;
    this.setSession(null);
    if (token) await this.request('/auth/v1/logout?scope=local', { method: 'POST', token });
  }
}
