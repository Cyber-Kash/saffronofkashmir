/* Saffron of Kashmir — main.js (no libraries, ~2 KB) */
(function () {
  'use strict';

  // Mobile nav toggle
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Back to top
  var backTop = document.querySelector('.back-top');
  if (backTop) {
    window.addEventListener('scroll', function () {
      backTop.classList.toggle('show', window.scrollY > 600);
    }, { passive: true });
    backTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Generic filter bars (products / blog categories)
  document.querySelectorAll('[data-filter-bar]').forEach(function (bar) {
    var targetSel = bar.getAttribute('data-filter-target');
    var items = document.querySelectorAll(targetSel + ' [data-category]');
    // Rendered hidden by templates.js. Shown only when a filter leaves nothing
    // visible, so a category that has just lost its last item explains itself
    // instead of presenting an empty grid.
    var empty = document.querySelector('[data-filter-empty-for="' + targetSel + '"]');

    function apply(f) {
      var shown = 0;
      items.forEach(function (item) {
        var cats = item.getAttribute('data-category').split(' ');
        var on = (f === 'all' || cats.indexOf(f) !== -1);
        item.style.display = on ? '' : 'none';
        if (on) shown++;
      });
      if (empty) empty.hidden = shown > 0;
    }

    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn) return;
      bar.querySelectorAll('.filter-btn').forEach(function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      apply(btn.getAttribute('data-filter'));
    });

    if (empty) {
      empty.addEventListener('click', function (e) {
        if (!e.target.closest('.filter-reset')) return;
        var all = bar.querySelector('.filter-btn[data-filter="all"]');
        if (all) { all.click(); all.focus(); }
      });
    }
  });

  // Order attribution.
  // First touch wins: the source that brought a visitor here is recorded once
  // and never overwritten, so a repeat buyer keeps one ref across sessions.
  // Stores only a source label, landing path, timestamp and random code, in
  // this browser. No IP, no fingerprint, no third-party request.
  var SOK_ATTR = (function () {
    var KEY = 'sok_attr';

    // Extend here. Matched case-insensitively as a substring, first hit wins,
    // against the utm_source value and then the referrer hostname.
    var SOURCE_RULES = [
      ['IG', ['instagram']],
      ['FB', ['facebook', 'fb']],
      ['TT', ['tiktok']],
      ['PN', ['pinterest']],
      ['LI', ['linkedin', 'lnkd.in']],
      ['YT', ['youtube', 'youtu.be']],
      ['TH', ['threads']],
      ['GO', ['google']],
      ['SE', ['bing', 'duckduckgo', 'yahoo']]
    ];

    // Deliberately excludes 0 O 1 I L so a code read aloud is unambiguous.
    var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    function lookup(needle) {
      if (!needle) return null;
      var s = String(needle).toLowerCase();
      for (var i = 0; i < SOURCE_RULES.length; i++) {
        var toks = SOURCE_RULES[i][1];
        for (var j = 0; j < toks.length; j++) {
          if (s.indexOf(toks[j]) !== -1) return SOURCE_RULES[i][0];
        }
      }
      return null;
    }

    function resolveSource() {
      var utm = null;
      try { utm = new URLSearchParams(location.search).get('utm_source'); } catch (e) { /* ignore */ }
      if (utm) return lookup(utm) || 'RF';            // tagged but unmapped = referral
      var host = '';
      try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { /* ignore */ }
      if (!host || host === location.hostname) return 'DR';
      return lookup(host) || 'RF';
    }

    // No CSPRNG: omit the ref rather than risk a colliding Math.random code.
    function randomCode(len) {
      if (typeof crypto === 'undefined' || !crypto.getRandomValues) return null;
      var out = '', buf = new Uint8Array(1);
      var limit = 256 - (256 % ALPHABET.length);     // reject above this to stay unbiased
      while (out.length < len) {
        crypto.getRandomValues(buf);
        if (buf[0] >= limit) continue;
        out += ALPHABET.charAt(buf[0] % ALPHABET.length);
      }
      return out;
    }

    function read() {
      try {
        var raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    }

    function init() {
      var existing = read();
      if (existing) return existing;                 // first touch wins
      var src = resolveSource();
      var rec = { src: src, landing: location.pathname, ts: Date.now() };
      var code = randomCode(4);
      if (code) rec.ref = src + '-' + code;
      try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) { /* private mode */ }
      return rec;
    }

    // Append the ref to a wa.me link's message. Idempotent, and rebuilt with
    // encodeURIComponent so encoding matches what templates.js emits.
    function stampLink(a, ref) {
      if (!a || !ref) return false;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('https://wa.me/') !== 0) return false;
      // Links carrying no message of their own (the contact-strip numbers) are
      // left untouched. Stamping them opens WhatsApp with a bare code and no
      // greeting, which reads as a mistake to the customer.
      var q = href.indexOf('?text=');
      if (q === -1) return false;
      var text = '';
      try { text = decodeURIComponent(href.slice(q + 6).replace(/\+/g, '%20')); }
      catch (e) { return false; }
      if (!text) return false;                               // ?text= with nothing after it
      if (text.indexOf('Ref: ' + ref) !== -1) return false;  // already stamped
      a.setAttribute('href', href.slice(0, q) + '?text=' + encodeURIComponent(text + '\n\nRef: ' + ref));
      return true;
    }

    function stampAll(ref) {
      if (!ref) return 0;
      var n = 0;
      document.querySelectorAll('a[href^="https://wa.me/"]').forEach(function (a) {
        if (stampLink(a, ref)) n++;
      });
      return n;
    }

    var attr = init();
    stampAll(attr && attr.ref);

    // Safety net for anything rendered after load. Capture phase, so the href
    // is corrected before the browser acts on the click.
    document.addEventListener('click', function (e) {
      if (!attr || !attr.ref || !e.target.closest) return;
      var a = e.target.closest('a[href^="https://wa.me/"]');
      if (a) stampLink(a, attr.ref);
    }, true);

    return { get: function () { return attr; }, stampAll: stampAll };
  })();

  // WhatsApp conversion tracking
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href*="wa.me"]');
    if (!link) return;
    if (typeof gtag !== 'function') return;
    var card = link.closest('article') || link.closest('.card');
    var h3 = card && card.querySelector('h3');
    var attr = SOK_ATTR.get() || {};
    gtag('event', 'whatsapp_click', {
      item: h3 ? h3.textContent.trim() : 'general',   // kept: existing reports depend on it
      ref: attr.ref || '',
      src: attr.src || '',
      product: link.getAttribute('data-wa-product') || (h3 ? h3.textContent.trim() : ''),
      page_path: location.pathname,
      position: link.getAttribute('data-wa-pos') || 'other',
      wa_number: (link.getAttribute('href').match(/wa\.me\/(\d+)/) || [])[1] || ''
    });
  });

  // Social profile click tracking
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[data-social]');
    if (!link) return;
    if (typeof gtag !== 'function') return;
    gtag('event', 'social_click', {
      platform: link.getAttribute('data-social'),
      page_path: location.pathname
    });
  });

  // Currency switcher and WhatsApp routing.
  // One geo lookup serves both. Currency goes to sok_currency, country to
  // sok_country. There is deliberately no second geolocation call.
  (function () {
    var PREF = 'sok_currency';
    var COUNTRY = 'sok_country';
    var sel = document.getElementById('sok-curr');

    var COUNTRY_MAP = {
      AE: 'AED', IN: 'INR', US: 'USD', SA: 'SAR', QA: 'QAR', OM: 'OMR',
      GB: 'USD', AU: 'USD', CA: 'USD', PK: 'USD', BD: 'USD',
      NZ: 'USD', SG: 'USD', MY: 'USD', KW: 'AED', BH: 'AED',
      JO: 'USD', EG: 'USD', TR: 'USD', DE: 'USD', FR: 'USD'
    };

    // The only countries routed to the UAE line. Everything else, including GB
    // and US, goes to India. One list drives every path so they cannot disagree.
    var UAE_COUNTRIES = { AE: 1, SA: 1, QA: 1, OM: 1, KW: 1, BH: 1 };

    // Currency choice maps back to a country. USD is absent on purpose: it is
    // the catch-all, so picking it leaves the current routing alone.
    var CURRENCY_COUNTRY = { INR: 'IN', AED: 'AE', SAR: 'SA', QAR: 'QA', OMR: 'OM' };

    // Timezone fallback for when ipapi is unreachable or over its daily cap.
    // Resolves to real country codes so currency and routing both stay correct.
    var TZ_COUNTRY = {
      'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
      'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA',
      'Asia/Muscat': 'OM', 'Asia/Kuwait': 'KW', 'Asia/Bahrain': 'BH'
    };

    function countryFromTimezone() {
      try {
        return TZ_COUNTRY[Intl.DateTimeFormat().resolvedOptions().timeZone] || null;
      } catch (e) { return null; }
    }

    // Swap every routed WhatsApp href to the number for this country. Links
    // without the data attributes (the per-market ones in the footer and the
    // contact strip) are left alone, so both numbers stay reachable.
    function routeWhatsApp(country) {
      var key = UAE_COUNTRIES[country] ? 'data-wa-ae' : 'data-wa-in';
      var n = 0;
      document.querySelectorAll('a[href*="wa.me"]').forEach(function (a) {
        var url = a.getAttribute(key);
        if (!url) return;
        a.setAttribute('href', url);
        n++;
      });
      // The swap replaces the whole href, which drops the attribution ref.
      // Re-stamp from the record SOK_ATTR already resolved at load.
      var attr = SOK_ATTR.get();
      if (attr && attr.ref) SOK_ATTR.stampAll(attr.ref);
      return n;
    }

    function setCountry(code) {
      if (!code) return;
      try { localStorage.setItem(COUNTRY, code); } catch (e) { /* private mode */ }
      routeWhatsApp(code);
    }

    function getCurrData(code) {
      if (!sel) return null;
      var opt = sel.querySelector('option[value="' + code + '"]');
      if (!opt) return null;
      return {
        code: code,
        rate: parseFloat(opt.dataset.rate),
        symbol: opt.dataset.symbol,
        decimals: parseInt(opt.dataset.decimals, 10),
        markup: parseFloat(opt.dataset.markup || 0)
      };
    }

    function applyRate(code) {
      var curr = getCurrData(code);
      if (!curr) return;
      document.querySelectorAll('[data-price]').forEach(function (el) {
        var aed = parseFloat(el.dataset.price);
        var converted = aed * curr.rate * (1 + curr.markup / 100);
        var formatted;
        try {
          formatted = new Intl.NumberFormat('en', {
            minimumFractionDigits: curr.decimals,
            maximumFractionDigits: curr.decimals
          }).format(converted);
        } catch (e) {
          formatted = converted.toFixed(curr.decimals);
        }
        el.textContent = curr.symbol + ' ' + formatted;
      });
      sel.value = code;
    }

    function setAndSave(code) {
      applyRate(code);
      try { localStorage.setItem(PREF, code); } catch (e) { /* private mode */ }
    }

    function resolved(country) {
      setCountry(country);
      if (sel) setAndSave(COUNTRY_MAP[country] || 'USD');
    }

    function geoDetect() {
      var done = false;
      function fallback() {
        if (done) return;
        done = true;
        var c = countryFromTimezone();
        if (c) resolved(c);          // otherwise fall through to the existing default
      }
      var timer = setTimeout(fallback, 3000);   // ipapi hung, blocked, or over its cap
      fetch('https://ipapi.co/json/')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (done) return;
          if (!d || !d.country_code) throw new Error('no country in response');
          done = true;
          clearTimeout(timer);
          resolved(d.country_code);
        })
        .catch(function () { clearTimeout(timer); fallback(); });
    }

    var savedCountry = localStorage.getItem(COUNTRY);
    var savedCurr = localStorage.getItem(PREF);
    if (savedCountry) routeWhatsApp(savedCountry);
    if (savedCurr && sel && sel.querySelector('option[value="' + savedCurr + '"]')) applyRate(savedCurr);
    if (!savedCountry || !savedCurr) geoDetect();

    // Manual override, reusing the control the visitor already has.
    if (sel) {
      sel.addEventListener('change', function () {
        setAndSave(sel.value);
        var c = CURRENCY_COUNTRY[sel.value];
        if (c) setCountry(c);          // USD is unmapped, so it leaves routing as it is
      });
    }
  })();

  // First-visit discount overlay
  (function () {
    var el = document.getElementById('sok-overlay');
    if (!el) return;
    var SEEN = 'sok_overlay_seen';
    var DONE = 'sok_overlay_done';
    if (localStorage.getItem(DONE) || sessionStorage.getItem(SEEN)) return;
    function open() {
      el.classList.add('sok-overlay-open');
      var email = el.querySelector('[data-mc-email]');
      if (email) email.focus();
    }
    function close() {
      el.classList.remove('sok-overlay-open');
      sessionStorage.setItem(SEEN, '1');
    }
    // Config is written into the markup by the build from data/site-data.json.
    // Defaults here cover a page built before those keys existed.
    var delayMs = parseInt(el.getAttribute('data-delay'), 10);
    if (isNaN(delayMs)) delayMs = 15000;
    var minWidth = parseInt(el.getAttribute('data-min-width'), 10);
    if (isNaN(minWidth)) minWidth = 768;

    // Read at trigger time, never at load, so a rotate or a resize between the
    // two is respected. Phone-width viewports never open it at all.
    function wideEnough() {
      if (window.matchMedia) return window.matchMedia('(min-width: ' + minWidth + 'px)').matches;
      return (window.innerWidth || document.documentElement.clientWidth || 0) >= minWidth;
    }
    var fired = false;
    function trigger() {
      if (fired) return;
      if (!wideEnough()) return;
      fired = true;
      sessionStorage.setItem(SEEN, '1');
      open();
    }
    setTimeout(trigger, delayMs);   // timer is the only trigger, no scroll listener
    el.querySelector('.sok-overlay-close').addEventListener('click', close);
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    var form = el.querySelector('[data-mc-form]');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var emailEl = form.querySelector('[data-mc-email]');
      var consentEl = form.querySelector('[name="consent"]');
      var msgEl = form.querySelector('.sok-overlay-msg');
      var submitBtn = form.querySelector('[type="submit"]');
      if (!consentEl.checked) { msgEl.textContent = 'Please tick the box to continue.'; return; }
      msgEl.textContent = '';
      submitBtn.disabled = true;
      var url = form.dataset.endpoint.replace('/post?', '/post-json?') +
        '&EMAIL=' + encodeURIComponent(emailEl.value) + '&c=sokMcCb';
      window.sokMcCb = function (res) {
        if (res.result === 'success') {
          form.style.display = 'none';
          var ok = el.querySelector('.sok-overlay-success');
          if (ok) ok.style.display = '';
          localStorage.setItem(DONE, '1');
          setTimeout(close, 3000);
        } else {
          msgEl.textContent = res.msg ? res.msg.replace(/<[^>]+>/g, '').trim() : 'Something went wrong. Please try again.';
          submitBtn.disabled = false;
        }
      };
      var s = document.createElement('script');
      s.src = url;
      s.onerror = function () {
        msgEl.textContent = 'Connection error — please try again.';
        submitBtn.disabled = false;
      };
      document.head.appendChild(s);
    });
  })();

  // Print a single recipe: open its details, print, restore
  document.querySelectorAll('.print-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = btn.closest('article');
      if (!card) { window.print(); return; }
      var clone = card.cloneNode(true);
      clone.querySelectorAll('details').forEach(function (d) { d.open = true; });
      var win = window.open('', '_blank', 'width=800,height=900');
      win.document.write('<html><head><title>Recipe — Saffron of Kashmir</title>' +
        '<style>body{font-family:Georgia,serif;max-width:640px;margin:24px auto;padding:0 16px;color:#222;line-height:1.6}' +
        'img,button,.btn,.print-btn,summary{display:none}h4{text-transform:uppercase;font-size:13px;letter-spacing:.06em;color:#A8842F}</style>' +
        '</head><body>' + clone.innerHTML + '</body></html>');
      win.document.close();
      win.focus();
      win.print();
    });
  });

  // Purity checker.
  // The markup is complete and readable before this runs: real radios in real
  // fieldsets, every reasoning string on the page. CSS does the reveal through
  // input:checked, so selecting an option needs no JavaScript either. This adds
  // only what genuinely cannot work without it: the controls and the outcome.
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.querySelector('.checker');
    if (!root) return;
    var form = root.querySelector('.checker-form');
    var result = root.querySelector('.checker-result');
    var controls = root.querySelector('.checker-controls');
    if (!form || !result || !controls) return;

    // Marks the section as enhanced. Until this class lands, CSS keeps every
    // reasoning paragraph visible, which is the no-JS reading.
    root.classList.add('checker-js');
    controls.hidden = false;

    function outcomeFor(signals, total) {
      if (signals.indexOf('indicator') !== -1) return 'indicator';
      if (signals.length < total) return 'inconclusive';
      if (signals.indexOf('inconclusive') !== -1) return 'inconclusive';
      return 'nothing';
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var groups = form.querySelectorAll('fieldset.checker-q');
      var signals = [];
      groups.forEach(function (g) {
        var picked = g.querySelector('input[type="radio"]:checked');
        if (picked) signals.push(picked.getAttribute('data-signal'));
      });

      if (!signals.length) {
        result.innerHTML = '<p class="checker-none">Answer at least one question first.</p>';
        return;
      }

      var key = outcomeFor(signals, groups.length);
      var src = root.querySelector('.checker-outcome[data-outcome="' + key + '"]');
      if (!src) return;

      result.innerHTML = '<div class="checker-verdict" data-outcome="' + key + '">' +
        src.innerHTML + '</div>';

      // Focus moves only on submit, never on selection, so keyboard users are
      // not thrown out of the form while answering.
      var h = result.querySelector('h3');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
    });

    form.addEventListener('reset', function () {
      result.innerHTML = '';
    });
  });
})();
