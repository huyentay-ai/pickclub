// === Lucide icons init (dark athletic theme) ===
(function () {
  function initIcons() {
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initIcons);
  } else {
    initIcons();
  }
})();

// === Count-up stats (dark athletic theme) ===
// Any element with data-countup="N" animates 0 → N on first view.
(function () {
  var els = document.querySelectorAll('[data-countup]');
  if (!els.length) return;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animate(el) {
    var target = parseInt(el.getAttribute('data-countup'), 10);
    if (isNaN(target) || reduced) { return; }
    var duration = 1200;
    var t0 = performance.now();
    function tick(t) {
      var p = Math.min(1, (t - t0) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    }
    requestAnimationFrame(tick);
    // fallback: always land on target
    setTimeout(function () { el.textContent = target; }, duration + 100);
  }

  if ('IntersectionObserver' in window) {
    var seen = new WeakSet();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !seen.has(e.target)) {
          seen.add(e.target);
          animate(e.target);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(animate);
  }
})();

// === Notification polling ===
(function pollNotifications() {
  const badge = document.getElementById('notificationBadge');
  if (!badge) return;

  function fetchNotifications() {
    fetch('/api/notifications')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const count = data.count || 0;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
      })
      .catch(() => {});
  }

  fetchNotifications();
  setInterval(fetchNotifications, 30000);
})();

// === Mobile menu toggle ===
(function () {
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  if (!hamburger || !navLinks) return;

  hamburger.addEventListener('click', () => {
    navLinks.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
      navLinks.classList.remove('show');
    }
  });
})();

// === User dropdown ===
(function () {
  const toggle = document.getElementById('userToggle');
  const menu = document.getElementById('dropdownMenu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    menu.classList.remove('show');
  });
})();

// === Tabs ===
(function () {
  const tabs = document.querySelectorAll('.tab');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById('tab-' + tab.dataset.tab);
      if (target) target.classList.add('active');
    });
  });
})();

// === Confirm dialogs ===
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-confirm]');
  if (btn) {
    const msg = btn.getAttribute('data-confirm');
    if (!confirm(msg)) {
      e.preventDefault();
    }
  }
});

// === Teammate search autocomplete ===
(function () {
  const input = document.getElementById('teammateSearch');
  const results = document.getElementById('teammateResults');
  const hiddenInput = document.getElementById('teammateId');
  const selected = document.getElementById('selectedTeammate');
  const selectedName = document.getElementById('selectedTeammateName');
  const removeBtn = document.getElementById('removeTeammate');

  if (!input || !results) return;

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (q.length < 2) { results.classList.remove('show'); return; }

    debounce = setTimeout(() => {
      fetch('/api/users/search?q=' + encodeURIComponent(q))
        .then(r => r.ok ? r.json() : [])
        .then(users => {
          if (!users.length) { results.classList.remove('show'); return; }
          results.innerHTML = users.map(u =>
            '<div class="search-result-item" data-id="' + u._id + '" data-name="' + u.fullName + '">' +
            u.fullName + ' (@' + u.username + ')' +
            '</div>'
          ).join('');
          results.classList.add('show');
        })
        .catch(() => results.classList.remove('show'));
    }, 300);
  });

  results.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (!item) return;
    if (hiddenInput) hiddenInput.value = item.dataset.id;
    if (selectedName) selectedName.textContent = item.dataset.name;
    if (selected) selected.style.display = 'inline-flex';
    input.value = '';
    results.classList.remove('show');
  });

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      if (hiddenInput) hiddenInput.value = '';
      if (selected) selected.style.display = 'none';
    });
  }

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.classList.remove('show');
    }
  });
})();

// === Custom reward toggle ===
(function () {
  const customRadio = document.getElementById('rewardCustomRadio');
  const customInput = document.getElementById('customReward');
  if (!customRadio || !customInput) return;

  document.querySelectorAll('input[name="reward"]').forEach(radio => {
    radio.addEventListener('change', () => {
      customInput.style.display = radio.value === 'custom' ? 'block' : 'none';
      if (radio.value === 'custom') customInput.focus();
    });
  });
})();

// === Counter offer form toggle ===
(function () {
  const btn = document.getElementById('showCounterForm');
  const form = document.getElementById('counterForm');
  if (!btn || !form) return;

  btn.addEventListener('click', () => {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
})();

// === Form validation ===
document.querySelectorAll('form').forEach(form => {
  form.addEventListener('submit', (e) => {
    const required = form.querySelectorAll('[required]');
    let valid = true;
    required.forEach(field => {
      if (!field.value.trim()) {
        field.style.borderColor = '#e5484d';
        valid = false;
      } else {
        field.style.borderColor = '';
      }
    });
    if (!valid) {
      e.preventDefault();
      alert('Vui lòng điền đầy đủ thông tin bắt buộc.');
    }
  });
});
