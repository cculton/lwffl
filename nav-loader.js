/* nav-loader.js */

document.addEventListener('DOMContentLoaded', function() {
  loadSharedNav();
});

/**
 * Fetches and injects the shared navigation bar
 */
async function loadSharedNav() {
  const placeholder = document.getElementById('nav-placeholder');
  if (!placeholder) return;

  try {
    const response = await fetch('nav.html');
    if (response.ok) {
      const navHtml = await response.text();
      placeholder.innerHTML = navHtml;
      
      // Initialize nav features after injection
      highlightActiveLink();
      initializeNavLogic();
    }
  } catch (err) {
    console.error("Error loading shared navigation:", err);
  }
}

/**
 * Highlights the link corresponding to the current page
 */
function highlightActiveLink() {
  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  const navLinks = document.querySelectorAll('.nav-menu a');
  
  navLinks.forEach(link => {
    // Check if the href matches the current path
    if (link.getAttribute('href') === currentPath) {
      link.classList.add('active');
      
      // Optional: Also highlight the parent dropdown button if it exists
      const parentDropdown = link.closest('.nav-item');
      if (parentDropdown) {
        parentDropdown.classList.add('active-parent'); // You can style this class in CSS if you want
      }
    }
  });
}

/**
 * Initializes all navigation logic (Mobile toggle, dropdowns, hover effects)
 */
function initializeNavLogic() {
  var navToggle = document.querySelector('.nav-toggle');
  var navMenu = document.querySelector('.nav-menu');
  var navItems = document.querySelectorAll('.nav-item');
  var dropdownTriggers = document.querySelectorAll('.dropdown-trigger');
  
  // Mobile menu toggle
  if (navToggle && navMenu) {
    navToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      var isActive = navMenu.classList.contains('active');
      
      if (isActive) {
        navMenu.classList.remove('active');
        navToggle.classList.remove('active');
        navToggle.setAttribute('aria-expanded', 'false');
      } else {
        navMenu.classList.add('active');
        navToggle.classList.add('active');
        navToggle.setAttribute('aria-expanded', 'true');
      }
    });
  }

  // Desktop hover with Delay Fix
  navItems.forEach(function(item) {
    var closeTimer;

    item.addEventListener('mouseenter', function() {
      if (window.innerWidth > 768) {
        clearTimeout(closeTimer);
        item.classList.add('active');
        var trigger = item.querySelector('.dropdown-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
      }
    });
    
    item.addEventListener('mouseleave', function() {
      if (window.innerWidth > 768) {
        // 300ms delay to bridge the gap between button and menu
        closeTimer = setTimeout(function() {
          item.classList.remove('active');
          var trigger = item.querySelector('.dropdown-trigger');
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }, 300); 
      }
    });
  });

  // Click/tap for all devices (Mobile handling)
  dropdownTriggers.forEach(function(trigger) {
    trigger.addEventListener('click', function(e) {
      // Only prevent default on mobile where click is the primary interaction
      if (window.innerWidth <= 768) {
        e.preventDefault();
        e.stopPropagation();
        
        var parentItem = trigger.closest('.nav-item');
        var isActive = parentItem.classList.contains('active');
        
        // Close others on mobile
        navItems.forEach(function(item) {
          if (item !== parentItem) {
            item.classList.remove('active');
            var otherTrigger = item.querySelector('.dropdown-trigger');
            if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
          }
        });
        
        // Toggle this one
        if (isActive) {
          parentItem.classList.remove('active');
          trigger.setAttribute('aria-expanded', 'false');
        } else {
          parentItem.classList.add('active');
          trigger.setAttribute('aria-expanded', 'true');
        }
      }
    });
  });

  // Close on outside click
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.league-nav')) {
      navItems.forEach(function(item) {
        item.classList.remove('active');
        var trigger = item.querySelector('.dropdown-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      });
      
      if (navMenu) navMenu.classList.remove('active');
      if (navToggle) {
        navToggle.classList.remove('active');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    }
  });

  // Close on escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      navItems.forEach(function(item) {
        item.classList.remove('active');
        var trigger = item.querySelector('.dropdown-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      });
      
      if (navMenu) navMenu.classList.remove('active');
      if (navToggle) {
        navToggle.classList.remove('active');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    }
  });

  // Handle resize (Reset menus when switching mobile/desktop)
  var resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      if (window.innerWidth > 768) {
        if (navMenu) navMenu.classList.remove('active');
        if (navToggle) {
          navToggle.classList.remove('active');
          navToggle.setAttribute('aria-expanded', 'false');
        }
        navItems.forEach(function(item) {
          item.classList.remove('active');
        });
      }
    }, 250);
  });
}
