// Grupey landing. JS del boceto (pestañas y revelado) + envío real de la lista de espera.
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  // pestañas del demo (sin cambios respecto al boceto)
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('on'); });
      tab.setAttribute('aria-selected', 'true');
      document.getElementById(tab.dataset.panel).classList.add('on');
    });
  });

  // revelado al hacer scroll; sin IntersectionObserver se muestra todo
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('seen'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -10% 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('seen'); });
  }

  // atribución: primer contacto de la sesión; nunca rompe la página si sessionStorage falla
  var ATTR_KEY = 'grupey_attr';
  var ATTR_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'];
  var attribution = {};
  try {
    var stored = sessionStorage.getItem(ATTR_KEY);
    if (stored) {
      attribution = JSON.parse(stored) || {};
    } else {
      var params = new URLSearchParams(location.search);
      ATTR_FIELDS.forEach(function (k) { var v = params.get(k); if (v) attribution[k] = v.slice(0, 200); });
      if (document.referrer) {
        var refHost = new URL(document.referrer).hostname;
        if (refHost && refHost !== location.hostname) attribution.referrer_host = refHost;
      }
      sessionStorage.setItem(ATTR_KEY, JSON.stringify(attribution));
    }
  } catch (e) {
    attribution = {};
  }

  var MESSAGES = {
    invalid_email: 'Revisa tu correo: parece que algo no está bien escrito.',
    rate_limited: 'Demasiados intentos seguidos. Prueba de nuevo en un minuto.',
    retry: 'No pudimos guardar tu correo. Intenta de nuevo.',
    broken: 'Algo salió mal. Recarga la página e intenta de nuevo.'
  };
  var CONTACT = 'hola@grupey.com';
  var TIMEOUT_MS = 10000;
  var NETWORK_RETRY_MS = 2000;
  var failures = 0;
  var forms = document.querySelectorAll('[data-waitlist]');

  function send(payload) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch('/api/pre-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: controller.signal
    }).then(function (res) {
      return res.json().then(function (data) {
        return { status: res.status, code: data && data.code, retryAfter: res.headers.get('Retry-After') };
      }, function () {
        // respuesta que no es JSON (p. ej. página de error de Vercel): se trata como 500
        return { status: 500, code: 'internal_error' };
      });
    }).finally(function () { clearTimeout(timer); });
  }

  function sendWithRetry(payload) {
    return send(payload).catch(function () {
      // red caída o timeout: un reintento automático (la API es idempotente)
      return new Promise(function (resolve) { setTimeout(resolve, NETWORK_RETRY_MS); })
        .then(function () { return send(payload); })
        .catch(function () { return { status: 0, code: 'network_error' }; });
    });
  }

  function showSuccess(sourceForm) {
    // ya estás en la lista: ambos formularios pasan a la confirmación del boceto
    forms.forEach(function (form) {
      form.style.display = 'none';
      var err = form.parentElement.querySelector('.waitlist-error');
      if (err) err.hidden = true;
      var ok = form.parentElement.querySelector('.waitlist-ok');
      if (ok) ok.style.display = 'flex';
    });
    var mine = sourceForm.parentElement.querySelector('.waitlist-ok');
    if (mine) { mine.setAttribute('tabindex', '-1'); mine.focus(); }
  }

  function showError(form, message, focusInput) {
    var err = form.parentElement.querySelector('.waitlist-error');
    if (!err) return;
    err.textContent = message;
    if (failures >= 2) {
      err.appendChild(document.createTextNode(' Si sigue fallando, escríbenos a '));
      var link = document.createElement('a');
      link.href = 'mailto:' + CONTACT;
      link.textContent = CONTACT;
      err.appendChild(link);
      err.appendChild(document.createTextNode(' y te anotamos.'));
    }
    err.hidden = false;
    if (focusInput) form.querySelector('input[name="email"]').focus();
    else err.focus();
  }

  forms.forEach(function (form) {
    var input = form.querySelector('input[name="email"]');
    var honeypot = form.querySelector('input[name="website"]');
    var button = form.querySelector('button[type="submit"]');

    function setSending(sending) {
      form.classList.toggle('is-sending', sending);
      button.disabled = sending;
      if (sending) button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (button.disabled) return;

      var payload = {
        email: input.value.trim(),
        form: form.getAttribute('data-waitlist') || null,
        landing_path: location.pathname,
        website: honeypot ? honeypot.value : ''
      };
      Object.keys(attribution).forEach(function (k) { payload[k] = attribution[k]; });

      setSending(true);
      sendWithRetry(payload).then(function (r) {
        if (r.status === 200) {
          failures = 0;
          form.classList.remove('is-sending');
          showSuccess(form);
          return;
        }
        failures += 1;
        setSending(false);
        if (r.code === 'invalid_email') {
          showError(form, MESSAGES.invalid_email, true);
        } else if (r.status === 429) {
          var wait = parseInt(r.retryAfter, 10);
          button.disabled = true;
          setTimeout(function () { button.disabled = false; }, (wait > 0 ? wait : 60) * 1000);
          showError(form, MESSAGES.rate_limited, false);
        } else if (r.status === 0 || r.status >= 500) {
          showError(form, MESSAGES.retry, false);
        } else {
          showError(form, MESSAGES.broken, false);
        }
      });
    });
  });
})();
