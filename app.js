// ═══════════════════════════════════════════════
//  ZEDB Cinema — app.js
// ═══════════════════════════════════════════════

// ── CONFIG ───────────────────────────────────────
const API_KEY      = '313a4651';
const OMDB_URL     = 'https://www.omdbapi.com/';
const SUPABASE_URL   = 'https://iiymgunbihbctpcyulhb.supabase.co';
const SUGGESTORS_KEY = 'zedb_suggestors';

function getSuggestors() {
  const saved = JSON.parse(localStorage.getItem(SUGGESTORS_KEY) || '[]');
  const defaults = ['Pai', 'Mãe', 'Luís'];
  const all = [...new Set([...defaults, ...saved])];
  return all;
}

function saveSuggestor(name) {
  const defaults = ['Pai', 'Mãe', 'Luís'];
  if (defaults.includes(name)) return;
  const saved = JSON.parse(localStorage.getItem(SUGGESTORS_KEY) || '[]');
  if (!saved.includes(name)) {
    saved.push(name);
    localStorage.setItem(SUGGESTORS_KEY, JSON.stringify(saved));
  }
}
const SUPABASE_KEY = 'sb_publishable_JW88Uk3ArNzkcV5x9tsEDw_lw6QFOh3';

// ── SUPABASE CLIENT ───────────────────────────────
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── IN-MEMORY CACHE ───────────────────────────────
let _watched   = [];
let _watchlist = [];

// ── DB MAPPING ────────────────────────────────────
function toDb(movie) {
  return {
    imdb_id:         movie.imdbId,
    title:           movie.title,
    year:            movie.year,
    genre:           (movie.genre || []).join(', '),
    director:        movie.director  || null,
    actors:          movie.actors    || null,
    poster:          movie.poster    || null,
    imdb_rating:     movie.imdbRating || null,
    rated:           movie.rated     || null,
    plot:            movie.plot      || null,
    runtime:         movie.runtime   || null,
    type:            movie.type      || null,
    country:         movie.country   || null,
    personal_rating: movie.personalRating || null,
    review:          movie.review         || null,
    total_seasons:   movie.totalSeasons   || null,
  };
}

function fromDb(row) {
  return {
    imdbId:         row.imdb_id,
    title:          row.title,
    year:           row.year,
    genre:          row.genre ? row.genre.split(', ').filter(Boolean) : [],
    director:       row.director,
    actors:         row.actors,
    poster:         row.poster,
    imdbRating:     row.imdb_rating,
    rated:          row.rated,
    plot:           row.plot,
    runtime:        row.runtime,
    type:           row.type,
    country:        row.country,
    personalRating: row.personal_rating,
    review:         row.review,
    addedAt:        row.added_at,
    totalSeasons:   row.total_seasons,
    suggestedBy:    row.suggested_by,
  };
}

// ── DB OPERATIONS ─────────────────────────────────
async function loadData() {
  const [w, wl] = await Promise.all([
    db.from('watched').select('*').order('added_at', { ascending: false }),
    db.from('watchlist').select('*').order('added_at', { ascending: false }),
  ]);
  if (w.error)  throw w.error;
  if (wl.error) throw wl.error;
  _watched   = (w.data  || []).map(fromDb);
  _watchlist = (wl.data || []).map(fromDb);
}

function getWatched()   { return _watched; }
function getWatchlist() { return _watchlist; }
function findInWatched(id)   { return _watched.find(m => m.imdbId === id) || null; }
function findInWatchlist(id) { return _watchlist.find(m => m.imdbId === id) || null; }

async function addToWatched(movie) {
  const { error } = await db.from('watched').upsert(toDb(movie), { onConflict: 'imdb_id' });
  if (error) throw error;
  _watched = [{ ...movie, addedAt: movie.addedAt || new Date().toISOString() },
              ..._watched.filter(m => m.imdbId !== movie.imdbId)];
}

async function addToWatchlist(movie, suggestedBy = null) {
  const row = { ...toDb(movie), suggested_by: suggestedBy };
  delete row.personal_rating;
  delete row.review;
  delete row.total_seasons;
  const { error } = await db.from('watchlist').upsert(row, { onConflict: 'imdb_id' });
  if (error) throw error;
  if (suggestedBy) saveSuggestor(suggestedBy);
  _watchlist = [{ ...movie, addedAt: new Date().toISOString(), suggestedBy },
                ..._watchlist.filter(m => m.imdbId !== movie.imdbId)];
}

async function removeFromWatched(id) {
  const { error } = await db.from('watched').delete().eq('imdb_id', id);
  if (error) throw error;
  _watched = _watched.filter(m => m.imdbId !== id);
}

async function removeFromWatchlist(id) {
  const { error } = await db.from('watchlist').delete().eq('imdb_id', id);
  if (error) throw error;
  _watchlist = _watchlist.filter(m => m.imdbId !== id);
}

async function updateWatched(id, updates) {
  const { error } = await db.from('watched')
    .update({ personal_rating: updates.personalRating || null, review: updates.review || null })
    .eq('imdb_id', id);
  if (error) throw error;
  const idx = _watched.findIndex(m => m.imdbId === id);
  if (idx !== -1) _watched[idx] = { ..._watched[idx], ...updates };
}

// ── JSONP (para OMDB sem servidor local) ─────────
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = 'zedb_' + Date.now();
    const script = document.createElement('script');
    window[cb] = data => { delete window[cb]; script.remove(); resolve(data); };
    script.onerror = () => { delete window[cb]; script.remove(); reject(new Error('Sem ligação à internet ou API inacessível')); };
    script.src = url + '&callback=' + cb;
    document.head.appendChild(script);
  });
}

