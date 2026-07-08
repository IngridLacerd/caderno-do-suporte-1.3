// ── API ───────────────────────────────────────────────────────────────────────

var API = '';

async function apiFetch(path, opts) {
  try {
    var res = await fetch(API + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erro na API');
    return data;
  } catch(e) {
    console.error('API Error', path, e);
    throw e;
  }
}

// ── CONSTANTES ────────────────────────────────────────────────────────────────

var DEFAULT_CATS = [
  { id: 'nfc',         label: 'NFC',         icon: 'ti-device-mobile', fixed: true },
  { id: 'xml',         label: 'XML',         icon: 'ti-file-code',     fixed: true },
  { id: 'impressao',   label: 'Impressão',   icon: 'ti-printer',       fixed: true },
  { id: 'atualizacao', label: 'Atualização', icon: 'ti-refresh',       fixed: true },
  { id: 'instalacao',  label: 'Instalação',  icon: 'ti-package',       fixed: true },
  { id: 'geral',       label: 'Geral',       icon: 'ti-tool',          fixed: true }
];

var CUSTOM_ICONS = [
  'ti-settings', 'ti-database', 'ti-wifi', 'ti-server', 'ti-shield',
  'ti-coin', 'ti-chart-bar', 'ti-users', 'ti-key', 'ti-bug'
];

var CAT_COLORS = {
  nfc:         { bg: '#E1F5EE', color: '#085041' },
  xml:         { bg: '#E6F1FB', color: '#0C447C' },
  impressao:   { bg: '#FAEEDA', color: '#633806' },
  atualizacao: { bg: '#EEEDFE', color: '#3C3489' },
  instalacao:  { bg: '#EAF3DE', color: '#27500A' },
  geral:       { bg: '#FAECE7', color: '#712B13' }
};

var STATUS_LABELS = {
  pendente:  'A fazer',
  andamento: 'Em andamento',
  resolvido: 'Resolvido'
};

var STATUS_ICONS = {
  pendente:  'ti-circle-dashed',
  andamento: 'ti-progress',
  resolvido: 'ti-circle-check'
};

var MAX_HISTORY = 30;
var USER_COLORS  = ['#880000','#0C447C','#085041','#3C3489','#633806','#27500A','#712B13','#555550'];
var USER_AVATARS = ['ti-user-circle','ti-user','ti-user-star','ti-user-bolt','ti-user-heart','ti-user-shield'];

// ── ESTADO ────────────────────────────────────────────────────────────────────

var procs         = [];
var cats          = [];
var accessHistory = [];
var currentView   = 'dashboard';
var selCat        = null;
var editId        = null;
var stepCount     = 0;
var pendingStepImages = {};

var currentUser = null;
var users       = [];
var alerts      = [];
var notes       = [];
var currentNoteId = null;

// ── STORAGE LOCAL (apenas tema e sessão) ──────────────────────────────────────

function storageGet(key) {
  try { return localStorage.getItem(key); } catch(e) { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch(e) { return false; }
}

// ── CARREGAMENTO INICIAL (API) ────────────────────────────────────────────────

async function loadData() {
  try {
    var results = await Promise.all([
      apiFetch('/api/procedures'),
      apiFetch('/api/categories'),
      apiFetch('/api/history')
    ]);
    procs         = results[0];
    cats          = results[1].length ? results[1] : DEFAULT_CATS.slice();
    accessHistory = results[2];
  } catch(e) {
    procs = []; cats = DEFAULT_CATS.slice(); accessHistory = [];
    showToast('Erro ao carregar dados do servidor.');
  }
}

async function loadUsers() {
  try {
    users = await apiFetch('/api/users');
  } catch(e) {
    users = [];
    showToast('Erro ao carregar perfis do servidor.');
  }
}

function loadSession() {
  var raw = storageGet('suporte_session_v1');
  if (raw) { try { currentUser = JSON.parse(raw); } catch(e) { currentUser = null; } }
  if (currentUser) {
    var found = users.find(function(u) { return u.id === currentUser.id; });
    if (!found) currentUser = null;
  }
}
function saveSession() {
  if (currentUser) storageSet('suporte_session_v1', JSON.stringify(currentUser));
  else storageSet('suporte_session_v1', '');
}

async function loadAlerts() {
  try { alerts = await apiFetch('/api/alerts'); }
  catch(e) { alerts = []; }
}

async function loadNotes() {
  if (!currentUser) { notes = []; return; }
  try { notes = await apiFetch('/api/notes?userId=' + currentUser.id); }
  catch(e) { notes = []; }
}

// ── SALVAR NA API ─────────────────────────────────────────────────────────────

async function saveProc(proc, isNew) {
  if (isNew) {
    var created = await apiFetch('/api/procedures', { method: 'POST', body: JSON.stringify(proc) });
    procs.unshift(created);
    return created;
  } else {
    var updated = await apiFetch('/api/procedures/' + proc.id, { method: 'PUT', body: JSON.stringify(proc) });
    for (var i = 0; i < procs.length; i++) {
      if (String(procs[i].id) === String(proc.id)) { procs[i] = updated; break; }
    }
    return updated;
  }
}

async function saveCat(cat) {
  return apiFetch('/api/categories', { method: 'POST', body: JSON.stringify(cat) });
}

async function saveHistory() {
  // persistido automaticamente no logHistory
}

// ── HISTÓRICO ─────────────────────────────────────────────────────────────────

async function logHistory(procId) {
  var p = findProc(procId);
  if (!p) return;
  accessHistory = accessHistory.filter(function(h) { return String(h.procId) !== String(procId); });
  var entry = { procId: procId, title: p.title, cat: p.cat, userId: currentUser ? currentUser.id : null, timestamp: Date.now() };
  accessHistory.unshift(entry);
  if (accessHistory.length > MAX_HISTORY) accessHistory = accessHistory.slice(0, MAX_HISTORY);
  try {
    await apiFetch('/api/history', { method: 'POST', body: JSON.stringify({ procId: procId, title: p.title, cat: p.cat, userId: currentUser ? currentUser.id : null }) });
  } catch(e) {}
}

function formatRelativeTime(ts) {
  var diff = Date.now() - ts;
  var min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return 'há ' + min + ' min';
  var hr = Math.floor(min / 60);
  if (hr < 24) return 'há ' + hr + 'h';
  var day = Math.floor(hr / 24);
  if (day === 1) return 'ontem';
  return 'há ' + day + ' dias';
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function findProc(id) {
  for (var i = 0; i < procs.length; i++) {
    if (String(procs[i].id) === String(id)) return procs[i];
  }
  return null;
}

function getCatMeta(id) {
  for (var i = 0; i < cats.length; i++) {
    if (cats[i].id === id) return cats[i];
  }
  return { label: id, icon: 'ti-tool' };
}

function getBadgeStyle(catId) {
  var s = CAT_COLORS[catId] || { bg: '#F1EFE8', color: '#5F5E5A' };
  return 'background:' + s.bg + ';color:' + s.color;
}

function getFavorites() {
  return procs.filter(function(p) { return p.favorite; });
}

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── NAVEGAÇÃO ─────────────────────────────────────────────────────────────────

function setView(view, catId) {
  currentView = view;
  selCat = catId || null;
  var s = document.getElementById('search');
  if (s) s.value = '';
  var sf = document.getElementById('status-filter');
  if (sf) sf.value = '';
  render();
  closeSidebar();
}

function onSearchInput() {
  var q = document.getElementById('search').value.trim();
  if (q && currentView === 'dashboard') { currentView = 'all'; selCat = null; }
  render();
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  setActiveClass('view-dashboard', currentView === 'dashboard');
  setActiveClass('view-favorites', currentView === 'favorites');
  setActiveClass('view-history',   currentView === 'history');
  setActiveClass('view-notes',     currentView === 'notes');

  var favCount = document.getElementById('fav-count');
  if (favCount) favCount.textContent = getFavorites().length;

  var list = document.getElementById('cat-list');
  if (list) {
    var html = '';
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      var count = procs.filter(function(p) { return p.cat === c.id; }).length;
      var active = (currentView === 'category' && selCat === c.id);
      html += '<div class="cat-item' + (active ? ' active' : '') + '" onclick="setView(\'category\',\'' + c.id + '\')">'
        + '<i class="ti ' + c.icon + ' cat-icon"></i>'
        + '<span>' + esc(c.label) + '</span>'
        + '<span class="cat-count">' + count + '</span>'
        + '</div>';
    }
    list.innerHTML = html;
  }

  var stat = document.getElementById('total-stat');
  if (stat) stat.textContent = procs.length + ' procedimento' + (procs.length !== 1 ? 's' : '') + ' no total';
}

function setActiveClass(id, isActive) {
  var el = document.getElementById(id);
  if (!el) return;
  if (isActive) el.classList.add('active');
  else el.classList.remove('active');
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function render() {
  renderSidebar();

  var dashboardEl = document.getElementById('dashboard-view');
  var historyEl   = document.getElementById('history-view');
  var gridEl      = document.getElementById('cards-grid');
  var notesEl     = document.getElementById('notes-view');

  var q = document.getElementById('search') ? document.getElementById('search').value.trim().toLowerCase() : '';
  var statusFilter = document.getElementById('status-filter') ? document.getElementById('status-filter').value : '';

  var title = 'Painel';
  if (currentView === 'favorites') title = 'Favoritos';
  else if (currentView === 'history') title = 'Histórico';
  else if (currentView === 'notes') title = 'Anotações';
  else if (currentView === 'category') title = getCatMeta(selCat).label;
  else if (currentView === 'all') title = 'Todos os procedimentos';

  var titleEl  = document.getElementById('content-title');
  var topbarEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent  = title;
  if (topbarEl) topbarEl.textContent = title;

  if (currentView === 'notes') {
    dashboardEl.style.display = 'none';
    historyEl.style.display   = 'none';
    gridEl.style.display      = 'none';
    if (notesEl) notesEl.style.display = '';
    renderNotesView();
    var countElN = document.getElementById('content-count');
    if (countElN) countElN.textContent = notes.length + ' anotaç' + (notes.length !== 1 ? 'ões' : 'ão');
    return;
  }

  if (notesEl) notesEl.style.display = 'none';

  if (currentView === 'dashboard' && !q) {
    dashboardEl.style.display = '';
    historyEl.style.display   = 'none';
    gridEl.style.display      = 'none';
    renderDashboard();
    var countEl = document.getElementById('content-count');
    if (countEl) countEl.textContent = '';
    return;
  }

  if (currentView === 'history' && !q) {
    dashboardEl.style.display = 'none';
    historyEl.style.display   = '';
    gridEl.style.display      = 'none';
    renderHistoryView();
    var countElH = document.getElementById('content-count');
    if (countElH) countElH.textContent = accessHistory.length + ' acesso' + (accessHistory.length !== 1 ? 's' : '');
    return;
  }

  dashboardEl.style.display = 'none';
  historyEl.style.display   = 'none';
  gridEl.style.display      = '';

  var list = procs;
  if (currentView === 'favorites') list = getFavorites();
  else if (currentView === 'category') list = procs.filter(function(p) { return p.cat === selCat; });

  if (statusFilter) list = list.filter(function(p) { return p.status === statusFilter; });
  if (q) list = list.filter(function(p) { return (p.title||'').toLowerCase().indexOf(q) !== -1; });

  var countElG = document.getElementById('content-count');
  if (countElG) countElG.textContent = list.length + ' procedimento' + (list.length !== 1 ? 's' : '');

  renderGrid(gridEl, list);
}

function renderGrid(container, list) {
  if (!container) return;
  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><i class="ti ti-file-off" style="font-size:40px;color:var(--text-3)"></i><p>Nenhum procedimento encontrado.</p></div>';
    return;
  }
  var html = '';
  for (var i = 0; i < list.length; i++) {
    html += renderProcCard(list[i]);
  }
  container.innerHTML = html;
}

function renderProcCard(p) {
  var catMeta  = getCatMeta(p.cat);
  var badgeStyle = getBadgeStyle(p.cat);
  var statusIcon  = STATUS_ICONS[p.status]  || 'ti-circle-dashed';
  var statusLabel = STATUS_LABELS[p.status] || p.status;
  return '<div class="proc-card" onclick="viewProc(' + p.id + ')">'
    + '<div class="proc-card-top">'
    + '<div class="proc-badges">'
    + '<span class="badge" style="' + badgeStyle + '"><i class="ti ' + catMeta.icon + '"></i> ' + esc(catMeta.label) + '</span>'
    + '<span class="badge badge-status ' + p.status + '"><i class="ti ' + statusIcon + '"></i> ' + esc(statusLabel) + '</span>'
    + '</div>'
    + '<button class="fav-btn ' + (p.favorite ? 'active' : '') + '" onclick="event.stopPropagation(); toggleFavorite(' + p.id + ')" title="' + (p.favorite ? 'Remover favorito' : 'Favoritar') + '">'
    + '<i class="ti ' + (p.favorite ? 'ti-star-filled' : 'ti-star') + '"></i></button>'
    + '</div>'
    + '<div class="proc-title">' + esc(p.title) + '</div>'
    + '<div class="proc-meta"><i class="ti ti-list-numbers"></i> ' + p.steps.length + ' passo' + (p.steps.length !== 1 ? 's' : '') + '</div>'
    + '</div>';
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

function renderDashboard() {
  updateAlertBadge();

  var metricsEl = document.getElementById('metrics');
  if (metricsEl) {
    var total    = procs.length;
    var resolved = procs.filter(function(p) { return p.status === 'resolvido'; }).length;
    var pending  = procs.filter(function(p) { return p.status === 'pendente'; }).length;
    var favs     = getFavorites().length;
    metricsEl.innerHTML =
      '<div class="metric-card"><div class="metric-value">' + total    + '</div><div class="metric-label">Total</div></div>'
    + '<div class="metric-card"><div class="metric-value">' + resolved + '</div><div class="metric-label">Resolvidos</div></div>'
    + '<div class="metric-card"><div class="metric-value">' + pending  + '</div><div class="metric-label">A fazer</div></div>'
    + '<div class="metric-card"><div class="metric-value">' + favs     + '</div><div class="metric-label">Favoritos</div></div>';
  }

  var catGridEl = document.getElementById('cat-overview-grid');
  if (catGridEl) {
    var html = '';
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      var count = procs.filter(function(p) { return p.cat === c.id; }).length;
      html += '<div class="cat-overview-item" onclick="setView(\'category\',\'' + c.id + '\')">'
        + '<i class="ti ' + c.icon + '"></i>'
        + '<span>' + esc(c.label) + '</span>'
        + '<b>' + count + '</b>'
        + '</div>';
    }
    catGridEl.innerHTML = html;
  }

  var recentEl = document.getElementById('recent-procs-list');
  if (recentEl) {
    var recent = procs.slice(0, 5);
    if (!recent.length) {
      recentEl.innerHTML = '<div class="mini-empty">Nenhum procedimento cadastrado.</div>';
    } else {
      var rhtml = '';
      for (var j = 0; j < recent.length; j++) {
        var p = recent[j];
        rhtml += '<div class="mini-item" onclick="viewProc(' + p.id + ')">'
          + '<i class="ti ' + (getCatMeta(p.cat).icon) + '" style="color:var(--text-3)"></i>'
          + '<span>' + esc(p.title) + '</span>'
          + '</div>';
      }
      recentEl.innerHTML = rhtml;
    }
  }

  var histEl = document.getElementById('recent-history-list');
  if (histEl) {
    var recent2 = accessHistory.slice(0, 5);
    if (!recent2.length) {
      histEl.innerHTML = '<div class="mini-empty">Nenhum acesso registrado.</div>';
    } else {
      var hhtml = '';
      for (var k = 0; k < recent2.length; k++) {
        var h = recent2[k];
        hhtml += '<div class="mini-item" onclick="viewProc(' + h.procId + ')">'
          + '<i class="ti ti-clock" style="color:var(--text-3)"></i>'
          + '<span>' + esc(h.title) + '</span>'
          + '<span class="mini-time">' + formatRelativeTime(h.timestamp) + '</span>'
          + '</div>';
      }
      histEl.innerHTML = hhtml;
    }
  }
}

// ── HISTÓRICO VIEW ────────────────────────────────────────────────────────────

function renderHistoryView() {
  var listEl = document.getElementById('history-list');
  if (!listEl) return;
  if (!accessHistory.length) {
    listEl.innerHTML = '<div class="empty-state"><i class="ti ti-history-off" style="font-size:40px;color:var(--text-3)"></i><p>Nenhum acesso registrado.</p></div>';
    return;
  }
  var html = '';
  for (var i = 0; i < accessHistory.length; i++) {
    var h = accessHistory[i];
    html += '<div class="mini-item history-row" onclick="viewProc(' + h.procId + ')">'
      + '<i class="ti ti-clock" style="color:var(--text-3)"></i>'
      + '<span>' + esc(h.title) + '</span>'
      + '<span class="mini-time">' + formatRelativeTime(h.timestamp) + '</span>'
      + '</div>';
  }
  listEl.innerHTML = html;
}

async function clearHistory() {
  if (!confirm('Limpar todo o histórico de acessos?')) return;
  try {
    await apiFetch('/api/history', { method: 'DELETE' });
    accessHistory = [];
    render();
  } catch(e) { showToast('Erro ao limpar histórico.'); }
}

// ── VER PROCEDIMENTO ──────────────────────────────────────────────────────────

async function viewProc(id) {
  var p = findProc(id);
  if (!p) return;
  await logHistory(id);

  var catMeta    = getCatMeta(p.cat);
  var badgeStyle = getBadgeStyle(p.cat);
  var statusIcon  = STATUS_ICONS[p.status]  || 'ti-circle-dashed';
  var statusLabel = STATUS_LABELS[p.status] || p.status;

  var titleEl = document.getElementById('view-title');
  if (titleEl) titleEl.textContent = p.title;

  var metaEl = document.getElementById('view-meta');
  if (metaEl) {
    metaEl.innerHTML =
      '<span class="badge" style="' + badgeStyle + '"><i class="ti ' + catMeta.icon + '"></i> ' + esc(catMeta.label) + '</span>'
    + '<span class="badge badge-status ' + p.status + '"><i class="ti ' + statusIcon + '"></i> ' + esc(statusLabel) + '</span>';
  }

  var stepsEl = document.getElementById('view-steps');
  if (stepsEl) {
    var shtml = '<ol class="view-steps-list">';
    for (var i = 0; i < p.steps.length; i++) {
      var s = p.steps[i];
      shtml += '<li><span>' + esc(s.text || s) + '</span>';
      var imgs = s.images || [];
      if (imgs.length) {
        shtml += '<div class="step-imgs-view">';
        for (var j = 0; j < imgs.length; j++) {
          shtml += '<img src="' + imgs[j] + '" class="step-img-view" onclick="openLightbox(this.src)" alt="imagem ' + (j+1) + '" />';
        }
        shtml += '</div>';
      }
      shtml += '</li>';
    }
    shtml += '</ol>';
    stepsEl.innerHTML = shtml;
  }

  var obsEl = document.getElementById('view-obs');
  if (obsEl) {
    obsEl.style.display = p.obs ? '' : 'none';
    if (p.obs) obsEl.querySelector('.view-obs-text').textContent = p.obs;
  }

  var clientEl = document.getElementById('view-client');
  if (clientEl) {
    var hasClient = p.client && (p.client.name || p.client.phone);
    clientEl.style.display = hasClient ? '' : 'none';
    if (hasClient) {
      var cn = document.getElementById('view-client-name');
      var cp = document.getElementById('view-client-phone');
      if (cn) cn.textContent = p.client.name || '—';
      if (cp) cp.textContent = p.client.phone || '—';
    }
  }

  var editBtn = document.getElementById('view-edit-btn');
  if (editBtn) editBtn.setAttribute('data-proc-id', id);

  var delBtn = document.getElementById('view-del-btn');
  if (delBtn) delBtn.setAttribute('data-proc-id', id);

  var favBtn = document.getElementById('view-fav-btn');
  if (favBtn) {
    favBtn.setAttribute('data-proc-id', id);
    favBtn.innerHTML = p.favorite
      ? '<i class="ti ti-star-filled"></i> Desfavoritar'
      : '<i class="ti ti-star"></i> Favoritar';
    favBtn.className = 'icon-btn' + (p.favorite ? ' active-fav' : '');
  }

  var modal = document.getElementById('view-modal');
  if (modal) modal.style.display = 'flex';
}

function viewEditFromModal() {
  var btn = document.getElementById('view-edit-btn');
  if (!btn) return;
  var id = btn.getAttribute('data-proc-id');
  closeModal('view-modal');
  openEditModal(parseInt(id) || id);
}

function viewDeleteFromModal() {
  var btn = document.getElementById('view-del-btn');
  if (!btn) return;
  var id = btn.getAttribute('data-proc-id');
  closeModal('view-modal');
  deleteProc(id);
}

async function viewToggleFavFromModal() {
  var btn = document.getElementById('view-fav-btn');
  if (!btn) return;
  var id = btn.getAttribute('data-proc-id');
  await toggleFavorite(id);
  var p = findProc(id);
  if (!p) return;
  btn.innerHTML = p.favorite
    ? '<i class="ti ti-star-filled"></i> Desfavoritar'
    : '<i class="ti ti-star"></i> Favoritar';
  btn.className = 'icon-btn' + (p.favorite ? ' active-fav' : '');
}

// ── FAVORITOS ─────────────────────────────────────────────────────────────────

async function toggleFavorite(id) {
  var p = findProc(id);
  if (!p) return;
  p.favorite = !p.favorite;
  try {
    await apiFetch('/api/procedures/' + id, { method: 'PUT', body: JSON.stringify({ favorite: p.favorite }) });
  } catch(e) { showToast('Erro ao atualizar favorito.'); p.favorite = !p.favorite; return; }
  render();
}

// ── MODAL NOVO/EDITAR ─────────────────────────────────────────────────────────

function openNewModal() {
  editId = null;
  pendingStepImages = {};
  stepCount = 0;
  setVal('f-title', '');
  setVal('f-obs', '');
  setVal('f-client-name', '');
  setVal('f-client-phone', '');
  var catEl = document.getElementById('f-cat');
  var statusEl = document.getElementById('f-status');
  if (catEl) {
    catEl.innerHTML = cats.map(function(c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('');
    if (selCat) catEl.value = selCat;
  }
  if (statusEl) statusEl.value = 'pendente';
  document.getElementById('steps-editor').innerHTML = '';
  addStep();
  var modal = document.getElementById('proc-modal');
  if (modal) modal.style.display = 'flex';
  var h3 = modal ? modal.querySelector('.modal-header h3') : null;
  if (h3) h3.textContent = 'Novo Procedimento';
}

function openEditModal(id) {
  var p = findProc(id);
  if (!p) return;
  editId = p.id;
  pendingStepImages = {};
  stepCount = 0;
  setVal('f-title', p.title);
  setVal('f-obs', p.obs || '');
  setVal('f-client-name', p.client ? p.client.name : '');
  setVal('f-client-phone', p.client ? p.client.phone : '');
  var catEl = document.getElementById('f-cat');
  var statusEl = document.getElementById('f-status');
  if (catEl) {
    catEl.innerHTML = cats.map(function(c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('');
    catEl.value = p.cat || 'geral';
  }
  if (statusEl) statusEl.value = p.status || 'pendente';
  document.getElementById('steps-editor').innerHTML = '';
  for (var j = 0; j < p.steps.length; j++) {
    addStep(p.steps[j].text, p.steps[j].images);
  }
  var modal = document.getElementById('proc-modal');
  if (modal) modal.style.display = 'flex';
  var h3 = modal ? modal.querySelector('.modal-header h3') : null;
  if (h3) h3.textContent = 'Editar Procedimento';
}

function setVal(id, val) {
  var el = document.getElementById(id);
  if (el) el.value = val;
}

function addStep(text, images) {
  text = text || '';
  images = images || [];
  stepCount++;
  var rowId = 'step-' + stepCount;
  pendingStepImages[rowId] = images.slice();

  var num = document.querySelectorAll('.step-edit-row').length + 1;
  var div = document.createElement('div');
  div.className = 'step-edit-row';
  div.id = rowId;

  div.innerHTML = '<div class="step-edit-top">'
    + '<span>' + num + '.</span>'
    + '<input type="text" placeholder="Descreva o passo..." value="' + esc(text) + '" />'
    + '<button class="icon-btn del" onclick="removeStep(\'' + rowId + '\')" title="Remover passo"><i class="ti ti-x"></i></button>'
    + '</div>'
    + '<div class="step-img-row" id="' + rowId + '-imgs"></div>'
    + '<div>'
    + '<label class="img-upload-btn">'
    + '<i class="ti ti-photo-plus" style="font-size:14px"></i> Adicionar imagem'
    + '<input type="file" accept="image/*" multiple style="display:none" onchange="handleStepImage(event, \'' + rowId + '\')" />'
    + '</label>'
    + '</div>';

  document.getElementById('steps-editor').appendChild(div);
  renderStepImages(rowId);
}

function handleStepImage(event, rowId) {
  var files = event.target.files;
  if (!files || !files.length) return;
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var reader = new FileReader();
    reader.onload = (function(rId) {
      return function(e) {
        pendingStepImages[rId] = pendingStepImages[rId] || [];
        pendingStepImages[rId].push(e.target.result);
        renderStepImages(rId);
      };
    })(rowId);
    reader.readAsDataURL(file);
  }
  event.target.value = '';
}

function renderStepImages(rowId) {
  var container = document.getElementById(rowId + '-imgs');
  if (!container) return;
  var imgs = pendingStepImages[rowId] || [];
  var html = '';
  for (var i = 0; i < imgs.length; i++) {
    html += '<div class="step-img-thumb">'
      + '<img src="' + imgs[i] + '" alt="prévia" />'
      + '<button class="rm-img" onclick="removeStepImage(\'' + rowId + '\',' + i + ')" title="Remover imagem"><i class="ti ti-x"></i></button>'
      + '</div>';
  }
  container.innerHTML = html;
}

function removeStepImage(rowId, idx) {
  if (!pendingStepImages[rowId]) return;
  pendingStepImages[rowId].splice(idx, 1);
  renderStepImages(rowId);
}

function removeStep(rowId) {
  var el = document.getElementById(rowId);
  if (el) el.remove();
  delete pendingStepImages[rowId];
  renumberSteps();
}

function renumberSteps() {
  var rows = document.querySelectorAll('.step-edit-row');
  for (var i = 0; i < rows.length; i++) {
    rows[i].querySelector('.step-edit-top span').textContent = (i + 1) + '.';
  }
}

async function saveProcForm() {
  var title = (document.getElementById('f-title').value || '').trim();
  if (!title) { showToast('Informe o título do procedimento.'); return; }

  var rows = document.querySelectorAll('.step-edit-row');
  var steps = [];
  for (var i = 0; i < rows.length; i++) {
    var input = rows[i].querySelector('.step-edit-top input');
    var text = input.value.trim();
    if (!text) continue;
    var rowId = rows[i].id;
    steps.push({ text: text, images: (pendingStepImages[rowId] || []).slice() });
  }

  if (!steps.length) { showToast('Adicione pelo menos um passo.'); return; }

  var catEl    = document.getElementById('f-cat');
  var statusEl = document.getElementById('f-status');
  var obsEl    = document.getElementById('f-obs');
  var clientName  = document.getElementById('f-client-name').value.trim();
  var clientPhone = document.getElementById('f-client-phone').value.trim();

  var proc = {
    id:     editId,
    title:  title,
    cat:    catEl ? catEl.value : 'geral',
    status: statusEl ? statusEl.value : 'pendente',
    steps:  steps,
    obs:    obsEl ? obsEl.value.trim() : '',
    client: { name: clientName, phone: clientPhone }
  };

  try {
    var isNew = !editId;
    if (!isNew) {
      var existing = findProc(editId);
      proc.favorite = existing ? existing.favorite : false;
    }
    await saveProc(proc, isNew);
    showToast(isNew ? 'Procedimento salvo.' : 'Procedimento atualizado.');
    closeModal('proc-modal');
    render();
  } catch(e) {
    showToast('Erro ao salvar procedimento.');
  }
}

async function deleteProc(id) {
  if (!confirm('Excluir este procedimento? Essa ação não pode ser desfeita.')) return;
  try {
    await apiFetch('/api/procedures/' + id, { method: 'DELETE' });
    procs = procs.filter(function(p) { return String(p.id) !== String(id); });
    accessHistory = accessHistory.filter(function(h) { return String(h.procId) !== String(id); });
    render();
    showToast('Procedimento excluído.');
  } catch(e) { showToast('Erro ao excluir.'); }
}

// ── MODAL CATEGORIAS ──────────────────────────────────────────────────────────

function openCatModal() {
  renderCatManage();
  var modal = document.getElementById('cat-modal');
  if (modal) modal.style.display = 'flex';
  var inp = document.getElementById('new-cat-input');
  if (inp) inp.focus();
}

function renderCatManage() {
  var list = document.getElementById('cat-manage-list');
  if (!list) return;
  var html = '';
  for (var i = 0; i < cats.length; i++) {
    var c = cats[i];
    html += '<div class="cat-manage-item' + (c.fixed ? ' fixed' : '') + '">'
      + '<i class="ti ' + c.icon + ' cat-icon"></i>'
      + '<span>' + esc(c.label) + '</span>'
      + (!c.fixed ? '<button class="cat-del-btn" onclick="deleteCat(\'' + c.id + '\')" title="Remover"><i class="ti ti-x"></i></button>' : '')
      + '</div>';
  }
  list.innerHTML = html;
}

async function addCat() {
  var input = document.getElementById('new-cat-input');
  if (!input) return;
  var label = input.value.trim();
  if (!label) return;

  for (var i = 0; i < cats.length; i++) {
    if (cats[i].label.toLowerCase() === label.toLowerCase()) { showToast('Categoria já existe.'); return; }
  }

  var id   = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();
  var icon = CUSTOM_ICONS[cats.length % CUSTOM_ICONS.length];

  try {
    var created = await saveCat({ id: id, label: label, icon: icon, fixed: false });
    cats.push(created);
    input.value = '';
    renderCatManage();
    renderSidebar();
    showToast('Categoria "' + label + '" adicionada.');
  } catch(e) { showToast('Erro ao adicionar categoria.'); }
}

async function deleteCat(id) {
  var cat = getCatMeta(id);
  if (cat.fixed) { showToast('Categoria padrão não pode ser removida.'); return; }
  if (!confirm('Remover a categoria "' + cat.label + '"?')) return;
  try {
    await apiFetch('/api/categories/' + id, { method: 'DELETE' });
    cats = cats.filter(function(c) { return c.id !== id; });
    renderCatManage();
    renderSidebar();
    showToast('Categoria removida.');
  } catch(e) { showToast('Erro ao remover categoria.'); }
}

// ── MODAL UTILITÁRIOS ─────────────────────────────────────────────────────────

function closeModal(id) {
  var modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}

function checkOverlayClose(event, id) {
  if (event.target === event.currentTarget) closeModal(id);
}

function openLightbox(src) {
  var existing = document.querySelector('.image-lightbox');
  if (existing) existing.remove();
  var lb = document.createElement('div');
  lb.className = 'image-lightbox';
  lb.innerHTML = '<div class="lb-bg" onclick="this.parentNode.remove()"></div><img src="' + src + '" />';
  document.body.appendChild(lb);
}

// ── TOAST ─────────────────────────────────────────────────────────────────────

function showToast(msg) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(function() { t.classList.remove('visible'); }, 2800);
}

// ── SIDEBAR MOBILE ────────────────────────────────────────────────────────────

function openSidebar() {
  var sb = document.querySelector('.sidebar');
  var ov = document.querySelector('.overlay-bg');
  if (sb) sb.classList.add('open');
  if (ov) ov.classList.add('visible');
}

function toggleSidebar() {
  var sb = document.querySelector('.sidebar');
  if (sb && sb.classList.contains('open')) closeSidebar();
  else openSidebar();
}

function closeSidebar() {
  var sb = document.querySelector('.sidebar');
  var ov = document.querySelector('.overlay-bg');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('visible');
}

// ── TEMA ──────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  var icon = document.getElementById('theme-icon');
  if (icon) icon.className = theme === 'dark' ? 'ti ti-sun' : 'ti ti-moon';
}

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'light';
  var next = current === 'dark' ? 'light' : 'dark';
  storageSet('suporte_theme', next);
  applyTheme(next);
}

function loadTheme() {
  var saved = storageGet('suporte_theme') || 'light';
  applyTheme(saved);
}

// ── NOTAS ─────────────────────────────────────────────────────────────────────

function notesSorted() {
  return notes.slice().sort(function(a, b) {
    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
}

function notePreviewText(n) {
  var blocks = n.blocks || [];
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].text) return blocks[i].text;
  }
  return '';
}

function renderNotesSidebar() {
  var sidebar = document.getElementById('notes-list-sidebar');
  if (!sidebar) return;
  var sorted = notesSorted();
  if (!sorted.length) {
    sidebar.innerHTML = '<div class="notes-empty-sidebar">Nenhuma anotação ainda.</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < sorted.length; i++) {
    var n = sorted[i];
    var active = (n.id === currentNoteId);
    var preview = notePreviewText(n);
    html += '<div class="note-list-item' + (active ? ' active' : '') + '" onclick="selectNote(\'' + n.id + '\')">'
      + '<div class="note-list-title">' + (n.pinned ? '<i class="ti ti-pin-filled pin-icon"></i>' : '') + esc(n.title || 'Sem título') + '</div>'
      + (preview ? '<div class="note-list-preview">' + esc(preview) + '</div>' : '')
      + '<div class="note-list-date">' + formatRelativeTime(new Date(n.updatedAt || Date.now()).getTime()) + '</div>'
      + '</div>';
  }
  sidebar.innerHTML = html;
}

function renderNotesView() {
  renderNotesSidebar();

  var emptyState = document.getElementById('notes-empty-state');
  var editorWrap  = document.getElementById('notes-editor');
  var note = notes.find(function(n) { return n.id === currentNoteId; });

  if (!note) {
    if (emptyState) emptyState.style.display = 'flex';
    if (editorWrap)  editorWrap.style.display = 'none';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (editorWrap)  editorWrap.style.display = 'flex';
  renderNoteEditor(note);
}

function selectNote(id) {
  currentNoteId = id;
  renderNotesView();
}

async function createNote() {
  if (!currentUser) { showToast('Faça login para criar anotações.'); return; }
  var n = { id: 'note_' + Date.now(), userId: currentUser.id, title: '', blocks: [{ type: 'p', text: '' }] };
  try {
    var created = await apiFetch('/api/notes', { method: 'POST', body: JSON.stringify(n) });
    notes.unshift(created);
    currentNoteId = created.id;
    renderNotesView();
    setTimeout(function() {
      var titleInp = document.getElementById('note-title-input');
      if (titleInp) titleInp.focus();
    }, 50);
  } catch(e) { showToast('Erro ao criar anotação.'); }
}

async function deleteCurrentNote() {
  if (!currentNoteId) return;
  if (!confirm('Excluir esta anotação?')) return;
  try {
    await apiFetch('/api/notes/' + currentNoteId, { method: 'DELETE' });
    notes = notes.filter(function(n) { return n.id !== currentNoteId; });
    currentNoteId = notes.length ? notesSorted()[0].id : null;
    renderNotesView();
  } catch(e) { showToast('Erro ao excluir anotação.'); }
}

async function toggleNotePin() {
  var note = notes.find(function(n) { return n.id === currentNoteId; });
  if (!note) return;
  note.pinned = !note.pinned;
  var btn = document.getElementById('note-pin-btn');
  if (btn) btn.classList.toggle('active', note.pinned);
  renderNotesSidebar();
  try {
    await apiFetch('/api/notes/' + note.id, { method: 'PUT', body: JSON.stringify({ pinned: note.pinned }) });
  } catch(e) { /* silencioso */ }
}

var _noteSaveTimer = null;

function renderNoteEditor(note) {
  var titleInp = document.getElementById('note-title-input');
  if (titleInp) titleInp.value = note.title || '';

  var pinBtn = document.getElementById('note-pin-btn');
  if (pinBtn) pinBtn.classList.toggle('active', !!note.pinned);

  var meta = document.getElementById('note-meta');
  if (meta) meta.textContent = 'Editado ' + formatRelativeTime(new Date(note.updatedAt || note.createdAt || Date.now()).getTime());

  var container = document.getElementById('note-blocks');
  if (!container) return;

  var blocks = (note.blocks && note.blocks.length) ? note.blocks : [{ type: 'p', text: '' }];
  var html = '';
  var olIndex = 0;
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var type = b.type || 'p';
    olIndex = (type === 'ol') ? (olIndex + 1) : 0;

    if (type === 'hr') {
      html += '<div class="note-block block-hr-wrap" data-idx="' + i + '">'
        + '<hr class="block-hr" />'
        + '<button class="block-del" onclick="removeNoteBlock(' + i + ')" title="Remover"><i class="ti ti-x"></i></button>'
        + '</div>';
      continue;
    }

    var prefix = '';
    if (type === 'ul') prefix = '<span class="block-prefix">•</span>';
    else if (type === 'ol') prefix = '<span class="block-prefix">' + olIndex + '.</span>';
    else if (type === 'quote') prefix = '<span class="block-prefix"><i class="ti ti-quote"></i></span>';

    var checkboxHtml = '';
    if (type === 'check') {
      checkboxHtml = '<input type="checkbox" class="block-check-input" ' + (b.checked ? 'checked' : '') + ' onchange="toggleNoteCheck(' + i + ')" />';
    }

    var cls = 'note-block block-' + type + (type === 'check' && b.checked ? ' done' : '');

    html += '<div class="' + cls + '" data-idx="' + i + '">'
      + checkboxHtml
      + prefix
      + '<div class="block-input" contenteditable="true" data-idx="' + i + '" oninput="onNoteBlockInput(' + i + ')" onkeydown="onNoteBlockKeydown(event,' + i + ')">' + esc(b.text || '') + '</div>'
      + '<button class="block-del" onclick="removeNoteBlock(' + i + ')" title="Remover bloco"><i class="ti ti-x"></i></button>'
      + '</div>';
  }
  container.innerHTML = html;
}

function autoSaveNote() {
  var note = notes.find(function(n) { return n.id === currentNoteId; });
  if (!note) return;
  var titleInp = document.getElementById('note-title-input');
  if (titleInp) note.title = titleInp.value;
  scheduleNoteSave();
}

function onNoteBlockInput(idx) {
  var note = notes.find(function(n) { return n.id === currentNoteId; });
  if (!note) return;
  var el = document.querySelector('.block-input[data-idx="' + idx + '"]');
  if (el) {
    if (!note.blocks[idx]) note.blocks[idx] = { type: 'p', text: '' };
    note.blocks[idx].text = el.innerText.replace(/\n+$/, '');
  }
  scheduleNoteSave();
}

function onNoteBlockKeydown(event, idx) {
  var note = notes.find(function(n) { return n.id === currentNoteId; });
  if (!note) return;
  var type = note.blocks[idx] ? (note.blocks[idx].type || 'p') : 'p';

  if (event.key === 'Enter' && !event.shiftKey && type !== 'code' && type !== 'quote') {
    event.preventDefault();
    onNoteBlockInput(idx);
    var newType = (type === 'h1' || type === 'h2' || type === 'h3') ? 'p' : type;
    var nb = { type: newType, text: '' };
    if (newType === 'check') nb.checked = false;
    note.blocks.splice(idx + 1, 0, nb);
    renderNoteEditor(note);
    focusBlock(idx + 1);
    scheduleNoteSave();
  } else if (event.key === 'Backspace' && event.target.innerText === '' && note.blocks.length > 1 && idx > 0) {
    event.preventDefault();
    note.blocks.splice(idx, 1);
    renderNoteEditor(note);
    focusBlock(idx - 1, true);
    scheduleNoteSave();
  }
}

function focusBlock(idx, toEnd) {
  setTimeout(function() {
    var el = document.querySelector('.block-input[data-idx="' + idx + '"]');
    if (!el) return;
    el.focus();
    if (toEnd) {
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, 20);
}

function toggleNoteCheck(idx) {
  var note = notes.find(function(n) { return n.id === currentNoteId; });
  if (!note || !note.blocks[idx]) return;
  note.blocks[idx].checked = !note.blocks[idx].checked;
  renderNoteEditor(note);
  scheduleNoteSave();
}

function removeNoteBlock(idx) {
  var note = notes.find(function(n) { return n.id === currentNoteId; });
  if (!note) return;
  if (note.blocks.length <= 1) {
    note.blocks[0] = { type: 'p', text: '' };
  } else {
    note.blocks.splice(idx, 1);
  }
  renderNoteEditor(note);
  scheduleNoteSave();
}

function insertBlock(type) {
  var note = notes.find(function(n) { return n.id === currentNoteId; });
  if (!note) return;
  note.blocks = note.blocks || [];
  var last = note.blocks[note.blocks.length - 1];
  if (last && (last.type || 'p') === 'p' && !last.text && type !== 'hr') {
    last.type = type;
    if (type === 'check') last.checked = false;
  } else {
    var nb = { type: type, text: '' };
    if (type === 'check') nb.checked = false;
    note.blocks.push(nb);
  }
  renderNoteEditor(note);
  if (type !== 'hr') focusBlock(note.blocks.length - 1);
  scheduleNoteSave();
}

function scheduleNoteSave() {
  if (_noteSaveTimer) clearTimeout(_noteSaveTimer);
  _noteSaveTimer = setTimeout(persistCurrentNote, 900);
}

async function persistCurrentNote() {
  var note = notes.find(function(n) { return n.id === currentNoteId; });
  if (!note) return;
  try {
    await apiFetch('/api/notes/' + note.id, { method: 'PUT', body: JSON.stringify({ title: note.title, blocks: note.blocks }) });
    note.updatedAt = new Date().toISOString();
    var meta = document.getElementById('note-meta');
    if (meta) meta.textContent = 'Editado agora';
    renderNotesSidebar();
  } catch(e) { /* silencioso */ }
}

// ── LOGIN / USUÁRIOS ──────────────────────────────────────────────────────────

function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-root').style.display = 'none';
  renderLoginUsers();
}

function hideLoginScreen() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-root').style.display = '';
}

function showLoginPassword(userId) {
  var allInputs  = document.querySelectorAll('.login-password-input');
  var allButtons = document.querySelectorAll('.login-enter-btn');
  for (var i = 0; i < allInputs.length; i++) allInputs[i].style.display = 'none';
  for (var j = 0; j < allButtons.length; j++) allButtons[j].style.display = 'none';
  var input = document.getElementById('login-pass-' + userId);
  var btn   = document.getElementById('login-enter-' + userId);
  if (input) { input.style.display = 'block'; input.value = ''; input.focus(); }
  if (btn)   btn.style.display = 'inline-flex';
}

function renderLoginUsers() {
  var grid = document.getElementById('login-user-grid');
  if (!grid) return;
  if (!users.length) {
    grid.innerHTML = '<div class="login-empty">Nenhum perfil criado ainda.<br>Crie o primeiro abaixo.</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    html += '<div class="login-avatar-card" onclick="showLoginPassword(\'' + u.id + '\')" style="--ua-color:' + (u.color||'#880000') + '">'
      + '<div class="login-avatar-icon"><i class="ti ' + (u.avatar||'ti-user-circle') + '"></i></div>'
      + '<span class="login-avatar-name">' + esc(u.name) + '</span>'
      + '<input type="password" class="login-password-input" id="login-pass-' + u.id + '" placeholder="Senha" onkeydown="if(event.key===\'Enter\') loginAs(\'' + u.id + '\', document.getElementById(\'login-pass-' + u.id + '\').value)" onclick="event.stopPropagation()" />'
      + '<button class="btn-new login-enter-btn" id="login-enter-' + u.id + '" onclick="event.stopPropagation(); loginAs(\'' + u.id + '\', document.getElementById(\'login-pass-' + u.id + '\').value)">Entrar</button>'
      + '<button class="login-del-user" onclick="event.stopPropagation(); deleteUser(event,\'' + u.id + '\')" title="Remover perfil"><i class="ti ti-x"></i></button>'
      + '</div>';
  }
  grid.innerHTML = html;
}

async function loginAs(userId, password) {
  var u = users.find(function(x) { return x.id === userId; });
  if (!u) return;

  var enteredPassword  = (password || '').toString();
  var expectedPassword = (u.password || '123456').toString();

  if (enteredPassword !== expectedPassword) {
    showToast('Senha incorreta para ' + u.name + '.');
    return;
  }

  currentUser = u;
  saveSession();
  applyUserTheme(currentUser.color);
  hideLoginScreen();
  await loadNotes();
  updateUserUI();
  render();
  showToast('Olá, ' + u.name + '!');
}

function logout() {
  currentUser = null;
  saveSession();
  resetUserTheme();
  notes = [];
  currentNoteId = null;
  showLoginScreen();
}

function openCreateUserModal() {
  document.getElementById('new-user-name').value = '';
  var emailEl = document.getElementById('new-user-email'); if (emailEl) emailEl.value = '';
  document.getElementById('new-user-password').value = '';
  document.getElementById('new-user-password-confirm').value = '';
  document.getElementById('user-color-pick').value = USER_COLORS[users.length % USER_COLORS.length];
  var avatarBtns = document.querySelectorAll('.avatar-pick-btn');
  if (avatarBtns.length) {
    avatarBtns.forEach(function(btn) { btn.classList.remove('selected'); });
    avatarBtns[0].classList.add('selected');
  }
  // atualizar pré-visualização do avatar
  updateNewUserPreview();
  document.getElementById('create-user-modal').style.display = 'flex';
  setTimeout(function() { document.getElementById('new-user-name').focus(); }, 50);
}

function closeCreateUserModal() {
  document.getElementById('create-user-modal').style.display = 'none';
}

function selectAvatar(el, icon) {
  document.querySelectorAll('.avatar-pick-btn').forEach(function(b) { b.classList.remove('selected'); });
  el.classList.add('selected');
  updateNewUserPreview();
}

async function createUser() {
  var nameEl    = document.getElementById('new-user-name');
  var name      = (nameEl ? nameEl.value : '').trim();
  if (!name) { showToast('Digite um nome para o perfil.'); return; }

  var passwordEl  = document.getElementById('new-user-password');
  var confirmEl   = document.getElementById('new-user-password-confirm');
  var password        = passwordEl ? passwordEl.value : '';
  var confirmPassword = confirmEl  ? confirmEl.value  : '';
  if (!password || password.length < 6) { showToast('Senha deve ter ao menos 6 caracteres.'); return; }
  if (password !== confirmPassword) { showToast('As senhas não conferem.'); return; }

  var colorEl = document.getElementById('user-color-pick');
  var color   = colorEl ? colorEl.value : USER_COLORS[0];
  var selBtn  = document.querySelector('.avatar-pick-btn.selected');
  var avatar  = selBtn ? selBtn.dataset.icon : USER_AVATARS[0];
  var emailEl = document.getElementById('new-user-email');
  var email = emailEl ? (emailEl.value || '').trim() : '';
  // validação simples de email
  var emailRegex = /^\S+@\S+\.\S+$/;
  if (!email || !emailRegex.test(email)) { showToast('Digite um email válido.'); return; }

  var u = { id: 'u_' + Date.now(), name: name, color: color, avatar: avatar, password: password || '123456' };
  if (email) u.email = email;

  try {
    var created = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(u) });
    users.push(created);
    closeCreateUserModal();
    renderLoginUsers();
    showToast('Perfil "' + name + '" criado!');
    // atualizar preview caso modal reabra
    updateNewUserPreview();
  } catch(e) { showToast(e && e.message ? e.message : 'Erro ao criar perfil.'); console.error('createUser error', e); }
}

