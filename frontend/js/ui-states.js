/**
 * UIStates - Aavin R&D System UI State Management Utility
 * Provides standardized rendering across all portals for:
 * Loading, Empty, Error, No Results, Unauthorized, Session Expired, Saving, Success, Network Error.
 */

const UIStates = {
  // 1. Loading State (Spinners or Skeleton)
  renderLoading(container, options = {}) {
    const message = options.message || 'Loading data...';
    const useSkeleton = options.skeleton || false;
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) return;

    if (useSkeleton) {
      target.innerHTML = `
        <div class="ui-state-card ui-state-loading">
          <div class="skeleton-line full"></div>
          <div class="skeleton-line medium"></div>
          <div class="skeleton-line short"></div>
        </div>
      `;
    } else {
      target.innerHTML = `
        <div class="ui-state-card ui-state-loading">
          <div class="spinner mb-2"></div>
          <div class="ui-state-title" style="font-size:0.9rem; font-weight:500; color:var(--gray-600);">${message}</div>
        </div>
      `;
    }
  },

  // 2. Empty State
  renderEmpty(container, options = {}) {
    const title = options.title || 'No Records Found';
    const message = options.message || 'There is currently no data available to display in this section.';
    const actionText = options.actionText;
    const onAction = options.onAction;
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) return;

    target.innerHTML = `
      <div class="ui-state-card ui-state-empty">
        <div class="ui-state-icon">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
        </div>
        <div class="ui-state-title">${title}</div>
        <div class="ui-state-desc">${message}</div>
        ${actionText ? `<div class="ui-state-action"><button class="btn btn-outline btn-sm ui-state-action-btn">${actionText}</button></div>` : ''}
      </div>
    `;

    if (actionText && typeof onAction === 'function') {
      const btn = target.querySelector('.ui-state-action-btn');
      if (btn) btn.addEventListener('click', onAction);
    }
  },

  // 3. No Results State (Search/Filter)
  renderNoResults(container, options = {}) {
    const title = options.title || 'No Matching Results';
    const message = options.message || 'We could not find any records matching your filter or search query.';
    const actionText = options.actionText || 'Clear Search';
    const onAction = options.onAction;
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) return;

    target.innerHTML = `
      <div class="ui-state-card ui-state-no-results">
        <div class="ui-state-icon">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
        </div>
        <div class="ui-state-title">${title}</div>
        <div class="ui-state-desc">${message}</div>
        ${actionText ? `<div class="ui-state-action"><button class="btn btn-outline btn-sm ui-state-action-btn">${actionText}</button></div>` : ''}
      </div>
    `;

    if (actionText && typeof onAction === 'function') {
      const btn = target.querySelector('.ui-state-action-btn');
      if (btn) btn.addEventListener('click', onAction);
    }
  },

  // 4. Error State
  renderError(container, options = {}) {
    const title = options.title || 'Unable to Load Data';
    const message = options.message || 'An unexpected issue occurred while processing your request. Please try again.';
    const actionText = options.actionText || 'Retry';
    const onAction = options.onAction;
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) return;

    target.innerHTML = `
      <div class="ui-state-card ui-state-error">
        <div class="ui-state-icon">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        </div>
        <div class="ui-state-title">${title}</div>
        <div class="ui-state-desc">${message}</div>
        ${actionText && typeof onAction === 'function' ? `<div class="ui-state-action"><button class="btn btn-outline btn-sm ui-state-action-btn">${actionText}</button></div>` : ''}
      </div>
    `;

    if (actionText && typeof onAction === 'function') {
      const btn = target.querySelector('.ui-state-action-btn');
      if (btn) btn.addEventListener('click', onAction);
    }
  },

  // 5. Network Error State
  renderNetworkError(container, options = {}) {
    const title = options.title || 'Connection Failed';
    const message = options.message || 'Unable to connect to the server. Please check your internet connection and try again.';
    const actionText = options.actionText || 'Retry Connection';
    const onAction = options.onAction;
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) return;

    target.innerHTML = `
      <div class="ui-state-card ui-state-network-error">
        <div class="ui-state-icon">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a5 5 0 010-7.072m-2.829-2.829a9 9 0 0112.728 0M3 3l18 18"></path></svg>
        </div>
        <div class="ui-state-title">${title}</div>
        <div class="ui-state-desc">${message}</div>
        ${actionText ? `<div class="ui-state-action"><button class="btn btn-primary btn-sm ui-state-action-btn">${actionText}</button></div>` : ''}
      </div>
    `;

    if (actionText && typeof onAction === 'function') {
      const btn = target.querySelector('.ui-state-action-btn');
      if (btn) btn.addEventListener('click', onAction);
    }
  },

  // 6. Unauthorized State
  renderUnauthorized(container, options = {}) {
    const title = options.title || 'Access Restricted';
    const message = options.message || 'You do not have permission to view or access this section.';
    const actionText = options.actionText || 'Go to Login';
    const loginUrl = options.loginUrl || '/login.html';
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) return;

    target.innerHTML = `
      <div class="ui-state-card ui-state-unauthorized">
        <div class="ui-state-icon">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
        </div>
        <div class="ui-state-title">${title}</div>
        <div class="ui-state-desc">${message}</div>
        <div class="ui-state-action">
          <a href="${loginUrl}" class="btn btn-primary btn-sm">${actionText}</a>
        </div>
      </div>
    `;
  },

  // 7. Session Expired State
  renderSessionExpired(container, options = {}) {
    const title = options.title || 'Session Expired';
    const message = options.message || 'Your login session has expired. Please sign in again to continue.';
    const actionText = options.actionText || 'Sign In Again';
    const loginUrl = options.loginUrl || '/login.html';
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) return;

    target.innerHTML = `
      <div class="ui-state-card ui-state-session-expired">
        <div class="ui-state-icon">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        </div>
        <div class="ui-state-title">${title}</div>
        <div class="ui-state-desc">${message}</div>
        <div class="ui-state-action">
          <a href="${loginUrl}" class="btn btn-primary btn-sm">${actionText}</a>
        </div>
      </div>
    `;
  },

  // 8. Saving State for Buttons
  setSaving(btnElement, isSaving = true, savingText = 'Saving...') {
    const btn = typeof btnElement === 'string' ? document.querySelector(btnElement) : btnElement;
    if (!btn) return;

    if (isSaving) {
      if (!btn.dataset.originalText) {
        btn.dataset.originalText = btn.innerHTML;
      }
      btn.disabled = true;
      btn.classList.add('btn-saving');
      btn.innerHTML = `<span class="spinner-inline"></span>${savingText}`;
    } else {
      btn.disabled = false;
      btn.classList.remove('btn-saving');
      if (btn.dataset.originalText) {
        btn.innerHTML = btn.dataset.originalText;
      }
    }
  },

  // 9. Success Banner State
  renderSuccess(container, options = {}) {
    const title = options.title || 'Success';
    const message = options.message || 'Action completed successfully.';
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) return;

    target.innerHTML = `
      <div class="ui-state-success-banner">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        <div>
          <strong>${title}:</strong> ${message}
        </div>
      </div>
    `;
  },

  // 10. Intelligent Fetch Error Handler
  handleFetchError(error, container, retryCallback) {
    if (!navigator.onLine || (error.message && (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')))) {
      this.renderNetworkError(container, { onAction: retryCallback });
    } else if (error.status === 401 || (error.message && (error.message.includes('401') || error.message.includes('JWT') || error.message.includes('session')))) {
      this.renderSessionExpired(container);
    } else if (error.status === 403 || (error.message && (error.message.includes('403') || error.message.includes('permission')))) {
      this.renderUnauthorized(container);
    } else {
      this.renderError(container, {
        message: 'An unexpected issue occurred while fetching data. Please try again.',
        onAction: retryCallback
      });
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIStates;
}