async function omdbById(id) {
  const d = await jsonp(`${OMDB_URL}?i=${id}&apikey=${API_KEY}&plot=full`);
  if (d.Response === 'False') throw new Error(d.Error || 'Não encontrado');
  return d;
}

async function omdbSearch(title) {
  const d = await jsonp(`${OMDB_URL}?s=${encodeURIComponent(title)}&apikey=${API_KEY}`);
  if (d.Response === 'False') throw new Error(d.Error || 'Sem resultados');
  return d.Search;
}

function extractImdbId(input) {
  const m = input.trim().match(/tt\d{7,8}/);
  return m ? m[0] : null;
}

function normalizeOmdb(d) {
  return {
    imdbId:       d.imdbID,
    title:        d.Title,
    year:         d.Year,
    genre:        d.Genre && d.Genre !== 'N/A' ? d.Genre.split(', ') : [],
    director:     d.Director    !== 'N/A' ? d.Director    : null,
    actors:       d.Actors      !== 'N/A' ? d.Actors      : null,
    poster:       d.Poster      !== 'N/A' ? d.Poster      : null,
    imdbRating:   d.imdbRating  !== 'N/A' ? d.imdbRating  : null,
    rated:        d.Rated       !== 'N/A' ? d.Rated       : null,
    plot:         d.Plot        !== 'N/A' ? d.Plot        : null,
    runtime:      d.Runtime     !== 'N/A' ? d.Runtime     : null,
    type:         d.Type,
    country:      d.Country     !== 'N/A' ? d.Country     : null,
    totalSeasons: d.totalSeasons !== 'N/A' && d.totalSeasons ? parseInt(d.totalSeasons) : null,
  };
}

// ── AUTH STATE ───────────────────────────────────
let currentUser = null;

function isLoggedIn() { return !!currentUser; }

function renderNavAuth() {
  const el = document.getElementById('navAuth');
  if (!el) return;
  if (isLoggedIn()) {
    el.innerHTML = `
      <span class="nav-user">${esc(currentUser.email)}</span>
      <button class="btn-logout" id="btnLogout">Sair</button>`;
    document.getElementById('btnLogout').addEventListener('click', handleLogout);
  } else {
    el.innerHTML = `<button class="btn-login" id="btnLogin">Entrar</button>`;
    document.getElementById('btnLogin').addEventListener('click', () =>
      document.getElementById('loginModal').classList.remove('hidden'));
  }
}

async function handleLogout() {
  await db.auth.signOut();
  currentUser = null;
  renderNavAuth();
  renderApp();
  showToast('Sessão terminada');
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('loginSubmit');
  const err = document.getElementById('loginError');
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  btn.textContent = 'A entrar...'; btn.disabled = true;
  err.style.display = 'none';

  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    err.textContent = 'Email ou password incorrectos.';
    err.style.display = 'block';
    btn.textContent = 'Entrar'; btn.disabled = false;
  } else {
    currentUser = data.user;
    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('loginForm').reset();
    btn.textContent = 'Entrar'; btn.disabled = false;
    renderNavAuth();
    renderApp();
    showToast('Bem-vindo 👋');
  }
}

// ── STATE ────────────────────────────────────────
let currentView   = 'mural';
let currentFilter = { type: 'all', genre: 'all', sort: 'personalRating', query: '', suggestor: 'all' };
let pendingMovie  = null;
let pendingDest   = null;
let editingId     = null;

// ── NAVIGATION ───────────────────────────────────
function navigate(view) {
  currentView = view;
  currentFilter = { type: 'all', genre: 'all', sort: 'personalRating', query: '', suggestor: 'all' };
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  renderApp();
}

// ── MAIN RENDER ───────────────────────────────────
function renderApp() {
  const app = document.getElementById('app');
  if      (currentView === 'mural')     renderMural(app);
  else if (currentView === 'watchlist') renderWatchlistView(app);
  else if (currentView === 'stats')     renderStats(app);
}

// ── MURAL ─────────────────────────────────────────
function renderMural(container) {
  const movies   = getWatched();
  const genres   = collectGenres(movies);
  const filtered = applyFilters(movies);

  container.innerHTML = `
    <div class="view-header">
      <div class="view-title">Mural</div>
      <div class="view-subtitle">${movies.length} ${movies.length === 1 ? 'entrada' : 'entradas'}</div>
    </div>
    ${buildFiltersBar(genres, false)}
    <div class="movies-grid" id="moviesGrid">
      ${filtered.length === 0 ? emptyState('mural') : filtered.map(m => buildCard(m, 'watched')).join('')}
    </div>`;

  attachFilterListeners(false);
  attachCardListeners('watched');
}

// ── WATCHLIST ─────────────────────────────────────
function renderWatchlistView(container) {
  const movies   = getWatchlist();
  const genres   = collectGenres(movies);
  const filtered = applyFilters(movies, true);

  container.innerHTML = `
    <div class="view-header">
      <div class="view-title">Ver Depois</div>
      <div class="view-subtitle">${movies.length} ${movies.length === 1 ? 'título' : 'títulos'} na watchlist</div>
    </div>
    ${buildFiltersBar(genres, true)}
    <div class="movies-grid" id="moviesGrid">
      ${filtered.length === 0 ? emptyState('watchlist') : filtered.map(m => buildCard(m, 'watchlist')).join('')}
    </div>`;

  attachFilterListeners(true);
  attachCardListeners('watchlist');
}

// ── STATS ─────────────────────────────────────────
let statsFilter = 'all'; // 'all' | 'movie' | 'series'