function updateNewUserPreview() {
  var preview = document.getElementById('new-user-avatar-preview');
  if (!preview) return;
  var sel = document.querySelector('.avatar-pick-btn.selected');
  var icon = sel ? sel.dataset.icon : (USER_AVATARS[0] || 'ti-user-circle');
  var color = document.getElementById('user-color-pick') ? document.getElementById('user-color-pick').value : '#880000';
  preview.innerHTML = '<i class="ti ' + icon + '"></i>';
  preview.style.background = color;
  preview.style.color = '#ffffff';
}

// atualizar preview quando mudar a cor
var _ucp = document.getElementById('user-color-pick');
if (_ucp) _ucp.addEventListener && _ucp.addEventListener('input', function() { updateNewUserPreview(); });

async function loginByEmail() {
  var email = (document.getElementById('login-email-input') ? document.getElementById('login-email-input').value.trim() : '').toLowerCase();
  var pass  = (document.getElementById('login-email-pass') ? document.getElementById('login-email-pass').value : '');
  if (!email) { showToast('Digite seu email.'); return; }
  var u = users.find(function(x) { return x.email && x.email.toLowerCase() === email; });
  if (!u) { showToast('Perfil com esse email não encontrado.'); return; }
  if ((u.password || '123456').toString() !== pass.toString()) { showToast('Senha incorreta para ' + u.name + '.'); return; }
  currentUser = u;
  saveSession();
  applyUserTheme(currentUser.color);
  hideLoginScreen();
  await loadNotes();
  updateUserUI();
  render();
  showToast('Olá, ' + u.name + '!');
}

