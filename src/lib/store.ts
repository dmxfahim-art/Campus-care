export const storeScript = `
  let cachedUser = null;
  let userFetchPromise = null;

  function applyUserToDom(user) {
    if (!user) return;
    const update = () => {
      document.querySelectorAll('[data-user-name], [data-admin-name]').forEach(el => {
        el.textContent = user.name || '';
      });
      document.querySelectorAll('[data-user-meta]').forEach(el => {
        el.textContent = \`\${user.role || 'user'} · \${user.studentId || user.id || ''}\`;
      });
      document.querySelectorAll('[data-admin-role]').forEach(el => {
        el.textContent = user.role === 'admin' ? 'Administrator' : 'Department staff';
      });
      const initials = (user.name || '').trim().split(/\\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || 'U';
      document.querySelectorAll('[data-user-avatar], [data-admin-avatar], [data-top-avatar], #report-avatar').forEach(el => {
        el.textContent = initials;
      });
      if (user.role !== 'admin') {
        document.querySelectorAll('[data-admin-only]').forEach(el => el.hidden = true);
      }
    };
    update();
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', update, { once: true });
    }
  }

  async function fetchUser(force = false) {
    if (cachedUser && !force) {
      applyUserToDom(cachedUser);
      return cachedUser;
    }
    if (userFetchPromise && !force) return userFetchPromise;
    userFetchPromise = (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (!res.ok) {
          cachedUser = null;
          return null;
        }
        const data = await res.json();
        cachedUser = data.user || null;
        if (cachedUser) applyUserToDom(cachedUser);
        return cachedUser;
      } catch {
        cachedUser = null;
        return null;
      } finally {
        userFetchPromise = null;
      }
    })();
    return userFetchPromise;
  }

  function getUser() {
    return cachedUser;
  }

  function setUser(user) {
    cachedUser = user || null;
    if (cachedUser) applyUserToDom(cachedUser);
    return cachedUser;
  }

  function getState() {
    return { user: cachedUser, mode: cachedUser ? 'api' : null };
  }

  function saveState(state) {
    cachedUser = (state && state.user) || null;
    if (cachedUser) applyUserToDom(cachedUser);
    return { user: cachedUser, mode: cachedUser ? 'api' : null };
  }

  async function logout() {
    showLoader('Signing out...');
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    cachedUser = null;
    try { localStorage.clear(); } catch {}
    location.replace('/login');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  }

  let activeApiRequests = 0;
  function updateLoaderUi() {
    const bar = document.getElementById('global-loader-bar');
    const pill = document.getElementById('global-loader-pill');
    if (activeApiRequests > 0) {
      if (bar) bar.classList.add('loading');
      if (pill) pill.classList.add('loading');
    } else {
      if (bar) bar.classList.remove('loading');
      if (pill) pill.classList.remove('loading');
    }
  }

  function showLoader(customText) {
    activeApiRequests++;
    const textEl = document.getElementById('global-loader-text');
    if (textEl && customText) textEl.textContent = customText;
    updateLoaderUi();
  }

  function hideLoader() {
    activeApiRequests = Math.max(0, activeApiRequests - 1);
    if (activeApiRequests === 0) {
      const textEl = document.getElementById('global-loader-text');
      if (textEl) textEl.textContent = 'Loading...';
    }
    updateLoaderUi();
  }

  function loaderHtml(text = 'Loading...') {
    return '<div class="content-loader"><div class="spinner"></div><span>' + escapeHtml(text) + '</span></div>';
  }

  function setButtonLoading(button, isLoading, loadingText) {
    if (!button) return;
    if (isLoading) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.classList.add('btn-loading');
      button.innerHTML = '<span class="btn-spinner"></span> ' + escapeHtml(loadingText || 'Please wait...');
    } else {
      button.disabled = false;
      button.classList.remove('btn-loading');
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  const LUCIDE_ICONS = {
    'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect>',
    'home': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
    'file-text': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
    'tag': '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"></path><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"></circle>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><path d="M16 3.128a4 4 0 0 1 0 7.744"></path><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><circle cx="9" cy="7" r="4"></circle>',
    'message-square': '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"></path>',
    'plus': '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
    'bell': '<path d="M10.268 21a2 2 0 0 0 3.464 0"></path><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path>',
    'help-circle': '<circle cx="12" cy="12" r="10"></circle><path d="M9 9.5a3 2.5 0 016 0c0 2-2 2-3 3.5"></path><path d="M12 17h.01"></path>',
    'clock': '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>',
    'check-circle-2': '<circle cx="12" cy="12" r="10"></circle><path d="m16 9-5.5 5.5L8 12"></path>',
    'check': '<path d="M20 6 9 17l-5-5"></path>',
    'circle': '<circle cx="12" cy="12" r="10"></circle>',
    'chevron-right': '<path d="m9 18 6-6-6-6"></path>',
    'chevron-left': '<path d="m15 18-6-6 6-6"></path>',
    'arrow-right': '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>',
    'arrow-left': '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
    'sparkles': '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"></path><path d="M20 2v4"></path><path d="M22 4h-4"></path><circle cx="4" cy="20" r="2"></circle>',
    'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path>',
    'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path><path d="m15 5 4 4"></path>'
  };

  function icon(name, options = {}) {
    const size = options.size || 18;
    const cls = options.class || '';
    const strokeWidth = options.strokeWidth || 2;
    const inner = LUCIDE_ICONS[name] || '';
    if (!inner) return '';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round" class="app-icon icon-' + name + ' ' + cls + '" aria-hidden="true">' + inner + '</svg>';
  }

  if (typeof window !== 'undefined') {
    if (window.fetch) {
      const rawFetch = window.fetch;
      window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        const isApi = typeof url === 'string' && url.includes('/api/');
        if (isApi) showLoader();
        try {
          return await rawFetch.apply(this, args);
        } finally {
          if (isApi) hideLoader();
        }
      };
    }
    document.addEventListener('DOMContentLoaded', () => {
      if (cachedUser) applyUserToDom(cachedUser);
    });
  }

  window.CampusCare = {
    getUser,
    setUser,
    fetchUser,
    applyUserToDom,
    getState,
    saveState,
    escapeHtml,
    logout,
    showLoader,
    hideLoader,
    loaderHtml,
    setButtonLoading,
    icon
  };
`;