function renderStats(container) {
  const all       = getWatched();
  const watched   = statsFilter === 'all' ? all : all.filter(m => m.type === statsFilter);
  const watchlist = getWatchlist();

  const totalFilmes = watched.filter(m => m.type === 'movie').length;
  const totalSeries = watched.filter(m => m.type === 'series').length;
  const rated       = watched.filter(m => m.personalRating);
  const avgRating   = rated.length
    ? (rated.reduce((s, m) => s + m.personalRating, 0) / rated.length).toFixed(1) : '—';
  const imdbRated   = watched.filter(m => m.imdbRating);
  const avgImdb     = imdbRated.length
    ? (imdbRated.reduce((s, m) => s + parseFloat(m.imdbRating), 0) / imdbRated.length).toFixed(1) : '—';

  // Genres
  const genreMap = {};
  watched.forEach(m => m.genre.forEach(g => { genreMap[g] = (genreMap[g] || 0) + 1; }));
  const genres   = Object.entries(genreMap).sort((a, b) => b[1] - a[1]);
  const maxGenre = genres[0]?.[1] || 1;

  // Directors
  const directorMap = {};
  watched.forEach(m => {
    if (!m.director) return;
    m.director.split(', ').forEach(d => { directorMap[d] = (directorMap[d] || 0) + 1; });
  });
  const directors = Object.entries(directorMap).sort((a, b) => b[1] - a[1]);
  const maxDir    = directors[0]?.[1] || 1;

  // Actors
  const actorMap = {};
  watched.forEach(m => {
    if (!m.actors) return;
    m.actors.split(', ').forEach(a => { actorMap[a] = (actorMap[a] || 0) + 1; });
  });
  const actors   = Object.entries(actorMap).sort((a, b) => b[1] - a[1]);
  const maxActor = actors[0]?.[1] || 1;

  // Total time
  const totalMinutes = watched.reduce((sum, m) => {
    const match = m.runtime?.match(/(\d+)/);
    const episodeMins = match ? parseInt(match[1]) : 0;
    if (m.type === 'series' && episodeMins > 0) {
      const seasons  = m.totalSeasons || 1;
      const episodes = seasons * 10; // média de 10 ep por temporada
      return sum + (episodeMins * episodes);
    }
    return sum + episodeMins;
  }, 0);

  // Top rated
  const topRated = [...watched].filter(m => m.personalRating)
    .sort((a, b) => b.personalRating - a.personalRating).slice(0, 5);

  // Recent
  const recent = [...watched]
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt)).slice(0, 5);

  const barSection = (title, items, max) => {
    const id      = 'bar_' + title.replace(/\s/g, '_');
    const preview = 5;
    const hasMore = items.length > preview;
    const rows = items.map(([label, count], i) => `
      <div class="genre-bar-item" ${i >= preview ? `style="display:none"` : ''} data-bar-extra>
        <div class="genre-bar-label">${esc(label)}</div>
        <div class="genre-bar-track">
          <div class="genre-bar-fill" style="width:${Math.round((count/max)*100)}%"></div>
        </div>
        <div class="genre-bar-count">${count}</div>
      </div>`).join('');
    return `
    <div class="stats-section" id="${id}">
      <div class="stats-section-title">${title}</div>
      ${rows}
      ${hasMore ? `<button class="btn-ver-mais" onclick="toggleBarSection('${id}')">Ver mais (${items.length - preview})</button>` : ''}
    </div>`;
  };

  container.innerHTML = `
    <div class="view-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div class="view-title">Estatísticas</div>
        <div class="view-subtitle">O teu historial de cinema</div>
      </div>
      <div class="filter-chip" id="statsTypeChip">
        <button data-type="all"    class="${statsFilter === 'all'    ? 'active' : ''}">Tudo</button>
        <button data-type="movie"  class="${statsFilter === 'movie'  ? 'active' : ''}">Filmes</button>
        <button data-type="series" class="${statsFilter === 'series' ? 'active' : ''}">Séries</button>
      </div>
    </div>

    ${watched.length === 0
      ? `<div style="text-align:center;padding:60px 0;color:var(--muted)">Ainda não há nada para analisar. Adiciona filmes ao Mural!</div>`
      : `
    <div class="stat-card stat-card-hero">
      <div class="stat-label">Tempo total a ver</div>
      <div class="stat-value red" style="font-size:42px">${formatTotalTime(totalMinutes)}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Filmes vistos</div><div class="stat-value">${totalFilmes}</div></div>
      <div class="stat-card"><div class="stat-label">Séries vistas</div><div class="stat-value">${totalSeries}</div></div>
      <div class="stat-card"><div class="stat-label">Nota média</div><div class="stat-value red">${avgRating}<span>/ 10</span></div></div>
      <div class="stat-card"><div class="stat-label">Média IMDB</div><div class="stat-value">${avgImdb}<span>/ 10</span></div></div>
      <div class="stat-card"><div class="stat-label">Na watchlist</div><div class="stat-value">${watchlist.length}</div></div>
      <div class="stat-card"><div class="stat-label">Com review</div><div class="stat-value">${watched.filter(m => m.review).length}</div></div>
    </div>

    <div class="stats-sections-grid">
      ${genres.length    ? barSection('Géneros',     genres,    maxGenre) : ''}
      ${directors.length ? barSection('Realizadores', directors, maxDir)   : ''}
      ${actors.length    ? barSection('Actores',      actors,    maxActor)  : ''}

      ${topRated.length ? `
      <div class="stats-section">
        <div class="stats-section-title">Os teus favoritos</div>
        <div class="top-list">
          ${topRated.map((m, i) => `
            <div class="top-list-item">
              <div class="top-list-rank">${i + 1}</div>
              ${m.poster ? `<img class="top-list-poster" src="${m.poster}" alt="${esc(m.title)}" loading="lazy" />`
                         : `<div class="top-list-poster-placeholder">🎬</div>`}
              <div class="top-list-info">
                <div class="top-list-title">${esc(m.title)}</div>
                <div class="top-list-meta">${m.year} · ${typeLabel(m.type)}</div>
              </div>
              <div class="top-list-rating">${m.personalRating}/10</div>
            </div>`).join('')}
        </div>
      </div>` : ''}

      ${recent.length ? `
      <div class="stats-section" style="grid-column:1/-1">
        <div class="stats-section-title">Recentes</div>
        <div class="top-list">
          ${recent.map(m => `
            <div class="top-list-item">
              ${m.poster ? `<img class="top-list-poster" src="${m.poster}" alt="${esc(m.title)}" loading="lazy" />`
                         : `<div class="top-list-poster-placeholder">🎬</div>`}
              <div class="top-list-info">
                <div class="top-list-title">${esc(m.title)}</div>
                <div class="top-list-meta">${m.year} · ${m.genre.slice(0,2).join(', ') || '—'}</div>
              </div>
              ${m.personalRating ? `<div class="top-list-rating">${m.personalRating}/10</div>` : ''}
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>`}`;

  document.getElementById('statsTypeChip')?.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      statsFilter = btn.dataset.type;
      renderStats(container);
    });
  });
}