async function deleteUser(e, userId) {
  e.stopPropagation();
  if (!confirm('Remover este perfil? As anotações serão apagadas.')) return;
  try {
    await apiFetch('/api/users/' + userId, { method: 'DELETE' });
    users = users.filter(function(u) { return u.id !== userId; });
    renderLoginUsers();
  } catch(e) { showToast('Erro ao remover perfil.'); }
}

function openEditProfileModal() {
  if (!currentUser) return;
  document.getElementById('edit-new-password').value = '';
  document.getElementById('edit-new-password-confirm').value = '';
  var colorInp = document.getElementById('edit-user-color-pick');
  if (colorInp) colorInp.value = currentUser.color || '#880000';

  var avatarBtns = document.querySelectorAll('#edit-avatar-pick-row .avatar-pick-btn');
  var matched = false;
  avatarBtns.forEach(function(btn) {
    var isSel = btn.dataset.icon === currentUser.avatar;
    btn.classList.toggle('selected', isSel);
    if (isSel) matched = true;
  });
  if (!matched && avatarBtns.length) avatarBtns[0].classList.add('selected');

  updateEditProfilePreview();
  document.getElementById('edit-profile-modal').style.display = 'flex';
}

function closeEditProfileModal() {
  document.getElementById('edit-profile-modal').style.display = 'none';
}

