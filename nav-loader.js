/* nav-loader.js */

const MOBILE_BREAKPOINT = 768;

document.addEventListener('DOMContentLoaded', () => {
  loadSharedNav();
});

/**
 * Fetches and injects the shared navigation bar.
 */
async function loadSharedNav() {
  const placeholder = document.getElementById('nav-placeholder');
  if (!placeholder) return;

  try {
    const response = await fetch('nav.html');
    if (!response.ok) throw new Error(`Navigation request failed: ${response.status}`);

    placeholder.innerHTML = await response.text();
    highlightActiveLink();
    initializeNavLogic();
  } catch (error) {
    console.error('Error loading shared navigation:', error);
    placeholder.innerHTML = '<p style="padding:12px;color:#9ca3af;">Navigation failed to load.</p>';
  }
}

/**
 * Returns the normalized current page filename.
 */
function getCurrentPage() {
  const path = window.location.pathname;
  const lastSegment = path.split('/').pop();
  return lastSegment && lastSegment.length > 0 ? lastSegment : 'index.html';
}

/**
 * Highlights the nav link that matches the current page.
 */
function highlightActiveLink() {
  const currentPath = getCurrentPage();
  const navLinks = document.querySelectorAll('.nav-menu a[href]');

  navLinks.forEach((link) => {
    const href = (link.getAttribute('href') || '').split('#')[0].split('?')[0];
    if (href === currentPath) {
      link.classList.add('active');
      const parentDropdown = link.closest('.nav-item');
      if (parentDropdown) parentDropdown.classList.add('active-parent');
    }
  });
}

/**
 * Closes all dropdowns and mobile nav state.
 */
function closeAllMenus(navItems, navMenu, navToggle) {
  navItems.forEach((item) => {
    item.classList.remove('active');
    const trigger = item.querySelector('.dropdown-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });

  if (navMenu) navMenu.classList.remove('active');
  if (navToggle) {
    navToggle.classList.remove('active');
    navToggle.setAttribute('aria-expanded', 'false');
  }
}

/**
 * Initializes mobile toggle, dropdown, and keyboard/outside-click handling.
 */
function initializeNavLogic() {
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('.nav-menu');
  const navItems = Array.from(document.querySelectorAll('.nav-item'));
  const dropdownTriggers = Array.from(document.querySelectorAll('.dropdown-trigger'));

  if (!navMenu || navItems.length === 0) return;

  // Prevent duplicate listeners if this function is called again.
  if (navMenu.dataset.initialized === 'true') return;
  navMenu.dataset.initialized = 'true';

  if (navToggle) {
    navToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const isActive = navMenu.classList.contains('active');

      navMenu.classList.toggle('active', !isActive);
      navToggle.classList.toggle('active', !isActive);
      navToggle.setAttribute('aria-expanded', String(!isActive));
    });
  }

  navItems.forEach((item) => {
    let closeTimer;

    item.addEventListener('mouseenter', () => {
      if (window.innerWidth > MOBILE_BREAKPOINT) {
        clearTimeout(closeTimer);
        item.classList.add('active');
        const trigger = item.querySelector('.dropdown-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
      }
    });

    item.addEventListener('mouseleave', () => {
      if (window.innerWidth > MOBILE_BREAKPOINT) {
        closeTimer = setTimeout(() => {
          item.classList.remove('active');
          const trigger = item.querySelector('.dropdown-trigger');
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }, 300);
      }
    });
  });

  dropdownTriggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      if (window.innerWidth > MOBILE_BREAKPOINT) return;

      event.preventDefault();
      event.stopPropagation();

      const parentItem = trigger.closest('.nav-item');
      if (!parentItem) return;

      const isActive = parentItem.classList.contains('active');
      navItems.forEach((item) => {
        if (item === parentItem) return;
        item.classList.remove('active');
        const otherTrigger = item.querySelector('.dropdown-trigger');
        if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
      });

      parentItem.classList.toggle('active', !isActive);
      trigger.setAttribute('aria-expanded', String(!isActive));
    });
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.league-nav')) {
      closeAllMenus(navItems, navMenu, navToggle);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllMenus(navItems, navMenu, navToggle);
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth > MOBILE_BREAKPOINT) {
        closeAllMenus(navItems, navMenu, navToggle);
      }
    }, 250);
  });
}