// ── FILTER HELPERS ────────────────────────────────
function collectGenres(movies) {
  const s = new Set();
  movies.forEach(m => m.genre.forEach(g => s.add(g)));
  return [...s].sort();
}

function applyFilters(movies, isWatchlist = false) {
  let list = [...movies];
  if (currentFilter.type !== 'all')
    list = list.filter(m => m.type === currentFilter.type);
  if (currentFilter.genre !== 'all')
    list = list.filter(m => m.genre.includes(currentFilter.genre));
  if (currentFilter.query) {
    const q = currentFilter.query.toLowerCase();
    list = list.filter(m =>
      m.title.toLowerCase().includes(q) ||
      (m.director && m.director.toLowerCase().includes(q)) ||
      (m.actors   && m.actors.toLowerCase().includes(q)));
  }

  if (currentFilter.suggestor !== 'all')
    list = list.filter(m => m.suggestedBy === currentFilter.suggestor);
  const s = currentFilter.sort;
  list.sort((a, b) => {
    if (s === 'title')          return a.title.localeCompare(b.title);
    if (s === 'year')           return parseInt(b.year) - parseInt(a.year);
    if (s === 'imdbRating')     return (parseFloat(b.imdbRating) || 0) - (parseFloat(a.imdbRating) || 0);
    if (s === 'personalRating') return (b.personalRating || 0) - (a.personalRating || 0);
    return new Date(b.addedAt) - new Date(a.addedAt);
  });
  return list;
}