function selectEditAvatar(el) {
  document.querySelectorAll('#edit-avatar-pick-row .avatar-pick-btn').forEach(function(b) { b.classList.remove('selected'); });
  el.classList.add('selected');
  updateEditProfilePreview();
}

function updateEditProfilePreview() {
  var preview = document.getElementById('edit-profile-avatar-preview');
  if (!preview) return;
  var sel = document.querySelector('#edit-avatar-pick-row .avatar-pick-btn.selected');
  var icon = sel ? sel.dataset.icon : (currentUser ? currentUser.avatar : 'ti-user-circle');
  var colorInp = document.getElementById('edit-user-color-pick');
  var color = colorInp ? colorInp.value : '#880000';
  preview.innerHTML = '<i class="ti ' + icon + '"></i>';
  preview.style.background = color;
  preview.style.color = '#ffffff';
}

async function saveProfileChanges() {
  if (!currentUser) return;
  var user = users.find(function(u) { return u.id === currentUser.id; });
  if (!user) return;

  var password        = document.getElementById('edit-new-password') ? document.getElementById('edit-new-password').value : '';
  var confirmPassword = document.getElementById('edit-new-password-confirm') ? document.getElementById('edit-new-password-confirm').value : '';
  if (password || confirmPassword) {
    if (password !== confirmPassword) { showToast('As senhas não conferem.'); return; }
    if (password.length < 6) { showToast('Senha deve ter ao menos 6 caracteres.'); return; }
  }

  var selBtn = document.querySelector('#edit-avatar-pick-row .avatar-pick-btn.selected');
  var avatar = selBtn ? selBtn.dataset.icon : user.avatar;
  var colorInp = document.getElementById('edit-user-color-pick');
  var color = colorInp ? colorInp.value : user.color;

  var updated = Object.assign({}, user, { avatar: avatar, color: color });
  if (password) updated.password = password;

  try {
    var saved = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(updated) });
    Object.assign(user, saved);
    Object.assign(currentUser, saved);
    saveSession();
    applyUserTheme(currentUser.color);
    updateUserUI();
    renderSidebar();
    closeEditProfileModal();
    showToast('Perfil atualizado com sucesso.');
  } catch(e) {
    showToast((e && e.message) ? e.message : 'Erro ao salvar perfil.');
  }
}

