/**
 * MazaoHub Inline Visual CMS Engine
 */

(function () {
  // Selectors for repeatable elements (cards, list items, etc.)
  const REPEATABLE_SELECTORS = [
    '.pkg-grid > div',
    '.board-grid > div',
    '.news-grid > div',
    '.offer-grid > div',
    '.ai-feats > div',
    '.eng-grid > div',
    '.aud-grid > div',
    '.region-cards > div',
    '.proc-grid > div',
    '.counts-grid > div',
    '.field-grid > div',
    '.agri-grid > div',
    '.tech-row > div',
    '.agents-grid > div',
    '.price-grid > div',
    '.mk-grid > div',
    '.pkg-card ul > li',
    '.pkg-card ol > li',
    '.art-body ul > li',
    '.art-body ol > li'
  ];

  // Core CMS state
  let state = {
    authenticated: false,
    editMode: false,
    previewMode: false,
    activeSection: null,
    history: [],
    historyIndex: -1,
    content: {}, // baseline content loaded from DB
    draftChanges: {}, // un-saved local changes
    isDirty: false,
    autoSaveTimer: null
  };

  // Get combined content map (live content + draft changes)
  function getActiveContentMap() {
    const combined = {};
    for (const [key, item] of Object.entries(state.content)) {
      combined[key] = item;
    }
    for (const [key, item] of Object.entries(state.draftChanges)) {
      combined[key] = item;
    }
    return combined;
  }

  // Helper: check if element belongs to the CMS dashboard/toolbar/popover/modal
  function isCmsElement(el) {
    if (!el) return false;
    
    // Check if it is within a CMS wrapper element
    if (el.closest('.cms-toolbar') || el.closest('.cms-card-tools') || el.closest('.cms-popover') || el.closest('.cms-modal-overlay')) {
      return true;
    }
    
    // Check its class name (taking care of SVG class names or standard strings)
    if (typeof el.className === 'string' && el.className.includes('cms-')) {
      return true;
    }
    if (el.className && typeof el.className === 'object' && el.className.baseVal && el.className.baseVal.includes('cms-')) {
      return true;
    }
    
    return false;
  }

  // Entry point
  window.addEventListener('DOMContentLoaded', async () => {
    initSections();
    await checkAuth();
    await loadContent();
    if (state.authenticated) {
      injectAdminInterface();
      enterEditMode();
    } else {
      injectLoginButton();
    }
  });

  // Track sections, headers, and footers in the DOM
  function initSections() {
    // Include sections, headers, and footers
    document.querySelectorAll('section, header, footer').forEach((section, idx) => {
      let sectionId = section.id || section.className.split(' ')[0] || `${section.tagName.toLowerCase()}-${idx}`;
      section.setAttribute('data-cms-section', sectionId);
      section.classList.add('cms-section-container');
    });
  }

  // Check login status with cache-busting
  async function checkAuth() {
    try {
      const res = await fetch(`/api/auth/check?t=${Date.now()}`);
      const data = await res.json();
      state.authenticated = data.authenticated;
    } catch (e) {
      console.error('Failed to check auth state:', e);
    }
  }

  // Load Content (Live or Draft based on auth) with cache-busting
  async function loadContent() {
    try {
      const endpoint = state.authenticated ? '/api/content/draft' : '/api/content';
      const res = await fetch(`${endpoint}?t=${Date.now()}`);
      state.content = await res.json();
      applyContentMap(state.content);
    } catch (e) {
      console.error('Failed to load page content:', e);
    }
  }

  // Parse key and update DOM values
  function applyContentMap(contentMap) {
    // First, restore container repeatable element counts
    for (const [key, item] of Object.entries(contentMap)) {
      if (key.endsWith(':count')) {
        const path = key.substring(0, key.length - 6);
        const count = parseInt(item.value, 10);
        restoreRepeatableCount(path, count);
      }
    }

    // Second, update element texts, links, images, and visibility states
    for (const [key, item] of Object.entries(contentMap)) {
      if (key.endsWith(':count')) continue;
      
      const el = resolveKeyToElement(key);
      if (!el) continue;

      if (item.type === 'text') {
        if (el.hasAttribute('data-count')) {
          const cleanNum = item.value.replace(/[^0-9]/g, '');
          el.setAttribute('data-count', cleanNum);
          if (state.editMode && !state.previewMode) {
            el.innerHTML = item.value;
          } else {
            el.innerHTML = '0';
            if (typeof window.animateCount === 'function') {
              window.animateCount(el);
            }
          }
        } else {
          el.innerHTML = item.value;
        }
      } else if (item.type === 'image') {
        if (item.value) {
          if (el.tagName === 'IMG') {
            el.setAttribute('src', item.value);
          } else {
            el.style.backgroundImage = `url('${item.value}')`;
          }
        }
      } else if (item.type === 'button') {
        const btnData = JSON.parse(item.value);
        // Only overwrite innerHTML for non-structural links.
        // Structural links contain layout children (img, div, svg, headings, paragraphs)
        // e.g. the brand logo anchor or team member card anchors.
        const hasStructuralChildren = el.querySelector('img, div, svg, h1, h2, h3, h4, h5, h6, p');
        if (!hasStructuralChildren && btnData.text !== null && btnData.text !== undefined) {
          el.innerHTML = btnData.text;
        }
        if (el.tagName === 'A') {
          el.setAttribute('href', btnData.url);
          if (btnData.target) {
            el.setAttribute('target', btnData.target);
          } else {
            el.removeAttribute('target');
          }
        }
        if (btnData.visible === false) {
          el.classList.add('cms-element-hidden');
          if (!state.editMode) el.style.display = 'none';
        } else {
          el.classList.remove('cms-element-hidden');
          el.style.display = '';
        }
      } else if (item.type === 'section_visibility') {
        const isVisible = item.value === 'true';
        if (!isVisible) {
          el.classList.add('cms-element-hidden');
          if (!state.editMode) el.style.display = 'none';
        } else {
          el.classList.remove('cms-element-hidden');
          el.style.display = '';
        }
      }
    }
  }

  // Helper: Find element parent view and generate unique paths
  function getElementKey(el, section) {
    let path = [];
    let current = el;
    while (current && current !== section) {
      let tagName = current.tagName.toLowerCase();
      let index = 0;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }
      path.unshift(`${tagName}[${index}]`);
      current = current.parentElement;
    }
    const sectionId = section.getAttribute('data-cms-section');
    const route = section.closest('.view')?.getAttribute('data-route') || 'global';
    return `${route}:${sectionId}:${path.join('>')}`;
  }

  // Helper: Find container parent route and generate container paths
  function getContainerKey(container, section) {
    return getElementKey(container, section);
  }

  // Find DOM element from path key
  function resolveKeyToElement(key) {
    const parts = key.split(':');
    if (parts.length < 3) return null;
    const [route, sectionId, selectorPath] = parts;

    // Find parent view
    let view;
    if (route === 'global') {
      view = document.body;
    } else {
      view = document.querySelector(`.view[data-route="${route}"]`);
    }
    if (!view) return null;

    // Find section
    const section = view.querySelector(`[data-cms-section="${sectionId}"]`);
    if (!section) return null;

    // Resolve element selector path
    const pathParts = selectorPath.split('>');
    let current = section;
    for (const part of pathParts) {
      const match = part.match(/^([a-z0-9-]+)\[(\d+)\]$/i);
      if (!match) return null;
      const [, tagName, index] = match;
      const children = Array.from(current.children).filter(child => child.tagName.toLowerCase() === tagName);
      const targetIndex = parseInt(index, 10);
      if (targetIndex >= children.length) return null;
      current = children[targetIndex];
    }
    return current;
  }

  // Clone or remove repeatable DOM items to match count
  function restoreRepeatableCount(containerKey, targetCount) {
    const container = resolveKeyToElement(containerKey);
    if (!container) return;

    const childTagName = Array.from(container.children)[0]?.tagName;
    if (!childTagName) return;

    let matchingChildren = Array.from(container.children).filter(child => child.tagName === childTagName);
    const originalTemplate = matchingChildren[0];
    if (!originalTemplate) return;

    // Duplicate templates if count is greater
    while (matchingChildren.length < targetCount) {
      const clone = originalTemplate.cloneNode(true);
      // Strip editing triggers or unique IDs from clone
      clone.classList.remove('cms-active-edit');
      container.appendChild(clone);
      matchingChildren = Array.from(container.children).filter(child => child.tagName === childTagName);
    }

    // Delete excess elements if count is less
    while (matchingChildren.length > targetCount && matchingChildren.length > 1) {
      const lastChild = matchingChildren[matchingChildren.length - 1];
      container.removeChild(lastChild);
      matchingChildren = Array.from(container.children).filter(child => child.tagName === childTagName);
    }
  }

  // Inject "Admin Portal" link in the footer copyright row (professional placement)
  function injectLoginButton() {
    const ftBottomSpan = document.querySelector('.ft-bottom span');
    if (!ftBottomSpan) return;

    const sep = document.createTextNode('  ·  ');
    const loginLink = document.createElement('a');
    loginLink.id = 'cms-admin-login-btn';
    loginLink.href = '#';
    loginLink.textContent = 'Admin Portal';
    loginLink.style.cssText = [
      'color: var(--mist-dim, #6b7b6b)',
      'font-size: inherit',
      'text-decoration: none',
      'transition: color 0.2s',
      'cursor: pointer'
    ].join(';');
    loginLink.addEventListener('mouseenter', () => { loginLink.style.color = '#14c834'; });
    loginLink.addEventListener('mouseleave', () => { loginLink.style.color = 'var(--mist-dim, #6b7b6b)'; });
    loginLink.addEventListener('click', (e) => { e.preventDefault(); showLoginModal(); });

    ftBottomSpan.appendChild(sep);
    ftBottomSpan.appendChild(loginLink);
  }

  // Global Escape key handler — closes modals, popovers and deactivates edit mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.cms-modal-overlay').forEach(m => m.remove());
      document.querySelectorAll('.cms-popover').forEach(p => p.remove());
      if (state.editMode && state.activeSection) {
        deactivateSectionEditing();
      }
    }
  });

  // Render Admin credentials modal
  function showLoginModal() {
    const overlay = document.createElement('div');
    overlay.className = 'cms-modal-overlay active';
    overlay.innerHTML = `
      <div class="cms-modal-content">
        <button class="cms-modal-close">&times;</button>
        <h3 class="cms-modal-title">Admin Login</h3>
        <div class="cms-form-error" id="cms-login-error"></div>
        <form id="cms-login-form">
          <div class="cms-form-group">
            <label class="cms-form-label">Username</label>
            <input type="text" class="cms-form-input" id="cms-username" required autocomplete="username">
          </div>
          <div class="cms-form-group">
            <label class="cms-form-label">Password</label>
            <input type="password" class="cms-form-input" id="cms-password" required autocomplete="current-password">
          </div>
          <button type="submit" class="cms-btn cms-btn-pri">Log In</button>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    // Form interactions
    const closeBtn = overlay.querySelector('.cms-modal-close');
    closeBtn.addEventListener('click', () => overlay.remove());

    const form = overlay.querySelector('#cms-login-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = overlay.querySelector('#cms-username').value;
      const password = overlay.querySelector('#cms-password').value;
      const errorDiv = overlay.querySelector('#cms-login-error');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success) {
          overlay.remove();
          location.reload(); // Reload in edit mode
        } else {
          errorDiv.innerText = data.error || 'Login failed';
          errorDiv.style.display = 'block';
        }
      } catch (err) {
        errorDiv.innerText = 'Server error connection. Please try again.';
        errorDiv.style.display = 'block';
      }
    });
  }

  // Turn edit mode on
  function enterEditMode() {
    state.editMode = true;
    document.body.classList.add('cms-edit-mode');

    // Restore raw editable values in the DOM for editing
    applyContentMap(getActiveContentMap());

    // Add Section hover overlay buttons to sections, headers, and footers
    document.querySelectorAll('.cms-section-container').forEach(section => {
      const editBtn = document.createElement('button');
      editBtn.className = 'cms-section-overlay-btn';
      editBtn.innerHTML = '✏️ Edit Section';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activateSectionEditing(section);
      });
      section.appendChild(editBtn);
    });

    // Capture baseline layout state in History
    pushHistoryState();
  }

  // Set selected section as active editor container
  function activateSectionEditing(section) {
    if (state.previewMode) return;
    if (state.activeSection === section) return;

    deactivateSectionEditing();

    state.activeSection = section;
    section.classList.add('cms-active-edit');
    document.body.classList.add('cms-section-focus-mode');

    // Make elements in active section inline editable
    enableInlineEditing(section);
  }

  // Exit selected active edit container
  function deactivateSectionEditing() {
    if (!state.activeSection) return;

    // Remove contenteditable states
    state.activeSection.querySelectorAll('[data-cms-editable]').forEach(el => {
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-cms-editable');
      el.removeAttribute('data-cms-type');
    });

    // Remove repeatable controls
    state.activeSection.querySelectorAll('.cms-card-tools').forEach(tool => tool.remove());

    // Remove background image edit badges
    state.activeSection.querySelectorAll('.cms-bg-image-badge').forEach(badge => badge.remove());

    state.activeSection.classList.remove('cms-active-edit');
    state.activeSection = null;
    document.body.classList.remove('cms-section-focus-mode');
  }

  // Traverse DOM and assign edit triggers
  function enableInlineEditing(section) {
    // 1. Text elements: Walk DOM to find all visible text nodes dynamically
    const walk = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, null, false);
    let node;
    const editableElements = [];
    
    while (node = walk.nextNode()) {
      const text = node.textContent.trim();
      if (text.length > 0) {
        let parentEl = node.parentElement;
        if (!parentEl || parentEl.tagName === 'SCRIPT' || parentEl.tagName === 'STYLE' || isCmsElement(parentEl)) {
          continue;
        }

        let highest = parentEl;
        let current = parentEl;

        while (current && current !== section) {
          const tag = current.tagName;
          const parent = current.parentElement;
          if (parent) {
            const pTag = parent.tagName;
            if (parent.hasAttribute('data-count') || pTag === 'A' || parent.classList.contains('chip') || parent.classList.contains('cn') || parent === section) {
              break;
            }
          }

          if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'B', 'STRONG', 'SPAN', 'TD', 'TH', 'DIV'].includes(tag)) {
            if (tag === 'DIV') {
              const hasBlockChildren = Array.from(current.children).some(child => 
                ['DIV', 'SECTION', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI'].includes(child.tagName)
              );
              if (hasBlockChildren) {
                break;
              }
            }
            highest = current;
          } else {
            break;
          }
          current = current.parentElement;
        }

        if (highest && !isCmsElement(highest) && !editableElements.includes(highest)) {
          editableElements.push(highest);
        }
      }
    }

    editableElements.forEach(el => {
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('data-cms-editable', 'true');
      el.setAttribute('data-cms-type', 'text');

      // Bind input trigger for history updates
      el.addEventListener('blur', () => {
        trackDOMEdits(el, section, 'text', el.innerHTML);
      });
    });

    // 2. Image elements
    section.querySelectorAll('img, [style*="background-image"]').forEach(el => {
      if (isCmsElement(el)) return;
      el.setAttribute('data-cms-editable', 'true');
      el.setAttribute('data-cms-type', 'image');
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showImageUploadModal(el, section);
      });
    });

    // 3. Button details configuration (intercepting links)
    section.querySelectorAll('a').forEach(el => {
      if (isCmsElement(el)) return;
      if (el.closest('.cms-card-tools') || el.closest('.cms-toolbar')) return;
      
      // Stop page navigation during edit clicks
      el.addEventListener('click', (e) => {
        e.preventDefault();
      });

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showButtonConfigPopover(el, section, e.clientX, e.clientY);
      });
    });

    // 4. Repeatable controls
    REPEATABLE_SELECTORS.forEach(selector => {
      section.querySelectorAll(selector).forEach(card => {
        if (card.querySelector('.cms-card-tools')) return;
        injectCardControls(card, section);
      });
    });

    // 5. Hero & Background Images Edit Badge
    section.querySelectorAll('.hero-bg img, .phero img, .svc-hero-img, .hero-grid img, [class*="-bg"] img').forEach(bgImg => {
      if (isCmsElement(bgImg)) return;

      const badgeId = 'cms-bg-edit-' + getElementKey(bgImg, section).replace(/:/g, '-');
      if (document.getElementById(badgeId)) return;

      const editBadge = document.createElement('div');
      editBadge.id = badgeId;
      editBadge.className = 'cms-bg-image-badge';
      editBadge.innerHTML = '📷 Change Background Image';
      editBadge.style.cssText = [
        'position: absolute',
        'top: 15px',
        'right: 15px',
        'background: rgba(0, 0, 0, 0.8)',
        'color: #fff',
        'padding: 8px 14px',
        'border-radius: 20px',
        'font-size: 11.5px',
        'font-family: sans-serif',
        'cursor: pointer',
        'z-index: 1000',
        'border: 1px solid rgba(255, 255, 255, 0.25)',
        'box-shadow: 0 4px 12px rgba(0,0,0,0.4)',
        'transition: background 0.2s, transform 0.1s'
      ].join(';');

      editBadge.addEventListener('mouseenter', () => { editBadge.style.background = '#14c834'; });
      editBadge.addEventListener('mouseleave', () => { editBadge.style.background = 'rgba(0, 0, 0, 0.8)'; });
      editBadge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showImageUploadModal(bgImg, section);
      });

      section.appendChild(editBadge);
    });
  }

  // Inject Duplicate/Delete card float badges
  function injectCardControls(card, section) {
    card.setAttribute('data-cms-repeatable', 'true');
    const tools = document.createElement('div');
    tools.className = 'cms-card-tools';
    tools.innerHTML = `
      <button class="cms-card-tool-btn cms-dup" title="Duplicate">➕</button>
      <button class="cms-card-tool-btn cms-delete" title="Delete">🗑️</button>
      <button class="cms-card-tool-btn cms-move-up" title="Move Up/Left">⬅️</button>
      <button class="cms-card-tool-btn cms-move-down" title="Move Down/Right">➡️</button>
    `;

    // Intercept controls
    tools.querySelector('.cms-dup').addEventListener('click', (e) => {
      e.stopPropagation();
      duplicateCard(card, section);
    });
    tools.querySelector('.cms-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCard(card, section);
    });
    tools.querySelector('.cms-move-up').addEventListener('click', (e) => {
      e.stopPropagation();
      moveCardSibling(card, true, section);
    });
    tools.querySelector('.cms-move-down').addEventListener('click', (e) => {
      e.stopPropagation();
      moveCardSibling(card, false, section);
    });

    card.appendChild(tools);
  }

  // Repeatable action: duplicate card DOM node
  function duplicateCard(card, section) {
    const clone = card.cloneNode(true);
    // Remove injected controls and copy layout content in clone
    clone.querySelector('.cms-card-tools')?.remove();
    card.parentNode.insertBefore(clone, card.nextSibling);

    // Re-bind inline edit hooks to section
    deactivateSectionEditing();
    activateSectionEditing(section);

    markAsDirty();
    pushHistoryState();
  }

  // Repeatable action: delete card DOM node
  function deleteCard(card, section) {
    const parent = card.parentNode;
    // Check if at least 1 remains
    const siblingCount = Array.from(parent.children).filter(child => child.tagName === card.tagName).length;
    if (siblingCount <= 1) {
      alert("Cannot delete the last item in a grid. Hide the section instead.");
      return;
    }

    card.remove();
    deactivateSectionEditing();
    activateSectionEditing(section);

    markAsDirty();
    pushHistoryState();
  }

  // Repeatable action: swap card order siblings
  function moveCardSibling(card, moveUp, section) {
    const parent = card.parentNode;
    if (moveUp) {
      const prev = card.previousElementSibling;
      if (prev && prev.tagName === card.tagName) {
        parent.insertBefore(card, prev);
      }
    } else {
      const next = card.nextElementSibling;
      if (next && next.tagName === card.tagName) {
        parent.insertBefore(next, card);
      }
    }

    deactivateSectionEditing();
    activateSectionEditing(section);

    markAsDirty();
    pushHistoryState();
  }

  // Track DOM content updates and assign changes
  function trackDOMEdits(el, section, type, value) {
    if (el.hasAttribute('data-count')) {
      const cleanNum = value.replace(/[^0-9]/g, '');
      el.setAttribute('data-count', cleanNum);
    }
    const key = getElementKey(el, section);
    state.draftChanges[key] = { value, type };
    markAsDirty();
    pushHistoryState();
  }

  // Render Image editor modal
  function showImageUploadModal(imgEl, section) {
    const overlay = document.createElement('div');
    overlay.className = 'cms-modal-overlay active';
    overlay.innerHTML = `
      <div class="cms-modal-content">
        <button class="cms-modal-close">&times;</button>
        <h3 class="cms-modal-title">Replace Image</h3>
        <div class="cms-crop-container">
          <img class="cms-crop-preview" id="cms-img-preview" src="${imgEl.tagName === 'IMG' ? imgEl.src : imgEl.style.backgroundImage.slice(5, -2)}" alt="Preview">
        </div>
        <form id="cms-image-form">
          <div class="cms-form-group">
            <label class="cms-form-label">Select File</label>
            <input type="file" class="cms-form-input" id="cms-file-input" accept="image/*" required>
          </div>
          <div style="display:flex;gap:12px;">
            <button type="submit" class="cms-btn cms-btn-pri" style="flex:1;">Upload & Save</button>
            <button type="button" class="cms-btn cms-btn-sec cms-cancel" style="flex:1;">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('.cms-modal-close');
    const cancelBtn = overlay.querySelector('.cms-cancel');
    const fileInput = overlay.querySelector('#cms-file-input');
    const previewImg = overlay.querySelector('#cms-img-preview');
    const form = overlay.querySelector('#cms-image-form');

    const closeModal = () => overlay.remove();
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    // Handle image file selection preview
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          previewImg.src = e.target.result;
        };
        reader.readAsDataURL(file);
      }
    });

    // Submit and Upload
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = fileInput.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('image', file);

      try {
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerText = 'Uploading...';

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        
        if (data.url) {
          // Update DOM node
          if (imgEl.tagName === 'IMG') {
            imgEl.src = data.url;
          } else {
            imgEl.style.backgroundImage = `url('${data.url}')`;
          }
          trackDOMEdits(imgEl, section, 'image', data.url);
          closeModal();
        } else {
          alert('Upload failed: ' + (data.error || 'unknown error'));
          submitBtn.disabled = false;
          submitBtn.innerText = 'Upload & Save';
        }
      } catch (err) {
        console.error('Image upload failed:', err);
        alert('Server connection failed. Try again.');
      }
    });
  }

  // Render popover parameters details for buttons
  function showButtonConfigPopover(btnEl, section, x, y) {
    // Remove existing popovers first
    document.querySelectorAll('.cms-popover').forEach(pop => pop.remove());

    const popover = document.createElement('div');
    popover.className = 'cms-popover';
    
    // Get existing button data
    const isHidden = btnEl.classList.contains('cms-element-hidden');
    const buttonUrl = btnEl.getAttribute('href') || '';
    const isNewTab = btnEl.getAttribute('target') === '_blank';
    const buttonText = btnEl.innerText;

    popover.innerHTML = `
      <div class="cms-form-group">
        <label class="cms-form-label">Link URL</label>
        <input type="text" class="cms-form-input" id="cms-btn-url" value="${buttonUrl}">
      </div>
      <div class="cms-form-group">
        <label class="cms-form-checkbox-label">
          <input type="checkbox" id="cms-btn-target" ${isNewTab ? 'checked' : ''}> Open in new tab
        </label>
      </div>
      <div class="cms-form-group">
        <label class="cms-form-checkbox-label">
          <input type="checkbox" id="cms-btn-visible" ${!isHidden ? 'checked' : ''}> Button Visibility
        </label>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="cms-btn cms-btn-pri cms-save-btn" style="padding:6px 12px;font-size:12px;">Save Link</button>
        <button class="cms-btn cms-btn-sec cms-close-btn" style="padding:6px 12px;font-size:12px;">Cancel</button>
      </div>
    `;

    // Position popover intelligently relative to viewport bounds
    popover.style.top = `${y + window.scrollY + 10}px`;
    popover.style.left = `${x + window.scrollX - 100}px`;
    document.body.appendChild(popover);

    // Popover events
    popover.querySelector('.cms-close-btn').addEventListener('click', () => popover.remove());
    popover.querySelector('.cms-save-btn').addEventListener('click', () => {
      const url = popover.querySelector('#cms-btn-url').value;
      const target = popover.querySelector('#cms-btn-target').checked ? '_blank' : '';
      const visible = popover.querySelector('#cms-btn-visible').checked;

      // Update DOM element directly
      btnEl.setAttribute('href', url);
      if (target) {
        btnEl.setAttribute('target', target);
      } else {
        btnEl.removeAttribute('target');
      }

      if (!visible) {
        btnEl.classList.add('cms-element-hidden');
      } else {
        btnEl.classList.remove('cms-element-hidden');
      }

      const key = getElementKey(btnEl, section);
      // Preserve null text for structural link containers
      const hasStructuralChildren = btnEl.querySelector('img, div, svg, h1, h2, h3, h4, h5, h6, p');
      const serializedText = hasStructuralChildren ? null : buttonText;
      state.draftChanges[key] = {
        value: JSON.stringify({ text: serializedText, url, target, visible }),
        type: 'button'
      };

      markAsDirty();
      pushHistoryState();
      popover.remove();
    });

    // Close on click outside popover
    setTimeout(() => {
      const clickOutside = (e) => {
        if (!popover.contains(e.target) && e.target !== btnEl) {
          popover.remove();
          document.removeEventListener('click', clickOutside);
        }
      };
      document.addEventListener('click', clickOutside);
    }, 10);
  }

  // Inject Floating Admin CMS Dashboard Toolbar at the bottom
  function injectAdminInterface() {
    const toolbar = document.createElement('div');
    toolbar.className = 'cms-toolbar';
    toolbar.innerHTML = `
      <div class="cms-toolbar-status cms-status-saved">
        <span class="cms-dot"></span> <span id="cms-status-text">Draft Saved</span>
      </div>
      <button type="button" class="cms-toolbar-btn cms-primary" id="cms-publish-btn">Publish</button>
      <button type="button" class="cms-toolbar-btn" id="cms-save-btn">Save Draft</button>
      <button type="button" class="cms-toolbar-btn" id="cms-preview-btn">Preview</button>
      <button type="button" class="cms-toolbar-btn" id="cms-undo-btn" disabled>Undo</button>
      <button type="button" class="cms-toolbar-btn" id="cms-redo-btn" disabled>Redo</button>
      <button type="button" class="cms-toolbar-btn cms-danger" id="cms-cancel-btn">Cancel Changes</button>
      <button type="button" class="cms-toolbar-btn" id="cms-logout-btn" style="margin-left: 20px;">Logout</button>
    `;

    document.body.appendChild(toolbar);

    // Toolbar button interactions
    toolbar.querySelector('#cms-publish-btn').addEventListener('click', publishChanges);
    toolbar.querySelector('#cms-save-btn').addEventListener('click', saveDraftChanges);
    toolbar.querySelector('#cms-preview-btn').addEventListener('click', togglePreviewMode);
    toolbar.querySelector('#cms-undo-btn').addEventListener('click', undoHistory);
    toolbar.querySelector('#cms-redo-btn').addEventListener('click', redoHistory);
    toolbar.querySelector('#cms-cancel-btn').addEventListener('click', cancelChanges);
    toolbar.querySelector('#cms-logout-btn').addEventListener('click', logoutAdmin);
  }

  // Mark status text
  function markAsDirty() {
    state.isDirty = true;
    const statusDiv = document.querySelector('.cms-toolbar-status');
    const statusText = document.getElementById('cms-status-text');
    if (statusDiv && statusText) {
      statusDiv.className = 'cms-toolbar-status cms-status-dirty';
      statusText.innerText = 'Unsaved Changes';
    }

    // Reset Autosave timer
    if (state.autoSaveTimer) clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(autoSaveDraft, 5000); // Trigger background autosave after 5s of inactivity
  }

  function markAsSaved() {
    state.isDirty = false;
    const statusDiv = document.querySelector('.cms-toolbar-status');
    const statusText = document.getElementById('cms-status-text');
    if (statusDiv && statusText) {
      statusDiv.className = 'cms-toolbar-status cms-status-saved';
      statusText.innerText = 'Draft Saved';
    }
  }

  // History Stack Manager (Undo/Redo)
  function pushHistoryState() {
    // Clear elements forward of index (re-written timeline)
    state.history = state.history.slice(0, state.historyIndex + 1);

    // Serialize current state of all editable fields and counts
    const historyItem = serializeDOMState();
    state.history.push(historyItem);
    state.historyIndex = state.history.length - 1;

    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('cms-undo-btn');
    const redoBtn = document.getElementById('cms-redo-btn');
    if (undoBtn) undoBtn.disabled = state.historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = state.historyIndex >= state.history.length - 1;
  }

  // Get complete current mapping of DOM changes
  function serializeDOMState() {
    const layout = {};

    document.querySelectorAll('.cms-section-container').forEach(section => {
      const sectionId = section.getAttribute('data-cms-section');
      const route = section.closest('.view')?.getAttribute('data-route') || 'global';

      // 1. Repeatable counts
      REPEATABLE_SELECTORS.forEach(selector => {
        section.querySelectorAll(selector).forEach(child => {
          const container = child.parentNode;
          const containerKey = getContainerKey(container, section);
          const childTagName = child.tagName;
          const totalChildren = Array.from(container.children).filter(el => el.tagName === childTagName).length;
          layout[`${containerKey}:count`] = { value: totalChildren.toString(), type: 'count' };
        });
      });

      // 2. Text editing (Walk dynamically to get all text elements)
      const walk = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, null, false);
      let node;
      const textElements = [];
      while (node = walk.nextNode()) {
        const text = node.textContent.trim();
        if (text.length > 0) {
          const parentEl = node.parentElement;
          if (parentEl && 
              parentEl.tagName !== 'SCRIPT' && 
              parentEl.tagName !== 'STYLE' && 
              !isCmsElement(parentEl) &&
              !textElements.includes(parentEl)) {
            
            textElements.push(parentEl);
          }
        }
      }

      textElements.forEach(el => {
        const key = getElementKey(el, section);
        layout[key] = { value: el.innerHTML, type: 'text' };
      });

      // 3. Image URLs
      section.querySelectorAll('img, [style*="background-image"]').forEach(el => {
        if (isCmsElement(el)) return;
        const key = getElementKey(el, section);
        const url = el.tagName === 'IMG' ? el.getAttribute('src') : el.style.backgroundImage.slice(5, -2);
        layout[key] = { value: url, type: 'image' };
      });

      // 4. Button JSON configuration details
      section.querySelectorAll('a').forEach(el => {
        if (isCmsElement(el)) return;
        const isHidden = el.classList.contains('cms-element-hidden');
        const url = el.getAttribute('href') || '';
        const target = el.getAttribute('target') || '';
        // For structural anchors (containing img, div, svg, headings, paragraphs),
        // store null for text so we never overwrite their layout on reload.
        const hasStructuralChildren = el.querySelector('img, div, svg, h1, h2, h3, h4, h5, h6, p');
        const text = hasStructuralChildren ? null : el.innerText;
        const key = getElementKey(el, section);
        layout[key] = {
          value: JSON.stringify({ text, url, target, visible: !isHidden }),
          type: 'button'
        };
      });
    });

    return layout;
  }

  // Restore DOM layout from serialized history item
  function restoreDOMState(historyItem) {
    applyContentMap(historyItem);

    // Map localized draftChanges keys back
    state.draftChanges = {};
    for (const [key, item] of Object.entries(historyItem)) {
      state.draftChanges[key] = item;
    }
  }

  function undoHistory() {
    if (state.historyIndex > 0) {
      deactivateSectionEditing();
      state.historyIndex--;
      restoreDOMState(state.history[state.historyIndex]);
      updateUndoRedoButtons();
      markAsDirty();
    }
  }

  function redoHistory() {
    if (state.historyIndex < state.history.length - 1) {
      deactivateSectionEditing();
      state.historyIndex++;
      restoreDOMState(state.history[state.historyIndex]);
      updateUndoRedoButtons();
      markAsDirty();
    }
  }

  // Gather current changes and trigger Autosave REST API
  async function autoSaveDraft() {
    if (!state.isDirty) return;

    // Serialize current state values relative to starting content baseline
    const changesMap = {};
    const currentState = serializeDOMState();

    for (const [key, item] of Object.entries(currentState)) {
      const originalVal = state.content[key];
      // Save item if it is new or has changed values
      if (!originalVal || originalVal.value !== item.value) {
        changesMap[key] = item;
      }
    }

    try {
      const res = await fetch('/api/content/save-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: changesMap })
      });
      const data = await res.json();
      if (data.success) {
        markAsSaved();
      }
    } catch (e) {
      console.error('Autosave background sync failed:', e);
    }
  }

  // Trigger Save Draft manually
  async function saveDraftChanges() {
    const statusText = document.getElementById('cms-status-text');
    if (statusText) statusText.innerText = 'Saving...';
    
    await autoSaveDraft();
    markAsSaved();
  }

  // Trigger Publish REST API
  async function publishChanges(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    deactivateSectionEditing();
    
    const saveBtn = document.getElementById('cms-save-btn');
    const publishBtn = document.getElementById('cms-publish-btn');
    publishBtn.disabled = true;
    publishBtn.innerText = 'Publishing...';

    // 1. Force save draft first
    await autoSaveDraft();

    // 2. Publish draft to live
    try {
      const res = await fetch('/api/content/publish', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('Website published live successfully!');
        location.reload();
      } else {
        alert('Publish failed: ' + (data.error || 'Server error.'));
      }
    } catch (err) {
      console.error('Publish failed:', err);
      alert('Connection lost. Publish could not complete.');
    } finally {
      publishBtn.disabled = false;
      publishBtn.innerText = 'Publish';
    }
  }

  // Discard draft changes and reload
  async function cancelChanges(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (state.autoSaveTimer) {
      clearTimeout(state.autoSaveTimer);
      state.autoSaveTimer = null;
    }
    
    if (confirm('Are you sure you want to cancel all changes made in this editing session? This will restore the last published version.')) {
      try {
        state.draftChanges = {};
        state.isDirty = false;
        
        const res = await fetch(`/api/content/discard-draft?t=${Date.now()}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          location.reload();
        } else {
          alert('Discard changes failed: ' + (data.error || 'unknown error'));
        }
      } catch (err) {
        console.error('Discard draft failed:', err);
        alert('Server connection failed. Try again.');
      }
    }
  }

  // Preview website (toggles outline styles and layouts on/off)
  function togglePreviewMode() {
    state.previewMode = !state.previewMode;
    const previewBtn = document.getElementById('cms-preview-btn');

    if (state.previewMode) {
      deactivateSectionEditing();
      document.body.classList.remove('cms-edit-mode');
      
      // Hide all hidden elements fully (matching normal user state)
      document.querySelectorAll('.cms-element-hidden').forEach(el => {
        el.style.display = 'none';
      });

      previewBtn.innerText = 'Edit Mode';
      previewBtn.classList.add('cms-primary');
    } else {
      document.body.classList.add('cms-edit-mode');
      
      // Restore hidden elements opacity back
      document.querySelectorAll('.cms-element-hidden').forEach(el => {
        el.style.display = '';
      });

      previewBtn.innerText = 'Preview';
      previewBtn.classList.remove('cms-primary');
    }

    // Re-apply content map to toggle between view layout (animations/zeros) and edit layout (raw values)
    applyContentMap(getActiveContentMap());
  }

  // Sign out admin session
  async function logoutAdmin() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      location.reload();
    } catch (e) {
      console.error('Logout failed:', e);
      location.reload();
    }
  }

  // Formatting Toolbar for text selection in contenteditable elements
  function createFormattingToolbar() {
    let toolbar = document.getElementById('cms-formatting-toolbar');
    if (toolbar) return toolbar;
    
    toolbar = document.createElement('div');
    toolbar.id = 'cms-formatting-toolbar';
    toolbar.className = 'cms-formatting-toolbar';
    toolbar.innerHTML = `
      <button class="cms-format-btn" data-cmd="bold" title="Bold"><b>B</b></button>
      <button class="cms-format-btn" data-cmd="italic" title="Italic"><i>I</i></button>
      <button class="cms-format-btn" data-cmd="foreColor" data-value="#f0a30a" title="Yellow/Gold" style="color: #f0a30a;">●</button>
      <button class="cms-format-btn" data-cmd="foreColor" data-value="var(--grn)" title="Green" style="color: #14c834;">●</button>
      <button class="cms-format-btn" data-cmd="foreColor" data-value="#ffffff" title="White" style="color: #ffffff; text-shadow: 0 0 2px #000;">●</button>
      <button class="cms-format-btn" data-cmd="removeFormat" title="Clear Formatting">⌫</button>
    `;
    document.body.appendChild(toolbar);
    
    toolbar.querySelectorAll('.cms-format-btn').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const cmd = btn.getAttribute('data-cmd');
        const val = btn.getAttribute('data-value') || null;
        
        if (cmd === 'foreColor') {
          document.execCommand('styleWithCSS', false, true);
          document.execCommand(cmd, false, val);
        } else {
          document.execCommand(cmd, false, val);
        }
        
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          let container = selection.getRangeAt(0).commonAncestorContainer;
          if (container.nodeType === Node.TEXT_NODE) {
            container = container.parentElement;
          }
          const editableEl = container.closest('[data-cms-editable]');
          if (editableEl) {
            const section = editableEl.closest('.cms-section-container');
            if (section) {
              trackDOMEdits(editableEl, section, 'text', editableEl.innerHTML);
            }
          }
        }
      });
    });
    
    return toolbar;
  }
  
  function handleTextSelection() {
    if (!state.editMode || state.previewMode) {
      hideFormattingToolbar();
      return;
    }
    
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.toString().trim() === '') {
      hideFormattingToolbar();
      return;
    }
    
    let container = selection.getRangeAt(0).commonAncestorContainer;
    if (container.nodeType === Node.TEXT_NODE) {
      container = container.parentElement;
    }
    
    const editableEl = container.closest('[data-cms-editable="true"]');
    if (!editableEl) {
      hideFormattingToolbar();
      return;
    }
    
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const toolbar = createFormattingToolbar();
    
    toolbar.style.display = 'flex';
    toolbar.style.top = `${rect.top + window.scrollY - 40}px`;
    toolbar.style.left = `${rect.left + window.scrollX + (rect.width / 2) - 80}px`;
  }
  
  function hideFormattingToolbar() {
    const toolbar = document.getElementById('cms-formatting-toolbar');
    if (toolbar) {
      toolbar.style.display = 'none';
    }
  }
  
  document.addEventListener('selectionchange', handleTextSelection);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.querySelector('.cms-modal-overlay');
      if (modal) modal.remove();

      const popover = document.querySelector('.cms-popover');
      if (popover) popover.remove();

      const chatWindow = document.getElementById('mazaohub-chat-window');
      if (chatWindow) chatWindow.style.display = 'none';

      if (state.activeSection) {
        deactivateSectionEditing();
      }
    }
  });
})();