function buildFiltersBar(genres, isWatchlist) {
  const sortOptions = isWatchlist
    ? `<option value="dateAdded">Data de adição</option><option value="title">Título A→Z</option><option value="year">Ano</option><option value="imdbRating">Nota IMDB</option>`
    : `<option value="dateAdded">Data de adição</option><option value="personalRating">Minha nota</option><option value="title">Título A→Z</option><option value="year">Ano</option><option value="imdbRating">Nota IMDB</option>`;

  return `
    <div class="filters-bar">
      ${isLoggedIn() || isWatchlist ? `
      <button class="btn-add btn-add-inline" id="btnAddInline">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        ${isWatchlist && !isLoggedIn() ? 'Sugerir' : 'Adicionar'}
      </button>` : ''}
      <div class="filter-search-wrap">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M10 10l2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input class="filter-search" id="filterQuery" placeholder="Pesquisar..." value="${esc(currentFilter.query)}" />
      </div>
      <div class="filter-chip" id="typeChip">
        <button data-type="all"    class="${currentFilter.type === 'all'    ? 'active' : ''}">Tudo</button>
        <button data-type="movie"  class="${currentFilter.type === 'movie'  ? 'active' : ''}">Filmes</button>
        <button data-type="series" class="${currentFilter.type === 'series' ? 'active' : ''}">Séries</button>
      </div>
      ${genres.length ? `
      <select class="filter-select" id="filterGenre">
        <option value="all">Todos os géneros</option>
        ${genres.map(g => `<option value="${esc(g)}" ${currentFilter.genre === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
      </select>` : ''}

      ${isWatchlist ? (() => {
        const suggestors = [...new Set(getWatchlist().map(m => m.suggestedBy).filter(Boolean))];
        return suggestors.length ? `
        <select class="filter-select" id="filterSuggestor">
          <option value="all">Todos</option>
          ${suggestors.map(s => `<option value="${esc(s)}" ${currentFilter.suggestor === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
        </select>` : '';
      })() : ''}

      <select class="filter-select" id="filterSort">
        ${sortOptions.replace(`value="${currentFilter.sort}"`, `value="${currentFilter.sort}" selected`)}
      </select>
    </div>`;
}

function attachFilterListeners(isWatchlist = false) {
  document.getElementById('btnAddInline')?.addEventListener('click', openAddModal);
  document.getElementById('filterQuery')?.addEventListener('input', e => {
    currentFilter.query = e.target.value;
    refreshGrid(isWatchlist);
  });
  document.getElementById('typeChip')?.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter.type = btn.dataset.type;
      document.querySelectorAll('#typeChip button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      refreshGrid(isWatchlist);
    });
  });
  document.getElementById('filterGenre')?.addEventListener('change', e => {
    currentFilter.genre = e.target.value;
    refreshGrid(isWatchlist);
  });
  document.getElementById('filterSort')?.addEventListener('change', e => {
    currentFilter.sort = e.target.value;
    refreshGrid(isWatchlist);
  });

  document.getElementById('filterSuggestor')?.addEventListener('change', e => {
    currentFilter.suggestor = e.target.value;
    refreshGrid(isWatchlist);
  });
}

function refreshGrid(isWatchlist) {
  const source   = isWatchlist ? getWatchlist() : getWatched();
  const filtered = applyFilters(source, isWatchlist);
  const listType = isWatchlist ? 'watchlist' : 'watched';
  const grid = document.getElementById('moviesGrid');
  if (!grid) return;
  grid.innerHTML = filtered.length === 0
    ? emptyState(isWatchlist ? 'watchlist' : 'mural')
    : filtered.map(m => buildCard(m, listType)).join('');
  attachCardListeners(listType);
}

// ── CARD BUILDER ──────────────────────────────────
function buildCard(movie, listType) {
  const poster = movie.poster
    ? `<img class="card-poster" src="${movie.poster}" alt="${esc(movie.title)}" loading="lazy" />`
    : `<div class="card-poster-placeholder"><span style="font-size:32px">🎬</span><span>${esc(movie.title)}</span></div>`;

  return `
    <div class="movie-card" data-id="${movie.imdbId}" data-list="${listType}">
      <div class="card-poster-wrap">
        ${poster}
        <div class="card-overlay">
          <div class="overlay-title">${esc(movie.title)}</div>
          <div class="overlay-year">${movie.year}</div>
        </div>
        ${movie.personalRating ? `<div class="card-personal-rating">${movie.personalRating}</div>` : ''}
        <div class="card-type-badge">${typeLabel(movie.type)}</div>
        ${listType === 'watchlist' && isLoggedIn() ? `<button class="watchlist-move-btn" data-id="${movie.imdbId}">✓ Já vi</button>` : ''}
      </div>
      <div class="card-info">
        <div class="card-title">${esc(movie.title)}</div>
        <div class="card-meta">${movie.year}${movie.imdbRating ? ' · ★ ' + movie.imdbRating : ''}</div>
        ${movie.suggestedBy ? `<span class="card-suggestor">💡 ${esc(movie.suggestedBy)}</span>` : ''}
      </div>
    </div>`;
}

function attachCardListeners(listType) {
  document.querySelectorAll('.movie-card').forEach(card => {
    card.addEventListener('click', e => {
      const moveBtn = e.target.closest('.watchlist-move-btn');
      if (moveBtn) { e.stopPropagation(); moveToMural(moveBtn.dataset.id); return; }
      openDetailModal(card.dataset.id, listType);
    });
  });
}

// ── EMPTY STATES ──────────────────────────────────
function emptyState(view) {
  if (view === 'mural') return `
    <div class="empty-state">
      <div class="empty-icon">🎬</div>
      <div class="empty-title">O mural está vazio</div>
      <div class="empty-sub">Clica em <strong>+ Adicionar</strong> para registar o primeiro filme ou série que viste.</div>
    </div>`;
  if (view === 'watchlist') return `
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-title">Nada na lista</div>
      <div class="empty-sub">Guarda filmes que queres ver mais tarde clicando em <strong>"Ver depois"</strong> quando pesquisas.</div>
    </div>`;
  return `<div class="empty-state"><div class="empty-title">Sem resultados</div></div>`;
}

// ── SUGGEST MODAL ────────────────────────────────
let pendingSuggestMovie = null;
let selectedSuggestor   = null;

function openSuggestModal(movie) {
  pendingSuggestMovie = movie;
  selectedSuggestor   = null;

  document.getElementById('suggestModal').classList.remove('hidden');

  document.getElementById('suggestMoviePreview').innerHTML = `
    <div class="register-preview">
      ${movie.poster ? `<img src="${movie.poster}" alt="${esc(movie.title)}" />` : '<span style="font-size:24px">🎬</span>'}
      <div>
        <div class="register-preview-title">${esc(movie.title)}</div>
        <div class="register-preview-meta">${movie.year} · ${typeLabel(movie.type)}</div>
      </div>
    </div>`;

  renderSuggestorChips();
  document.getElementById('newSuggestorWrap').style.display = 'none';
  document.getElementById('newSuggestorInput').value = '';
}

function renderSuggestorChips() {
  const chips = document.getElementById('suggestorChips');
  const list  = [...getSuggestors(), '+ Outro'];
  chips.innerHTML = list.map(name => `
    <button class="suggestor-chip ${selectedSuggestor === name ? 'active' : ''}" data-name="${esc(name)}">
      ${esc(name)}
    </button>`).join('');

  chips.querySelectorAll('.suggestor-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.name === '+ Outro') {
        selectedSuggestor = null;
        document.getElementById('newSuggestorWrap').style.display = 'block';
        document.getElementById('newSuggestorInput').focus();
      } else {
        selectedSuggestor = btn.dataset.name;
        document.getElementById('newSuggestorWrap').style.display = 'none';
      }
      chips.querySelectorAll('.suggestor-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function closeSuggestModal() {
  document.getElementById('suggestModal').classList.add('hidden');
  pendingSuggestMovie = null;
  selectedSuggestor   = null;
}

// ── ADD MODAL ─────────────────────────────────────
function openAddModal() {
  document.getElementById('addModal').classList.remove('hidden');
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '';
  setTimeout(() => document.getElementById('searchInput').focus(), 50);
}

function closeAddModal() {
  document.getElementById('addModal').classList.add('hidden');
}

async function handleSearch() {
  const input = document.getElementById('searchInput').value.trim();
  if (!input) return;
  const resultsEl = document.getElementById('searchResults');
  resultsEl.innerHTML = `<div class="search-loading"><span class="spinner"></span> A pesquisar...</div>`;
  try {
    const imdbId = extractImdbId(input);
    if (imdbId) {
      const data  = await omdbById(imdbId);
      resultsEl.innerHTML = buildSearchResult(normalizeOmdb(data));
    } else {
      const results = await omdbSearch(input);
      resultsEl.innerHTML = results.map(r => buildSearchResult({
        imdbId: r.imdbID, title: r.Title, year: r.Year,
        type: r.Type, poster: r.Poster !== 'N/A' ? r.Poster : null, genre: [],
      })).join('');
    }
    attachResultListeners();
  } catch (err) {
    const isCors = err.message === 'Failed to fetch' || err.name === 'TypeError';
    if (isCors) {
      resultsEl.innerHTML = `<div class="search-error">⚠ Não foi possível ligar à API OMDB.<br><br>
        Verifica a ligação à internet e se a key da OMDB está activada via email.</div>`;
    } else {
      resultsEl.innerHTML = `<div class="search-error">⚠ ${esc(err.message)}</div>`;
    }
  }
}

function buildSearchResult(m) {
  const alreadyWatched   = !!findInWatched(m.imdbId);
  const alreadyWatchlist = !!findInWatchlist(m.imdbId);
  return `
    <div class="search-result-item">
      ${m.poster ? `<img class="result-poster" src="${m.poster}" alt="${esc(m.title)}" loading="lazy" />`
                 : `<div class="result-poster-placeholder">🎬</div>`}
      <div class="result-info">
        <div class="result-title">${esc(m.title)}</div>
        <div class="result-meta">${m.year} · ${typeLabel(m.type)}</div>
      </div>
      <div class="result-actions">
        ${isLoggedIn()
          ? alreadyWatched
            ? `<button class="btn-sm btn-sm-ghost" disabled>✓ No mural</button>`
            : `<button class="btn-sm btn-sm-primary result-add-watched" data-id="${m.imdbId}">Já vi</button>`
          : ''}
        ${alreadyWatchlist
          ? `<button class="btn-sm btn-sm-ghost" disabled>✓ Na lista</button>`
          : `<button class="btn-sm btn-sm-ghost result-add-watchlist" data-id="${m.imdbId}">Ver depois</button>`}
      </div>
    </div>`;
}

function attachResultListeners() {
  document.querySelectorAll('.result-add-watched').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      btn.textContent = '...'; btn.disabled = true;
      const data  = await omdbById(btn.dataset.id).catch(err => { showToast(err.message, 'error'); return null; });
      if (!data) return;
      pendingMovie = normalizeOmdb(data);
      pendingDest  = 'watched';
      closeAddModal();
      openRegisterModal(pendingMovie);
    });
  });

  document.querySelectorAll('.result-add-watchlist').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      btn.textContent = '...'; btn.disabled = true;
      try {
        const data  = await omdbById(btn.dataset.id);
        const movie = normalizeOmdb(data);
        closeAddModal();
        openSuggestModal(movie);
      } catch (err) {
        showToast(err.message, 'error');
        btn.textContent = 'Ver depois'; btn.disabled = false;
      }
    });
  });
}

