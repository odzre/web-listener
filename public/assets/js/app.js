(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  async function copyText(text) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (err) {
        copied = false;
      }
      document.body.removeChild(area);
      return copied;
    }
  }

  function togglePassword(selector, button) {
    const input = document.querySelector(selector);
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    const icon = button.querySelector('i');
    if (icon) {
      icon.className = isPassword ? 'ti ti-eye-off' : 'ti ti-eye';
    }
  }

  onReady(function () {
    const nav = document.getElementById('siteNav');
    const navToggle = document.querySelector('[data-nav-toggle]');
    const navLinks = document.querySelector('[data-nav-links]');

    function onScroll() {
      if (!nav) return;
      nav.classList.toggle('scrolled', window.scrollY > 12);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    if (navToggle && navLinks) {
      navToggle.addEventListener('click', function () {
        const open = navLinks.classList.toggle('open');
        navToggle.setAttribute('aria-expanded', String(open));
        const icon = navToggle.querySelector('i');
        if (icon) icon.className = open ? 'ti ti-x' : 'ti ti-menu-2';
      });
      navLinks.addEventListener('click', function (event) {
        if (event.target.tagName === 'A') navLinks.classList.remove('open');
      });
    }

    document.querySelectorAll('[data-password-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        const selector = button.getAttribute('data-password-toggle');
        if (selector) togglePassword(selector, button);
      });
    });

    document.querySelectorAll('[data-key-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        const input = button.closest('.key-cell')?.querySelector('input');
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        const icon = button.querySelector('i');
        if (icon) icon.className = isPassword ? 'ti ti-eye-off' : 'ti ti-eye';
      });
    });

    document.querySelectorAll('[data-copy-text], [data-copy-target], [data-copy-value]').forEach(function (button) {
      button.addEventListener('click', async function () {
        let text = button.getAttribute('data-copy-text') || '';
        const target = button.getAttribute('data-copy-target');
        const valueSelector = button.getAttribute('data-copy-value');
        if (!text && target) {
          const node = document.querySelector(target);
          text = node ? node.textContent : '';
        }
        if (!text && valueSelector) {
          const node = document.querySelector(valueSelector);
          text = node ? node.value : '';
        }
        if (!text) return;
        const original = button.innerHTML;
        const copied = await copyText(text.trim());
        button.innerHTML = copied ? '<i class="ti ti-check"></i>' : '<i class="ti ti-alert-circle"></i>';
        button.classList.add('copied');
        window.setTimeout(function () {
          button.innerHTML = original;
          button.classList.remove('copied');
        }, 1600);
      });
    });

    document.querySelectorAll('form[data-confirm]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        const message = form.getAttribute('data-confirm');
        if (message && !window.confirm(message)) {
          event.preventDefault();
        }
      });
    });

    document.querySelectorAll('[data-countdown]').forEach(function (element) {
      const expires = element.getAttribute('data-countdown');
      if (!expires) return;
      function tick() {
        const remaining = Math.max(0, new Date(expires).getTime() - Date.now());
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        element.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
        if (remaining <= 0) {
          element.textContent = '00:00';
          window.clearInterval(timer);
        }
      }
      tick();
      const timer = window.setInterval(tick, 1000);
    });

    const paymentCard = document.querySelector('[data-auto-refresh]');
    if (paymentCard) {
      const delay = Number(paymentCard.getAttribute('data-auto-refresh')) || 20000;
      window.setTimeout(function () {
        window.location.reload();
      }, delay);
    }

    document.querySelectorAll('.release-notes p, .callback-text, .notes-row td').forEach(function (element) {
      element.setAttribute('title', element.textContent.trim());
    });
  });
})();