function applyUserTheme(color) {
  if (!color) return;
  var root = document.documentElement;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-hover', color);
  root.style.setProperty('--accent-text', color);
  root.style.setProperty('--accent-bg', 'color-mix(in srgb, ' + color + ' 16%, var(--surface))');
}

function resetUserTheme() {
  var root = document.documentElement;
  root.style.removeProperty('--accent');
  root.style.removeProperty('--accent-hover');
  root.style.removeProperty('--accent-text');
  root.style.removeProperty('--accent-bg');
}

function updateUserUI() {
  var avatar     = document.getElementById('sidebar-user-avatar');
  var name       = document.getElementById('sidebar-user-name');
  var panelCard  = document.getElementById('profile-panel-card');
  var panelAvatar = document.getElementById('profile-panel-avatar');
  var panelName  = document.getElementById('profile-panel-name');
  if (!currentUser) {
    if (avatar) avatar.innerHTML = '<i class="ti ti-user"></i>';
    if (name)   name.textContent = 'Sem perfil';
    if (panelCard) panelCard.style.display = 'none';
    return;
  }
  if (avatar) { avatar.innerHTML = '<i class="ti ' + currentUser.avatar + '"></i>'; avatar.style.color = currentUser.color; }
  if (name)   name.textContent = currentUser.name;
  if (panelCard) panelCard.style.display = 'flex';
  if (panelAvatar) { panelAvatar.innerHTML = '<i class="ti ' + currentUser.avatar + '"></i>'; panelAvatar.style.color = currentUser.color; }
  if (panelName) panelName.textContent = currentUser.name;
}