// ── REGISTER MODAL ────────────────────────────────
function resetRegisterBtn() {
  const submit = document.querySelector('#registerForm [type="submit"]');
  if (submit) { submit.textContent = 'Guardar no Mural'; submit.disabled = false; }
  const ratingInput = document.getElementById('ratingInput');
  if (ratingInput) ratingInput.value = '';
  document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('selected'));
}

function openRegisterModal(movie, existingData = null) {
  document.getElementById('registerTitle').textContent = existingData ? 'Editar entrada' : 'Registar no Mural';
  document.getElementById('registerModal').classList.remove('hidden');
  resetRegisterBtn();

  document.getElementById('registerMoviePreview').innerHTML = `
    <div class="register-preview">
      ${movie.poster ? `<img src="${movie.poster}" alt="${esc(movie.title)}" />` : '<span style="font-size:24px">🎬</span>'}
      <div>
        <div class="register-preview-title">${esc(movie.title)}</div>
        <div class="register-preview-meta">${movie.year} · ${typeLabel(movie.type)}</div>
      </div>
    </div>`;

  const ratingRow   = document.getElementById('ratingRow');
  const ratingInput = document.getElementById('ratingInput');
  ratingRow.innerHTML = '';

  const setRating = (val) => {
    ratingInput.value = val !== null ? parseFloat(val).toFixed(1) : '';
    ratingRow.querySelectorAll('.rating-btn').forEach(b => {
      b.classList.toggle('selected', parseInt(b.dataset.val) === Math.round(parseFloat(val)));
    });
  };

  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'rating-btn';
    btn.textContent = i; btn.dataset.val = i;
    btn.addEventListener('click', () => setRating(i));
    ratingRow.appendChild(btn);
  }

  ratingInput.addEventListener('input', () => {
    const v = parseFloat(ratingInput.value);
    if (!isNaN(v) && v >= 1 && v <= 10) {
      ratingRow.querySelectorAll('.rating-btn').forEach(b => {
        b.classList.toggle('selected', parseInt(b.dataset.val) === Math.round(v));
      });
    }
  });

  setRating(existingData?.personalRating ?? null);

  document.getElementById('reviewInput').value = existingData?.review || '';
}