// ── ALERTAS ───────────────────────────────────────────────────────────────────

function openAlertsModal() {
  renderAlerts();
  document.getElementById('alerts-modal').style.display = 'flex';
}

function closeAlertsModal() {
  document.getElementById('alerts-modal').style.display = 'none';
}

function renderAlerts() {
  var list = document.getElementById('alerts-list');
  if (!list) return;
  var open   = alerts.filter(function(a) { return !a.done; });
  var closed = alerts.filter(function(a) { return  a.done; });
  var sorted = open.concat(closed);

  if (!sorted.length) {
    list.innerHTML = '<div class="alerts-empty"><i class="ti ti-bell-off" style="font-size:32px;color:var(--text-3)"></i><p>Nenhum aviso registrado.</p></div>';
    updateAlertBadge();
    return;
  }

  var html = '';
  for (var i = 0; i < sorted.length; i++) {
    var a = sorted[i];
    var isOld    = isOlderThanToday(a.date);
    var ageClass = isOld ? ' alert-old' : '';
    var doneClass = a.done ? ' alert-done' : '';
    html += '<div class="alert-item' + ageClass + doneClass + '">'
      + '<div class="alert-item-left">'
      + '<button class="alert-check-btn" onclick="toggleAlert(\'' + a.id + '\')" title="' + (a.done ? 'Reabrir' : 'Marcar como resolvido') + '">'
      + '<i class="ti ' + (a.done ? 'ti-circle-check-filled' : 'ti-circle-dashed') + '"></i></button>'
      + '<div class="alert-item-body">'
      + '<div class="alert-item-text">' + esc(a.text) + '</div>'
      + '<div class="alert-item-meta">'
      + '<span><i class="ti ti-user" style="font-size:11px"></i> ' + esc(a.authorName||'') + '</span>'
      + '<span><i class="ti ti-calendar" style="font-size:11px"></i> ' + formatAlertDate(a.date) + '</span>'
      + (isOld && !a.done ? '<span class="alert-overdue"><i class="ti ti-alert-triangle" style="font-size:11px"></i> Pendente do dia anterior</span>' : '')
      + '</div>'
      + '</div>'
      + '</div>'
      + '<button class="icon-btn del" onclick="deleteAlert(\'' + a.id + '\')" title="Remover"><i class="ti ti-trash"></i></button>'
      + '</div>';
  }
  list.innerHTML = html;
  updateAlertBadge();
}