function closeRegisterModal() {
  document.getElementById('registerModal').classList.add('hidden');
  pendingMovie = null; pendingDest = null; editingId = null;
  resetRegisterBtn();
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const submit = e.target.querySelector('[type="submit"]');
  submit.textContent = 'A guardar...'; submit.disabled = true;

  const ratingInput    = document.getElementById('ratingInput');
  const inputVal       = parseFloat(ratingInput?.value);
  const personalRating = !isNaN(inputVal) && inputVal >= 1 && inputVal <= 10 ? inputVal : null;
  const review         = document.getElementById('reviewInput').value.trim() || null;

  try {
    if (editingId) {
      await updateWatched(editingId, { personalRating, review });
      closeRegisterModal();
      showToast('Actualizado ✓');
      if (currentView === 'mural') renderApp();
    } else if (pendingMovie) {
      const movie = { ...pendingMovie, personalRating, review, addedAt: new Date().toISOString() };
      await addToWatched(movie);
      closeRegisterModal();
      showToast(`"${movie.title}" adicionado ao mural 🎬`);
      if (currentView === 'mural') renderApp();
    }
  } catch (err) {
    showToast('Erro ao guardar: ' + err.message, 'error');
    submit.textContent = 'Guardar no Mural'; submit.disabled = false;
  }
}