function isOlderThanToday(dateStr) {
  var today = new Date(); today.setHours(0,0,0,0);
  var d = new Date(dateStr); d.setHours(0,0,0,0);
  return d < today;
}

function formatAlertDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('pt-BR');
}

function updateAlertBadge() {
  var open = alerts.filter(function(a) { return !a.done; });
  var btn = document.getElementById('alerts-badge');
  if (btn) {
    if (open.length) { btn.textContent = open.length; btn.style.display = ''; }
    else btn.style.display = 'none';
  }
  var overdue = alerts.filter(function(a) { return !a.done && isOlderThanToday(a.date); });
  var dashBadge = document.getElementById('dashboard-alert-banner');
  if (dashBadge) {
    if (overdue.length) {
      dashBadge.style.display = '';
      dashBadge.querySelector('.dab-count').textContent = overdue.length + ' aviso' + (overdue.length !== 1 ? 's' : '') + ' pendente' + (overdue.length !== 1 ? 's' : '') + ' do dia anterior';
    } else {
      dashBadge.style.display = 'none';
    }
  }
}

async function addAlert() {
  if (!currentUser) { showToast('Faça login para adicionar avisos.'); return; }
  var inp     = document.getElementById('alert-new-input');
  var dateInp = document.getElementById('alert-new-date');
  var text = (inp ? inp.value.trim() : '');
  if (!text) { showToast('Escreva o aviso antes de salvar.'); return; }

  var dateStr = dateInp && dateInp.value ? dateInp.value : new Date().toISOString().slice(0,10);

  try {
    var created = await apiFetch('/api/alerts', { method: 'POST', body: JSON.stringify({
      id: 'al_' + Date.now(), text: text,
      authorId: currentUser.id, authorName: currentUser.name, date: dateStr, done: false
    })});
    alerts.unshift({ id: created.id, text: created.text, authorId: created.author_id, authorName: created.author_name, date: created.date, done: created.done });
    if (inp) inp.value = '';
    if (dateInp) dateInp.value = new Date().toISOString().slice(0,10);
    renderAlerts();
    showToast('Aviso adicionado.');
  } catch(e) { showToast('Erro ao adicionar aviso.'); }
}