// ── DETAIL MODAL ──────────────────────────────────
function openDetailModal(id, listType) {
  const movie = listType === 'watchlist' ? findInWatchlist(id) : findInWatched(id);
  if (!movie) return;

  document.getElementById('detailModal').classList.remove('hidden');
  const isWatchlist = listType === 'watchlist';
  const actorsArr   = movie.actors ? movie.actors.split(', ') : [];

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-layout">
      ${movie.poster
        ? `<div class="detail-poster"><img src="${movie.poster}" alt="${esc(movie.title)}" /></div>`
        : `<div class="detail-poster-placeholder">🎬</div>`}
      <div class="detail-body">
        <div class="detail-type-badge">${typeLabel(movie.type)}</div>
        <div class="detail-title">${esc(movie.title)}</div>
        <div class="detail-year-dir">${movie.year}${movie.director ? ' · ' + esc(movie.director) : ''}</div>

        <div class="detail-ratings">
          ${movie.imdbRating ? `<div class="rating-chip"><span>★ ${movie.imdbRating}</span><span class="chip-label">IMDB</span></div>` : ''}
          ${movie.personalRating ? `<div class="rating-chip personal"><span>${movie.personalRating}/10</span><span class="chip-label">a tua nota</span></div>` : ''}
          ${movie.rated ? `<div class="rating-chip"><span>${esc(movie.rated)}</span><span class="chip-label">classificação</span></div>` : ''}
        </div>

        ${movie.genre.length ? `<div class="detail-genres">${movie.genre.map(g => `<span class="genre-tag">${esc(g)}</span>`).join('')}</div>` : ''}
        ${movie.plot ? `<div class="detail-plot">${esc(movie.plot)}</div>` : ''}

        <div class="detail-meta-grid">
          ${actorsArr.length ? `<div class="meta-item"><div class="meta-key">Actores</div><div class="meta-val">${actorsArr.slice(0,4).map(esc).join(', ')}</div></div>` : ''}
          ${movie.runtime    ? `<div class="meta-item"><div class="meta-key">Duração</div><div class="meta-val">${esc(movie.runtime)}</div></div>` : ''}
          ${movie.country    ? `<div class="meta-item"><div class="meta-key">País</div><div class="meta-val">${esc(movie.country)}</div></div>` : ''}
        </div>

        ${!isWatchlist && movie.review ? `
          <div class="detail-divider"></div>
          <div class="detail-personal-section">
            <h3>A tua entrada</h3>
            <div class="detail-review">"${esc(movie.review)}"</div>
          </div>` : ''}

        ${isLoggedIn() ? `
        <div class="detail-divider"></div>
        <div class="detail-actions">
          ${isWatchlist
            ? `<button class="btn-primary" id="detailMoveToMural" data-id="${movie.imdbId}">✓ Já vi — Adicionar ao Mural</button>`
            : `<button class="btn-ghost" id="detailEdit" data-id="${movie.imdbId}">Editar nota / review</button>`}
          <button class="btn-danger" id="detailDelete" data-id="${movie.imdbId}" data-list="${listType}">Remover</button>
        </div>` : ''}
      </div>
    </div>`;

  document.getElementById('detailDelete')?.addEventListener('click', async e => {
    const { id, list } = e.target.dataset;
    if (!confirm('Tens a certeza que queres remover?')) return;
    e.target.textContent = 'A remover...'; e.target.disabled = true;
    try {
      if (list === 'watchlist') await removeFromWatchlist(id);
      else await removeFromWatched(id);
      closeDetailModal();
      renderApp();
      showToast('Removido');
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('detailEdit')?.addEventListener('click', e => {
    const m = findInWatched(e.target.dataset.id);
    if (!m) return;
    editingId = m.imdbId; pendingMovie = m;
    closeDetailModal();
    openRegisterModal(m, m);
  });

  document.getElementById('detailMoveToMural')?.addEventListener('click', e => {
    closeDetailModal();
    moveToMural(e.target.dataset.id);
  });
}

function closeDetailModal() {
  document.getElementById('detailModal').classList.add('hidden');
}

// ── MOVE WATCHLIST → MURAL ────────────────────────
function moveToMural(id) {
  const movie = findInWatchlist(id);
  if (!movie) return;
  pendingMovie = movie;
  pendingDest  = 'watched';
  removeFromWatchlist(id).then(() => renderApp());
  openRegisterModal(movie);
}

// ── UTILS ─────────────────────────────────────────
function toggleBarSection(id) {
  const section  = document.getElementById(id);
  const extras   = section.querySelectorAll('[data-bar-extra]');
  const btn      = section.querySelector('.btn-ver-mais');
  const hidden   = [...extras].some(el => el.style.display === 'none');
  const preview  = 5;
  extras.forEach((el, i) => {
    if (i >= preview) el.style.display = hidden ? '' : 'none';
  });
  btn.textContent = hidden
    ? 'Ver menos'
    : `Ver mais (${extras.length - preview})`;
}

function formatTotalTime(minutes) {
  if (minutes === 0) return '0 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins  = minutes % 60;
  if (hours < 24) return `${hours}h${mins > 0 ? ' ' + mins + 'min' : ''}`;
  const days     = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days < 30) return `${days} dias${remHours > 0 ? ' ' + remHours + 'h' : ''}`;
  const months  = Math.floor(days / 30);
  const remDays = days % 30;
  return `${months} ${months === 1 ? 'mês' : 'meses'}${remDays > 0 ? ' ' + remDays + ' dias' : ''}`;
}

function typeLabel(type) {
  if (type === 'movie')  return 'Filme';
  if (type === 'series') return 'Série';
  return type || '—';
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg, type = 'success') {
  clearTimeout(toastTimer);
  let toast = document.querySelector('.toast');
  if (!toast) { toast = document.createElement('div'); toast.className = 'toast'; document.body.appendChild(toast); }
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  requestAnimationFrame(() => toast.classList.add('show'));
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

// ── EVENTS ────────────────────────────────────────
function initEvents() {
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.view)));

  document.getElementById('closeAddModal').addEventListener('click', closeAddModal);
  document.getElementById('addModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAddModal(); });

  document.getElementById('btnSearch').addEventListener('click', handleSearch);
  document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });

  let searchDebounce;
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(searchDebounce);
    const val = e.target.value.trim();
    if (val.length < 3) { document.getElementById('searchResults').innerHTML = ''; return; }
    document.getElementById('searchResults').innerHTML =
      `<div class="search-loading"><span class="spinner"></span> A pesquisar...</div>`;
    searchDebounce = setTimeout(handleSearch, 450);
  });

  document.getElementById('closeDetailModal').addEventListener('click', closeDetailModal);
  document.getElementById('detailModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeDetailModal(); });

  document.getElementById('closeRegisterModal').addEventListener('click', closeRegisterModal);
  document.getElementById('registerModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeRegisterModal(); });
  document.getElementById('registerForm').addEventListener('submit', handleRegisterSubmit);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeDetailModal(); closeAddModal(); closeRegisterModal();
      document.getElementById('loginModal').classList.add('hidden');
    }
  });

  // Suggest modal
  document.getElementById('closeSuggestModal').addEventListener('click', closeSuggestModal);
  document.getElementById('suggestModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSuggestModal();
  });
  document.getElementById('confirmSuggest').addEventListener('click', async () => {
    const btn = document.getElementById('confirmSuggest');
    const newName = document.getElementById('newSuggestorInput').value.trim();
    const suggestor = newName || selectedSuggestor;

    btn.textContent = 'A guardar...'; btn.disabled = true;
    try {
      const title = pendingSuggestMovie.title;
      await addToWatchlist(pendingSuggestMovie, suggestor);
      closeSuggestModal();
      showToast(`"${title}" guardado na watchlist 📋`);
      if (currentView === 'watchlist') renderApp();
    } catch (err) {
      showToast(err.message, 'error');
      btn.textContent = 'Guardar na Watchlist'; btn.disabled = false;
    }
  });

  // Login modal
  document.getElementById('closeLoginModal').addEventListener('click', () =>
    document.getElementById('loginModal').classList.add('hidden'));
  document.getElementById('loginModal').addEventListener('click', e => {
    if (e.target === e.currentTarget)
      document.getElementById('loginModal').classList.add('hidden');
  });
  document.getElementById('loginForm').addEventListener('submit', handleLoginSubmit);
}

// ── INIT ─────────────────────────────────────────
async function init() {
  initEvents();

  // Loading state
  document.getElementById('app').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:60vh;gap:12px;color:var(--muted)">
      <span class="spinner"></span> A carregar...
    </div>`;

  // Restaurar sessão existente
  const { data: { session } } = await db.auth.getSession();
  currentUser = session?.user ?? null;
  renderNavAuth();

  try {
    await loadData();

    // Migrar dados do localStorage (versão anterior) se Supabase estiver vazio
    if (_watched.length === 0 && _watchlist.length === 0) {
      const localWatched   = JSON.parse(localStorage.getItem('zedb_watched')   || '[]');
      const localWatchlist = JSON.parse(localStorage.getItem('zedb_watchlist') || '[]');
      if (localWatched.length > 0 || localWatchlist.length > 0) {
        document.getElementById('app').innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:60vh;gap:12px;color:var(--muted)">
            <span class="spinner"></span> A migrar dados para a cloud...
          </div>`;
        let migrated = 0;
        let failed   = 0;
        for (const m of localWatched)   { try { await addToWatched(m);   migrated++; } catch { failed++; } }
        for (const m of localWatchlist) { try { await addToWatchlist(m); migrated++; } catch { failed++; } }
        // Só limpar localStorage se tudo migrou com sucesso
        if (failed === 0) {
          localStorage.removeItem('zedb_watched');
          localStorage.removeItem('zedb_watchlist');
          showToast(`${migrated} entradas migradas para a cloud ✓`);
        } else {
          showToast(`Migração parcial: ${migrated} ok, ${failed} falharam. Tenta recarregar.`, 'error');
        }
      }
    }
  } catch (err) {
    document.getElementById('app').innerHTML = `
      <div style="text-align:center;padding:60px;color:#e05555">
        Erro ao ligar ao Supabase:<br><br>${esc(err.message)}
      </div>`;
    return;
  }

  renderApp();
}

document.addEventListener('DOMContentLoaded', init);