async function toggleAlert(id) {
  var a = alerts.find(function(x) { return x.id === id; });
  if (!a) return;
  a.done = !a.done;
  try {
    await apiFetch('/api/alerts/' + id, { method: 'PUT', body: JSON.stringify({ done: a.done }) });
    renderAlerts();
    renderDashboard();
  } catch(e) { a.done = !a.done; showToast('Erro ao atualizar aviso.'); }
}

async function deleteAlert(id) {
  if (!confirm('Remover este aviso?')) return;
  try {
    await apiFetch('/api/alerts/' + id, { method: 'DELETE' });
    alerts = alerts.filter(function(a) { return a.id !== id; });
    renderAlerts();
    renderDashboard();
  } catch(e) { showToast('Erro ao remover aviso.'); }
}

// ── INIT ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function() {
  loadTheme();

  // Mostrar tela de carregamento enquanto busca dados
  var appRoot = document.getElementById('app-root');
  var loginScreen = document.getElementById('login-screen');
  if (appRoot) appRoot.style.display = 'none';
  if (loginScreen) loginScreen.style.display = 'none';

  try {
    await loadUsers();
    await Promise.all([loadData(), loadAlerts()]);
  } catch(e) {
    showToast('Erro ao conectar ao servidor.');
  }

  loadSession();

  if (!currentUser) {
    showLoginScreen();
  } else {
    applyUserTheme(currentUser.color);
    hideLoginScreen();
    await loadNotes();
    updateUserUI();
    render();
  }

  var alertDateInp = document.getElementById('alert-new-date');
  if (alertDateInp) alertDateInp.value = new Date().toISOString().slice(0,10);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeModal('proc-modal');
      closeModal('cat-modal');
      closeModal('view-modal');
      var lb = document.querySelector('.image-lightbox');
      if (lb) lb.remove();
    }
  });
});
