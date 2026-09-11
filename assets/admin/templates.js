/* ============================================================
   Saffron of Kashmir - site templates
   Pure functions: data (site-data.json) -> HTML strings.
   Used by the admin panel (publish/preview) and build.js.
   Works in both the browser and Node (UMD-style export at bottom).
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SOKTemplates = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Build identifier. REWRITTEN BY build.js on every build: it is the content
     hash of this file with this line normalised, so stamping is idempotent and
     a no-op rebuild does not churn it. Do not edit by hand.

     Two things depend on it. admin.html loads this file as
     templates.js?v=<BUILD_ID>, so a stale cached copy cannot be served. And
     admin.js compares this value against the build-id.json on the live site
     before publishing, and blocks the publish if they differ. See the 29 Aug
     2026 incident in docs/RESUME.md. */
  var BUILD_ID = '213fca753054';

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Resolve the two routing numbers. Explicit brand fields win; the
  // whatsappNumbers list is the fallback so an older data file still works.
  function waNumbers(brand) {
    var list = brand.whatsappNumbers || [];
    function byMarket(re) {
      for (var i = 0; i < list.length; i++) {
        if (re.test(list[i].market || '')) return list[i].number;
      }
      return null;
    }
    return {
      india: brand.whatsappIndia || byMarket(/india/i) || brand.whatsappNumber,
      uae: brand.whatsappUae || byMarket(/uae|middle east|gulf/i) || brand.whatsappNumber
    };
  }

  // India is the static href so the link works with JavaScript disabled.
  function waUrl(brand, text) {
    return 'https://wa.me/' + waNumbers(brand).india + '?text=' + encodeURIComponent(text || brand.defaultWaText);
  }

  // href plus both routed URLs as data attributes, for main.js to swap between.
  // Pure: no DOM, no branching on browser state.
  function waAttrs(brand, text) {
    var n = waNumbers(brand);
    var msg = encodeURIComponent(text || brand.defaultWaText);
    var inUrl = 'https://wa.me/' + n.india + '?text=' + msg;
    var aeUrl = 'https://wa.me/' + n.uae + '?text=' + msg;
    return ' href="' + esc(inUrl) + '" data-wa-in="' + esc(inUrl) + '" data-wa-ae="' + esc(aeUrl) + '"';
  }

  // Inline mini-markdown: [label](url), **bold**, *em*.
  // Special href scheme  wa:Message text  -> WhatsApp link with that message.
  function inlineMd(brand, s) {
    let out = esc(s);
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, href) {
      href = href.trim();
      let attrs = '';
      if (href.toLowerCase().startsWith('wa:')) {
        // Routed like every other WhatsApp link: India href, both numbers as data attrs.
        return '<a' + waAttrs(brand, href.slice(3)) +
          ' data-wa-pos="prose" target="_blank" rel="noopener">' + label + '</a>';
      } else if (/^https?:\/\//i.test(href)) {
        attrs = ' target="_blank" rel="noopener"';
      }
      return '<a href="' + esc(href) + '"' + attrs + '>' + label + '</a>';
    });
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    // `code` for literal names such as browser storage keys. Additive: no
    // existing copy contains a backtick, so no current output changes.
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    return out;
  }

  // Plain-text version of mini-markdown (for JSON-LD).
  function plainMd(s) {
    return String(s == null ? '' : s)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
  }

  /* Purity checker.

     Pure, like everything else here: data in, HTML string out. No DOM, no
     browser API, so it runs under Node in build.js and in the admin panel.

     Everything renders on first paint, including every reasoning string. With
     JavaScript off this is a readable document: real radio inputs inside real
     fieldsets, each option followed by the sentence that explains it. main.js
     unhides the controls and collapses the reasoning to reveal-on-select. The
     reasoning IS the product, so it is never JavaScript-only.

     tools/check_checker.py enforces that every string here is anchored to a
     sentence in a live post. */
  function checkerHtml(data, p) {
    var c = p && p.checker;
    if (!c || !c.questions || !c.questions.length) return '';
    var b = data.brand;
    var out = '';

    out += '          <section class="checker" id="purity-checker" aria-labelledby="checker-h">\n';
    out += '            <h2 id="checker-h">' + esc(c.heading) + '</h2>\n';
    out += '            <p class="checker-intro">' + inlineMd(b, c.intro) + '</p>\n';
    out += '            <form class="checker-form" novalidate>\n';

    c.questions.forEach(function (q, qi) {
      out += '              <fieldset class="checker-q">\n';
      out += '                <legend>' + esc(q.prompt) + '</legend>\n';
      if (q.help) out += '                <p class="checker-help">' + esc(q.help) + '</p>\n';
      (q.options || []).forEach(function (o, oi) {
        var id = 'ck-' + esc(q.id) + '-' + oi;
        out += '                <div class="checker-opt">\n';
        out += '                  <input type="radio" id="' + id + '" name="ck-' + esc(q.id) + '"'
             + ' value="' + oi + '" data-signal="' + esc(o.signal) + '">\n';
        out += '                  <label for="' + id + '">' + esc(o.label) + '</label>\n';
        out += '                  <p class="checker-because" id="' + id + '-why">'
             + esc(o.because) + '</p>\n';
        out += '                </div>\n';
      });
      out += '              </fieldset>\n';
    });

    /* Hidden by default and unhidden by main.js. With JavaScript off there is
       nothing to compute, so offering a button that reloads the page would be
       worse than offering none. */
    out += '              <div class="checker-controls" hidden>\n';
    out += '                <button type="submit" class="btn">Show what this adds up to</button>\n';
    out += '                <button type="reset" class="btn btn-outline">Start again</button>\n';
    out += '              </div>\n';
    out += '            </form>\n';

    out += '            <div class="checker-result" role="status" aria-live="polite"></div>\n';

    /* Every outcome renders as static content too, so the reasoning survives
       with JavaScript off and is indexable. main.js reads these. */
    out += '            <div class="checker-outcomes">\n';
    ['indicator', 'nothing', 'inconclusive'].forEach(function (k) {
      var oc = (c.outcomes || {})[k];
      if (!oc) return;
      out += '              <div class="checker-outcome" data-outcome="' + k + '">\n';
      out += '                <h3>' + esc(oc.heading) + '</h3>\n';
      out += '                <p>' + inlineMd(b, oc.body) + '</p>\n';
      out += '              </div>\n';
    });
    out += '            </div>\n';

    if (c.notes && c.notes.length) {
      out += '            <ul class="checker-notes">\n';
      c.notes.forEach(function (n) {
        out += '              <li>' + inlineMd(b, n.text) + '</li>\n';
      });
      out += '            </ul>\n';
    }

    if (c.cannotSee && c.cannotSee.length) {
      out += '            <aside class="checker-cannot">\n';
      out += '              <h3>What none of this can detect</h3>\n';
      out += '              <ul>\n';
      c.cannotSee.forEach(function (n) {
        out += '                <li>' + inlineMd(b, n.text) + '</li>\n';
      });
      out += '              </ul>\n';
      out += '            </aside>\n';
    }

    if (c.footer) out += '            <p class="checker-footer">' + inlineMd(b, c.footer) + '</p>\n';
    out += '          </section>\n';
    return out;
  }

  /* Renders a post body with the checker spliced in after the named section.
     Splitting here rather than putting a placeholder in the body keeps the
     body pure mini-markdown and keeps the bare-brace sweep meaningful.
     check_checker.py asserts afterSection resolves, so the fall-through is a
     safety net rather than a supported path. */
  function bodyWithChecker(data, p) {
    var body = String((p && p.body) || '');
    var c = p && p.checker;
    if (!c || !c.afterSection) return bodyToHtml(data.brand, body);
    var head = '## ' + c.afterSection;
    var i = body.indexOf(head);
    if (i === -1) return bodyToHtml(data.brand, body) + checkerHtml(data, p);
    var j = body.indexOf('\n## ', i + head.length);
    if (j === -1) return bodyToHtml(data.brand, body) + checkerHtml(data, p);
    return bodyToHtml(data.brand, body.slice(0, j)) + '\n'
         + checkerHtml(data, p)
         + bodyToHtml(data.brand, body.slice(j + 1));
  }

  // Blog body: blank-line paragraphs; lines starting "## " become <h3>.
  function bodyToHtml(brand, body) {
    const blocks = String(body || '').replace(/\r\n/g, '\n').split(/\n\s*\n/);
    return blocks.map(function (b) {
      b = b.trim();
      if (!b) return '';
      /* Article sections are h2. They used to be h3, which left every post
         jumping h1 to h3 with the only h2 on the page belonging to the
         related-links widget. There is deliberately no '### ' branch: no post
         body uses one, and a third level would need its own mapping here
         rather than falling through to the paragraph case below, which would
         render the hashes literally. */
      if (b.startsWith('## ')) return '              <h2>' + esc(b.slice(3).trim()) + '</h2>';
      // A block whose every line starts "- " becomes a list. Additive: no
      // existing post body contains one, so no current output changes.
      var lines = b.split('\n');
      if (lines.every(function (l) { return /^-\s+/.test(l.trim()); })) {
        return '              <ul>\n' + lines.map(function (l) {
          return '                <li>' + inlineMd(brand, l.trim().replace(/^-\s+/, '')) + '</li>';
        }).join('\n') + '\n              </ul>';
      }
      return '              <p>' + inlineMd(brand, b.replace(/\n/g, ' ')) + '</p>';
    }).filter(Boolean).join('\n');
  }

  /* A script element is a raw text element: the parser ends it at the first
     closing script tag it sees, wherever that is. JSON.stringify does not
     escape the less-than sign, so any content value containing a closing script
     tag ended this element early. The rest of the JSON then landed on the page
     as markup, which meant two things at once: the structured data was
     truncated and invalid, and everything after the break was parsed as HTML.
     A description carrying a closing script tag followed by an opening one put
     a working, executing script tag on every page that has JSON-LD, and the
     admin panel is the thing that edits descriptions.

     Every less-than sign is now written as its six-character JSON unicode
     escape. That is an ordinary JSON string escape, so JSON.parse hands back
     the original character and no consumer sees a difference. No value in the
     site today contains one, so this changes no generated output; it stops the
     next one from being a live defect. */
  function ld(obj) {
    return '  <script type="application/ld+json">\n  ' +
      JSON.stringify(obj, null, 2).replace(/</g, '\\u003c').replace(/\n/g, '\n  ') +
      '\n  </script>';
  }

  function statusBadge(status) {
    if (status === 'out_of_stock') {
      return '<span style="position:absolute;top:12px;left:12px;background:#9d2235;color:#fff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px;">Out of Stock</span>';
    }
    if (status === 'coming_soon') {
      return '<span style="position:absolute;top:12px;left:12px;background:#A8842F;color:#fff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px;">Coming Soon</span>';
    }
    return '';
  }

  function statusAvailability(status) {
    if (status === 'out_of_stock') return 'https://schema.org/OutOfStock';
    if (status === 'coming_soon') return 'https://schema.org/PreOrder';
    return 'https://schema.org/InStock';
  }

  // URL-safe slug: lowercase, drop apostrophes, non-alphanumerics -> single hyphen.
  function slugify(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  // Readable product slug from name + size, e.g. "royal-mongra-2g".
  function productSlug(p) {
    return slugify(p.baseName) + '-' + slugify(String(p.size).replace(/\s+/g, ''));
  }
  function productPath(p) { return 'products/' + productSlug(p) + '/'; }      // output filename key
  function productHref(p) { return '/' + productPath(p); }                     // root-relative, trailing slash
  function productUrl(b, p) { return b.siteUrl + '/' + productPath(p); }       // absolute, trailing slash

  // Post ids were written as slugs already, so this is close to a pass-through.
  // It also stays the fragment id on the blog index, which is why old
  // /blogs#<id> links keep landing in the right place.
  function postSlug(p) { return slugify(p.id); }
  function postPath(p) { return 'blog/' + postSlug(p) + '/'; }                 // output filename key
  function postHref(p) { return '/' + postPath(p); }                           // root-relative, trailing slash
  function postUrl(b, p) { return b.siteUrl + '/' + postPath(p); }             // absolute, trailing slash

  // Internal URLs are root-relative and extensionless. Root pages carry no
  // trailing slash; product detail pages keep theirs.
  var PAGE_PATHS = {
    'index.html': '/',
    'products.html': '/products',
    'recipes.html': '/recipes',
    'blogs.html': '/blogs',
    'privacy-policy.html': '/privacy-policy'
  };
  // "products.html#identify" -> "/products#identify";  "index.html#faq" -> "/#faq"
  function pageUrl(ref) {
    var s = String(ref == null ? '' : ref), hash = '', i = s.indexOf('#');
    if (i !== -1) { hash = s.slice(i); s = s.slice(0, i); }
    if (PAGE_PATHS[s] !== undefined) return PAGE_PATHS[s] + hash;
    // Any other root-level .html resolves extensionless too, so a page added
    // through the data (a policy) matches the scheme with no map entry.
    return (s.charAt(0) === '/' ? s : '/' + s).replace(/\.html$/, '') + hash;
  }
  // Root-relative path for an asset that lives at the site root.
  function asset(p) { return '/' + String(p == null ? '' : p).replace(/^\/+/, ''); }

  // Static so the build is deterministic. Bump deliberately, not by clock.
  var COPYRIGHT_YEAR = '2026';

  // "2026-08-09" -> "August 9, 2026". Hand-rolled rather than toLocaleDateString
  // so output never varies by locale, timezone or ICU build.
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso).trim());
    if (!m) return String(iso == null ? '' : iso);
    return MONTH_NAMES[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
  }

  /* ---------- social profiles ---------- */

  // brand.social is the single source for every profile URL on the site.
  function socialList(b) {
    return (b && Array.isArray(b.social)) ? b.social.filter(function (s) { return s && s.url; }) : [];
  }
  function socialByName(b, name) {
    var l = socialList(b), i;
    for (i = 0; i < l.length; i++) {
      if (String(l[i].name).toLowerCase() === String(name).toLowerCase()) return l[i];
    }
    return null;
  }
  // "https://www.instagram.com/saffron_of_kashmir/" -> "saffron_of_kashmir"
  function socialHandle(url) {
    var parts = String(url == null ? '' : url).replace(/\/+$/, '').split('/');
    return parts[parts.length - 1].replace(/^@/, '');
  }
  function socialKey(name) { return String(name == null ? '' : name).toLowerCase(); }

  // Inline 24x24 icon paths. No icon font, no external library.
  var SOCIAL_ICONS = {
    instagram: 'M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z',
    facebook: 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z',
    tiktok: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
    pinterest: 'M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.367 18.592.001 11.985.001L12.017 0z',
    linkedin: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z',
    youtube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
    threads: 'M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z'
  };

  // Platform names that have an inline footer icon. Exported so the admin can
  // warn about a profile whose name has no icon, without duplicating the list.
  function socialIconNames() { return Object.keys(SOCIAL_ICONS); }

  function socialLinksHtml(b) {
    var list = socialList(b).filter(function (s) { return SOCIAL_ICONS[socialKey(s.name)]; });
    if (!list.length) return '';
    return '      <ul class="social-links" aria-label="Follow us">\n' +
      list.map(function (s) {
        var k = socialKey(s.name);
        return '        <li><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer"' +
          ' aria-label="' + esc(s.name) + '" data-social="' + esc(k) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + SOCIAL_ICONS[k] + '"/></svg>' +
          '</a></li>';
      }).join('\n') +
      '\n      </ul>\n';
  }

  function productView(p) {
    var name = (p.baseName || '') + ' ' + (p.size || '');
    var perGram = p.grams ? Math.round(p.price / p.grams) : null;
    return Object.assign({}, p, {
      name: name,
      badge: p.size,
      schemaName: name,
      schemaDesc: name + '. ' + (p.descBody || ''),
      imageAlt: (p.baseName || '') + ' ' + (p.size || '') + ', ' + (p.altContext || ''),
      waText: "Hi! I'd like to order " + (p.baseName || '') + ' ' + (p.size || '') + ' from Saffron of Kashmir.',
      notifyWaText: 'Hi! Please notify me when ' + name + ' is available.',
      perGram: perGram
    });
  }

  /* data-wa-pos / data-wa-product are read by main.js at runtime: it stamps a
     visitor ref into the message and reports the click to GA4. Emitting plain
     attributes keeps this file DOM-free. */
  function orderBtn(brand, pv, pos) {
    var available = pv.status === 'available';
    var label = available ? 'Order on WhatsApp' : 'Notify me when available';
    var text = available ? pv.waText : pv.notifyWaText;
    return '<a class="btn btn-whatsapp"' + waAttrs(brand, text) +
      ' data-wa-pos="' + esc(pos || 'card') + '" data-wa-product="' + esc(pv.id || '') + '"' +
      ' target="_blank" rel="noopener">' + label + '</a>';
  }

  /* Headline and terms must always appear together. Emitting the headline
     alone would promise a guarantee without stating what it covers, so this
     returns nothing unless both halves are present. */
  function guaranteeBlock(data) {
    var g = data.guarantee;
    if (!g || !g.headline || !g.terms) return '';
    return '        <p class="guarantee"><strong>' + esc(g.headline) + '</strong> ' +
      esc(g.terms) + '</p>\n';
  }

  /* The harvest year lives in one place, brand.harvestYear. It changes every
     October, so never write the year as a literal in template copy. */
  function harvestReportLine(data) {
    var y = data.brand && data.brand.harvestYear;
    if (!y) return '';
    return '        <p class="harvest-report">The ' + esc(y) +
      ' harvest lab report is available on request.</p>\n';
  }

  function productPriceHtml(p) {
    if (p.sale && typeof p.sale.price === 'number') {
      var saleLabel = p.sale.label
        ? ' <span style="background:#e8f5e9;color:#1d7a46;font-size:12.5px;font-weight:700;border-radius:99px;padding:3px 9px;">' + esc(p.sale.label) + '</span>'
        : '';
      return '<div class="p-price">' +
        '<s style="font-size:15px;font-weight:400;color:var(--muted);" data-price="' + esc(p.price) + '">AED ' + esc(p.price) + '</s> ' +
        '<span data-price="' + esc(p.sale.price) + '">AED ' + esc(p.sale.price) + '</span> ' +
        '<span class="unit">' + esc(p.unitLabel) + '</span>' + saleLabel + '</div>';
    }
    return '<div class="p-price"><span data-price="' + esc(p.price) + '">AED ' + esc(p.price) + '</span> <span class="unit">' + esc(p.unitLabel) + '</span></div>';
  }

  const WA_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

  function renderOverlayHtml(data, page) {
    var ov = data.overlay;
    if (!ov || !ov.enabled || !ov.formEndpoint) return '';
    // Homepage restriction is decided here, at build time, from the page key the
    // template is rendering. Nothing to sniff in main.js, and the markup simply
    // does not exist on any page the overlay must not fire on.
    if (ov.homepageOnly !== false && page !== 'index') return '';
    var delayMs = ov.delayMs != null ? ov.delayMs : 15000;
    var minWidth = ov.minViewportWidth != null ? ov.minViewportWidth : 768;
    var uM = ov.formEndpoint.match(/[?&]u=([^&]+)/);
    var idM = ov.formEndpoint.match(/[?&]id=([^&]+)/);
    var honeypot = (uM && idM) ? 'b_' + uM[1] + '_' + idM[1] : '';
    return '<div id="sok-overlay" class="sok-overlay" role="dialog" aria-modal="true" aria-labelledby="sok-ov-h"' +
      ' data-delay="' + esc(delayMs) + '" data-min-width="' + esc(minWidth) + '">\n' +
      '  <div class="sok-overlay-box">\n' +
      '    <button class="sok-overlay-close" aria-label="Close this popup">×</button>\n' +
      (ov.image ? '    <img src="' + esc(asset(ov.image)) + '" alt="" class="sok-overlay-img" loading="lazy">\n' : '') +
      '    <h2 id="sok-ov-h" class="sok-overlay-heading">' + esc(ov.heading) + '</h2>\n' +
      '    <p class="sok-overlay-text">' + esc(ov.text) + '</p>\n' +
      (ov.discountText ? '    <p class="sok-overlay-discount">' + esc(ov.discountText) + '</p>\n' : '') +
      '    <form class="sok-overlay-form" data-mc-form data-endpoint="' + esc(ov.formEndpoint) + '" novalidate>\n' +
      '      <input type="email" name="EMAIL" data-mc-email required autocomplete="email" placeholder="Your email address">\n' +
      (honeypot ? '      <div style="position:absolute;left:-5000px;" aria-hidden="true"><input type="text" name="' + esc(honeypot) + '" tabindex="-1" value=""></div>\n' : '') +
      '      <label class="sok-overlay-consent"><input type="checkbox" name="consent" required>\n' +
      '        I agree to receive occasional emails from ' + esc(data.brand.name) + '.\n' +
      '        See our <a href="' + esc(pageUrl(ov.privacyHref || 'privacy-policy.html')) + '">Privacy&nbsp;Policy</a>.\n' +
      '      </label>\n' +
      '      <button type="submit" class="btn btn-primary">' + esc(ov.buttonLabel || 'Subscribe') + '</button>\n' +
      '      <p class="sok-overlay-msg" role="status" aria-live="polite"></p>\n' +
      '    </form>\n' +
      '    <p class="sok-overlay-success" style="display:none;">' + esc(ov.successText || 'Thank you! Check your inbox.') + '</p>\n' +
      '  </div>\n</div>\n';
  }

  /* ---------- shared page chrome ---------- */

  function head(data, page, opts) {
    const b = data.brand, s = page.seo || data.seo[page.seoKey];
    const url = page.url || (b.siteUrl + pageUrl(page.file));
    const ogImageUrl = b.siteUrl + '/' + (page.ogImage || b.ogImage);
    let out = '<!DOCTYPE html>\n<html lang="en" dir="ltr">\n<head>\n' +
      '  <meta charset="UTF-8">\n' +
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <title>' + esc(s.title) + '</title>\n' +
      '  <meta name="description" content="' + esc(s.description) + '">\n' +
      '  <meta name="robots" content="index, follow">\n' +
      '  <link rel="canonical" href="' + esc(url) + '">\n' +
      '  <link rel="alternate" hreflang="en" href="' + esc(url) + '">\n\n' +
      '  <meta property="og:type" content="website">\n' +
      '  <meta property="og:site_name" content="' + esc(b.name) + '">\n' +
      '  <meta property="og:locale" content="en_US">\n' +
      '  <meta property="og:title" content="' + esc(s.ogTitle) + '">\n' +
      '  <meta property="og:description" content="' + esc(s.ogDescription) + '">\n' +
      '  <meta property="og:image" content="' + esc(ogImageUrl) + '">\n' +
      '  <meta property="og:url" content="' + esc(url) + '">\n' +
      '  <meta name="twitter:card" content="summary_large_image">\n' +
      '  <meta name="twitter:title" content="' + esc(s.ogTitle) + '">\n' +
      '  <meta name="twitter:description" content="' + esc(s.ogDescription) + '">\n' +
      '  <meta name="twitter:image" content="' + esc(ogImageUrl) + '">\n\n' +
      '  <link rel="icon" type="image/webp" href="' + esc(asset(b.favicon)) + '">\n' +
      (opts && opts.appleIcon ? '  <link rel="apple-touch-icon" href="' + esc(asset(b.favicon)) + '">\n' : '') +
      (opts && opts.preload ? '  <link rel="preload" as="image" href="' + esc(asset(opts.preload)) + '">\n' : '') +
      '  <link rel="stylesheet" href="/assets/css/style.css">\n\n';

    if (b.gaId) {
      out += '  <script async src="https://www.googletagmanager.com/gtag/js?id=' + esc(b.gaId) + '"></script>\n' +
        '  <script>\n' +
        '    window.dataLayer = window.dataLayer || [];\n' +
        '    function gtag(){dataLayer.push(arguments);}\n' +
        "    gtag('js', new Date());\n" +
        "    gtag('config', '" + b.gaId + "');\n" +
        '  </script>\n';
    }
    if (b.fbPixelId) {
      out += '  <script>\n' +
        '    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?\n' +
        '    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;\n' +
        "    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;\n" +
        '    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,\n' +
        "    document,'script','https://connect.facebook.net/en_US/fbevents.js');\n" +
        "    fbq('init','" + b.fbPixelId + "');fbq('track','PageView');\n" +
        '  </script>\n';
    }
    out += '\n' + page.jsonLd + '\n</head>\n';
    return out;
  }

  function currencySelect(b) {
    var currs = b.currencies || {};
    var order = ['AED', 'USD', 'INR', 'SAR', 'QAR', 'OMR'];
    var opts = order.filter(function (c) { return currs[c]; }).map(function (c) {
      var cu = currs[c];
      return '      <option value="' + esc(c) + '" data-rate="' + esc(cu.rate) +
        '" data-symbol="' + esc(cu.symbol) + '" data-decimals="' + esc(cu.decimals) +
        '" data-markup="' + esc(cu.markup || 0) + '">' + esc(c) + '</option>';
    }).join('\n');
    if (!opts) return '';
    return '    <select id="sok-curr" class="currency-select" aria-label="Select currency">\n' +
      opts + '\n    </select>\n';
  }

  function header(data, current) {
    const b = data.brand;
    const items = [
      ['index.html', 'Home'], ['products.html', 'Products'], ['recipes.html', 'Recipes'],
      ['blogs.html', 'Blog'], ['index.html#faq', 'FAQ'], ['index.html#contact', 'Contact']
    ];
    const links = items.map(function (it) {
      const cur = it[0] === current ? ' aria-current="page"' : '';
      return '      <a href="' + pageUrl(it[0]) + '"' + cur + '>' + it[1] + '</a>';
    }).join('\n');
    return '<body>\n<a class="skip-link" href="#main">Skip to content</a>\n\n' +
      '<header class="site-header">\n' +
      '  <nav class="nav-inner" aria-label="Main navigation">\n' +
      '    <a href="' + pageUrl('index.html') + '" class="brand" aria-label="' + esc(b.name) + ' - home">\n' +
      '      <img src="' + esc(asset(b.logo)) + '" alt="' + esc(b.name) + ' logo" width="40" height="40">\n' +
      '      <span>\n' +
      '        <span class="brand-name">' + esc(b.name) + '</span>\n' +
      '        <span class="brand-tag">' + esc(b.tagline) + '</span>\n' +
      '      </span>\n' +
      '    </a>\n' +
      '    <button class="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="nav-links">☰</button>\n' +
      '    <div class="nav-links" id="nav-links">\n' + links + '\n    </div>\n' +
      currencySelect(b) +
      '    <a class="btn btn-whatsapp nav-cta-desktop"' + waAttrs(b) + ' data-wa-pos="nav" target="_blank" rel="noopener">Order Now</a>\n' +
      '  </nav>\n</header>\n';
  }

  function footer(data, page) {
    const b = data.brand, f = data.footer;
    const year = COPYRIGHT_YEAR;
    return '<footer class="site-footer">\n' +
      '  <div class="container footer-grid">\n' +
      '    <div>\n' +
      '      <img src="' + esc(asset(b.logo)) + '" alt="' + esc(b.name) + ' logo" width="120" height="40" loading="lazy">\n' +
      '      <p>' + esc(f.about) + '</p>\n' +
      socialLinksHtml(b) +
      '    </div>\n' +
      '    <div>\n      <h3>Navigation</h3>\n      <ul>\n' +
      '        <li><a href="' + pageUrl('index.html') + '">Home</a></li>\n' +
      '        <li><a href="' + pageUrl('products.html') + '">Products</a></li>\n' +
      '        <li><a href="' + pageUrl('recipes.html') + '">Recipes</a></li>\n' +
      '        <li><a href="' + pageUrl('blogs.html') + '">Blog</a></li>\n' +
      '        <li><a href="' + pageUrl('index.html#faq') + '">FAQ</a></li>\n' +
      Object.keys(data.policies || {}).map(function (k) {
        var pol = data.policies[k];
        return '        <li><a href="' + pageUrl(pol.slug) + '">' + esc(pol.title) + '</a></li>';
      }).join('\n') + (Object.keys(data.policies || {}).length ? '\n' : '') +
      '      </ul>\n    </div>\n' +
      '    <div>\n      <h3>Order &amp; Contact</h3>\n      <ul>\n' +
      '        <li><a href="tel:' + esc(b.phoneTel) + '">' + esc(b.phoneDisplay) + '</a></li>\n' +
      '        <li><a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a></li>\n' +
      ((b.whatsappNumbers && b.whatsappNumbers.length)
        ? b.whatsappNumbers.map(function(wn) {
            return '        <li><a href="https://wa.me/' + esc(wn.number) + '?text=' + encodeURIComponent(b.defaultWaText || '') + '" data-wa-pos="footer" target="_blank" rel="noopener">WhatsApp (' + esc(wn.market) + ')</a></li>';
          }).join('\n') + '\n'
        : '        <li><a' + waAttrs(b) + ' data-wa-pos="footer" target="_blank" rel="noopener">Order on WhatsApp</a></li>\n') +
      '      </ul>\n    </div>\n' +
      '  </div>\n' +
      '  <div class="container footer-bottom">\n' +
      '    <span>© ' + year + ' ' + esc(b.name) + '. All rights reserved.' +
      // Empty values render nothing at all, rather than a stranded label.
      (b.fssaiNumber ? ' · FSSAI Registration No. ' + esc(b.fssaiNumber) : '') + '</span>\n' +
      '    <span>' + esc(f.bottomRight) + '</span>\n' +
      '  </div>\n</footer>\n\n' +
      '<a class="float-wa"' + waAttrs(b) + ' data-wa-pos="float" target="_blank" rel="noopener" aria-label="Chat to order on WhatsApp">\n' +
      '  ' + WA_SVG + '\n</a>\n' +
      '<button class="back-top" aria-label="Back to top">↑</button>\n\n' +
      renderOverlayHtml(data, page) +
      '<script src="/assets/js/main.js" defer></script>\n</body>\n</html>\n';
  }

  function breadcrumbs(label, parent) {
    var mid = parent
      ? '        <li><a href="' + esc(pageUrl(parent.href)) + '">' + esc(parent.label) + '</a></li>\n'
      : '';
    return '  <div class="container">\n' +
      '    <nav class="breadcrumbs" aria-label="Breadcrumb">\n' +
      '      <ol>\n        <li><a href="' + pageUrl('index.html') + '">Home</a></li>\n' +
      mid +
      '        <li aria-current="page">' + esc(label) + '</li>\n      </ol>\n' +
      '    </nav>\n  </div>\n';
  }

  function breadcrumbLd(data, name, file) {
    return {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: data.brand.siteUrl + '/' },
        { '@type': 'ListItem', position: 2, name: name, item: data.brand.siteUrl + pageUrl(file) }
      ]
    };
  }

  /* ---------- index.html ---------- */

  function renderIndex(data) {
    const b = data.brand;
    const jsonLd = ld({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization', name: b.name, url: b.siteUrl,
          logo: b.siteUrl + '/' + b.logo, foundingDate: b.foundingYear,
          description: b.orgDescription,
          sameAs: socialList(b).length ? socialList(b).map(function (s) { return s.url; }) : undefined,
          address: { '@type': 'PostalAddress', addressCountry: 'IN', addressRegion: 'Jammu & Kashmir' },
          /* One contact point per number, plus one for everywhere else.
             The email goes on all of them: it was previously attached only to
             the first, which left the India line publishing a phone number with
             no address beside it.
             The rest-of-world point exists because the shipping policy is the
             authority here and it says orders go to India, the six Gulf markets
             named below, and most other countries on request, excluding the
             European Union and the United Kingdom. Listing only the seven
             claimed a narrower service area than the site actually offers. */
          contactPoint: (function () {
            var n = waNumbers(b);
            var pts = (b.whatsappNumbers || []).map(function (wn) {
              var isUae = wn.number === n.uae;
              return {
                '@type': 'ContactPoint',
                // The UAE line takes enquiries and support; India takes orders too.
                contactType: isUae ? 'customer support' : 'sales',
                telephone: '+' + wn.number,
                // Mirrors the routing lists in main.js so schema and behaviour agree.
                areaServed: isUae ? ['AE', 'SA', 'QA', 'OM', 'KW', 'BH'] : 'IN',
                email: b.email
              };
            });
            if (n.uae) {
              pts.push({
                '@type': 'ContactPoint',
                contactType: 'customer support',
                telephone: '+' + n.uae,
                areaServed: 'Worldwide, excluding the European Union and the United Kingdom',
                email: b.email
              });
            }
            return pts.length
              ? pts
              : { '@type': 'ContactPoint', contactType: 'sales', telephone: b.phoneTel, email: b.email };
          })()
        },
        { '@type': 'WebSite', url: b.siteUrl, name: b.name },
        {
          '@type': 'FAQPage',
          mainEntity: data.faq.items.map(function (f) {
            return { '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: plainMd(f.a) } };
          })
        }
      ]
    });

    const h = data.hero;
    const minPrice = data.products.filter(function (p) { return p.status === 'available'; }).reduce(function (m, p) { return Math.min(m, p.price); }, Infinity);
    const ctaLabel = (minPrice < Infinity && h.primaryCta && h.primaryCta.label)
      ? h.primaryCta.label.replace(/from AED \d+/i, 'from AED ' + minPrice)
      : (h.primaryCta ? h.primaryCta.label : '');
    const hero =
      '  <!-- Hero -->\n  <section class="hero">\n    <div class="container hero-grid">\n      <div>\n' +
      '        <span class="eyebrow">' + esc(h.eyebrow) + '</span>\n' +
      '        <h1>' + esc(h.title) + '</h1>\n' +
      '        <p class="lead">' + esc(h.lead) + '</p>\n' +
      '        <div class="hero-cta">\n' +
      '          <a class="btn btn-primary" href="' + esc(pageUrl(h.primaryCta.href)) + '">' + esc(ctaLabel) + '</a>\n' +
      '          <a class="btn btn-whatsapp"' + waAttrs(b) + ' data-wa-pos="hero" target="_blank" rel="noopener">\n' +
      '            ' + WA_SVG + '\n            ' + esc(h.waCtaLabel) + '\n          </a>\n' +
      '        </div>\n' +
      '        <ul class="hero-points">\n' +
      h.points.map(function (p) { return '          <li>' + esc(p) + '</li>'; }).join('\n') + '\n' +
      '        </ul>\n      </div>\n' +
      '      <div class="hero-img">\n' +
      '        <img src="' + esc(asset(h.image)) + '" alt="' + esc(h.imageAlt) + '" width="600" height="600" fetchpriority="high">\n' +
      '      </div>\n    </div>\n  </section>\n';

    const w = data.whyUs;
    const why =
      '\n  <!-- Why us -->\n  <section class="section-alt">\n    <div class="container">\n' +
      '      <span class="eyebrow">' + esc(w.eyebrow) + '</span>\n' +
      '      <h2>' + esc(w.heading) + '</h2>\n      <div class="grid-4">\n' +
      w.cards.map(function (c) {
        return '        <div class="card feature-card">\n' +
          '          <div class="feature-icon" aria-hidden="true">' + esc(c.icon) + '</div>\n' +
          '          <h3>' + esc(c.title) + '</h3>\n' +
          '          <p>' + esc(c.text) + '</p>\n        </div>';
      }).join('\n') +
      '\n      </div>\n    </div>\n  </section>\n';

    const hp = data.homeProducts;
    const featured = data.products.filter(function (p) { return p.featured; }).map(productView);
    const teaser =
      '\n  <!-- Products teaser -->\n  <section>\n    <div class="container">\n' +
      '      <span class="eyebrow">' + esc(hp.eyebrow) + '</span>\n' +
      '      <h2>' + esc(hp.heading) + '</h2>\n' +
      '      <p class="section-sub">' + esc(hp.sub) + '</p>\n      <div class="grid-3">\n' +
      featured.map(function (p) {
        var phref = productHref(p);
        return '        <article class="card product-card">\n' +
          '          <div class="p-img">\n' +
          '            <a href="' + esc(phref) + '"><img src="' + esc(asset(p.image)) + '" alt="' + esc(p.imageAlt) + '" loading="lazy" width="400" height="300"></a>\n' +
          '            <span class="weight-badge">' + esc(p.badge) + '</span>\n' +
          statusBadge(p.status) + '\n          </div>\n' +
          '          <div class="p-body">\n' +
          '            <h3><a href="' + esc(phref) + '">' + esc(p.name) + '</a></h3>\n' +
          '            <p class="p-desc">' + esc(p.homeDesc || p.pageDesc) + '</p>\n' +
          productPriceHtml(p) + '\n' +
          '            ' + orderBtn(b, p, 'card') + '\n' +
          '          </div>\n        </article>';
      }).join('\n') +
      '\n      </div>\n' +
      '      <p class="center" style="margin-top:28px;"><a class="btn btn-outline" href="' + pageUrl('products.html') + '">' + esc(hp.viewAllLabel) + '</a></p>\n' +
      '    </div>\n  </section>\n';

    const hw = data.howItWorks;
    const how =
      '\n  <!-- How ordering works -->\n  <section class="section-alt">\n    <div class="container">\n' +
      '      <span class="eyebrow">' + esc(hw.eyebrow) + '</span>\n' +
      '      <h2>' + esc(hw.heading) + '</h2>\n      <div class="grid-3">\n' +
      hw.steps.map(function (s, i) {
        return '        <div class="step">\n' +
          '          <span class="step-num">' + (i + 1) + '</span>\n' +
          '          <h3>' + esc(s.title) + '</h3>\n' +
          '          <p>' + esc(s.text) + '</p>\n        </div>';
      }).join('\n') +
      '\n      </div>\n    </div>\n  </section>\n';

    const st = data.story;
    const story =
      '\n  <!-- Story -->\n  <section>\n    <div class="container hero-grid">\n' +
      '      <div class="hero-img">\n' +
      '        <img src="' + esc(asset(st.image)) + '" alt="' + esc(st.imageAlt) + '" loading="lazy" width="600" height="600">\n' +
      '      </div>\n      <div>\n' +
      '        <span class="eyebrow">' + esc(st.eyebrow) + '</span>\n' +
      '        <h2>' + esc(st.heading) + '</h2>\n' +
      st.paragraphs.map(function (p) { return '        <p>' + esc(p) + '</p>'; }).join('\n') + '\n' +
      '        <p><a href="' + esc(pageUrl(st.linkHref)) + '">' + esc(st.linkLabel) + '</a></p>\n' +
      '      </div>\n    </div>\n  </section>\n';

    const t = data.testimonials;
    const testi =
      '\n  <!-- Testimonials -->\n  <section class="section-alt">\n    <div class="container">\n' +
      '      <span class="eyebrow">' + esc(t.eyebrow) + '</span>\n' +
      '      <h2>' + esc(t.heading) + '</h2>\n      <div class="grid-3">\n' +
      t.items.map(function (q) {
        const stars = '★'.repeat(Math.max(1, Math.min(5, q.stars || 5)));
        return '        <div class="card">\n' +
          '          <div class="stars" aria-label="' + (q.stars || 5) + ' out of 5 stars">' + stars + '</div>\n' +
          '          <p class="quote">' + esc(q.quote) + '</p>\n' +
          '          <div class="quote-by">' + esc(q.name) + '</div>\n        </div>';
      }).join('\n') +
      '\n      </div>\n    </div>\n  </section>\n';

    const fq = data.faq;
    const faq =
      '\n  <!-- FAQ -->\n  <section id="faq">\n    <div class="container">\n' +
      '      <span class="eyebrow">' + esc(fq.eyebrow) + '</span>\n' +
      '      <h2>' + esc(fq.heading) + '</h2>\n' +
      '      <div class="faq" style="max-width:760px;">\n' +
      fq.items.map(function (f) {
        return '        <details>\n          <summary>' + esc(f.q) + '</summary>\n' +
          '          <p>' + inlineMd(b, f.a) + '</p>\n        </details>';
      }).join('\n') +
      '\n      </div>\n' +
      guaranteeBlock(data) +
      harvestReportLine(data) +
      '    </div>\n  </section>\n';

    const c = data.contact;
    const waContactLines = (b.whatsappNumbers && b.whatsappNumbers.length)
      ? b.whatsappNumbers.map(function(wn) {
          return '        <li>💬 WhatsApp (' + esc(wn.market) + '): <a href="https://wa.me/' + esc(wn.number) + '" data-wa-pos="contact" target="_blank" rel="noopener">+' + esc(wn.number) + '</a></li>';
        }).join('\n') + '\n'
      : '';
    const contact =
      '\n  <!-- Contact -->\n  <section class="contact-strip" id="contact">\n    <div class="container grid-2">\n' +
      '      <div>\n        <h2>' + esc(c.heading) + '</h2>\n' +
      '        <p>' + esc(c.text) + '</p>\n      </div>\n' +
      '      <ul class="contact-list">\n' +
      '        <li>📞 Phone: <a href="tel:' + esc(b.phoneTel) + '">' + esc(b.phoneDisplay) + '</a></li>\n' +
      waContactLines +
      '        <li>✉️ Email: <a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a></li>\n' +
      (socialByName(b, 'Instagram')
        ? '        <li>📸 Instagram: <a href="' + esc(socialByName(b, 'Instagram').url) + '" target="_blank" rel="noopener">@' + esc(socialHandle(socialByName(b, 'Instagram').url)) + '</a></li>\n'
        : '') +
      '        <li>📍 Origin: ' + esc(c.originLine) + '</li>\n' +
      '      </ul>\n    </div>\n  </section>\n';

    return head(data, { seoKey: 'home', file: 'index.html', jsonLd: jsonLd }, { appleIcon: true, preload: h.image }) +
      header(data, 'index.html') +
      '\n<main id="main">\n\n' + hero + why + teaser + how + story + testi + faq + contact + '\n</main>\n\n' +
      footer(data, 'index');
  }

  /* Countries the shipping policy names as routine destinations. Everywhere
     else is served on request, which schema has no way to express, so the list
     stays as the policy states it rather than claiming worldwide coverage. */
  var SHIP_COUNTRIES = ['IN', 'AE', 'SA', 'QA', 'OM', 'KW', 'BH'];

  /* Encodes the RETURNS POLICY, not the purity guarantee. They are different
     instruments: the policy is the general right of return, the guarantee is a
     conditional warranty triggered by a failed lab test. MerchantReturnPolicy
     describes the former. Do not encode the guarantee here, and do not widen
     these values to match it.

     The policy's "unopened tins only" condition has no field in
     MerchantReturnPolicy, so merchantReturnLink carries the reader to the full
     terms rather than leaving the restriction unstated. */
  function merchantReturnPolicy(b) {
    return {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: SHIP_COUNTRIES,
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: 7,                                  // "within 7 days of delivery"
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/ReturnShippingFees',     // "return shipping to us is your cost"
      refundType: 'https://schema.org/ExchangeRefund',         // "we do not give cash refunds"
      merchantReturnLink: b.siteUrl + '/returns-policy'
    };
  }

  /* Transit times from the shipping policy. shippingRate is deliberately
     omitted: the policy quotes rates on request except for free delivery in
     India over a threshold, and a made-up number would be worse than an absent
     one. Handling time is the policy's "dispatched within 2 working days". */
  function shippingDetails(b) {
    function leg(countries, minDays, maxDays) {
      return {
        '@type': 'OfferShippingDetails',
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: countries },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 2, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: minDays, maxValue: maxDays, unitCode: 'DAY' }
        }
      };
    }
    return [leg('IN', 3, 5), leg(['AE', 'SA', 'QA', 'OM', 'KW', 'BH'], 4, 6)];
  }

  /* The three saffron tins are one product at three weights, not three
     products. Stating that stops them competing with each other for the same
     query. The gift products are genuinely separate items and are not grouped.
     Returns [] rather than a node when there are fewer than two tins, so the
     group is never emitted with a single variant. */
  function mongraGroupLd(data) {
    var b = data.brand;
    var tins = (data.products || []).filter(function (p) { return p.category === 'saffron'; });
    if (tins.length < 2) return [];
    return [{
      '@type': 'ProductGroup',
      name: 'Kashmiri Mongra Saffron',
      description: 'Pure Kashmiri Mongra saffron, lab tested to ISO 3632 Category I, in three tin sizes.',
      brand: { '@type': 'Brand', name: b.name },
      productGroupID: 'mongra-tins',
      variesBy: ['https://schema.org/size'],
      hasVariant: tins.map(function (p) {
        var pv = productView(p);
        return {
          '@type': 'Product',
          name: pv.schemaName,
          sku: pv.id,
          size: pv.size,
          image: b.siteUrl + '/' + pv.image,
          url: productUrl(b, p),
          offers: {
            '@type': 'Offer', priceCurrency: 'AED',
            price: String(pv.sale && typeof pv.sale.price === 'number' ? pv.sale.price : pv.price),
            priceValidUntil: (pv.sale && pv.sale.until) ? pv.sale.until : b.priceValidUntil,
            itemCondition: 'https://schema.org/NewCondition',
            availability: statusAvailability(pv.status),
            url: productUrl(b, p),
            shippingDetails: shippingDetails(b),
            hasMerchantReturnPolicy: merchantReturnPolicy(b)
          }
        };
      })
    }];
  }

  /* ---------- products.html ---------- */

  function renderProducts(data) {
    const b = data.brand, pp = data.productsPage;
    // Listing page: ItemList pointing at each product's own page. The full
    // Product schema (with offers) lives on the individual product pages, which
    // is what Google's single-product-page rich-result guidance expects.
    const jsonLd = ld({
      '@context': 'https://schema.org',
      '@graph': [
        breadcrumbLd(data, 'Products', 'products.html'),
        {
          '@type': 'ItemList',
          itemListElement: data.products.map(function (p, i) {
            return { '@type': 'ListItem', position: i + 1, name: productView(p).schemaName, url: productUrl(b, p) };
          })
        }
      ].concat(mongraGroupLd(data) || [])
    });

    const filterBtns =
      '      <div class="filter-bar" data-filter-bar data-filter-target="#products-grid" role="group" aria-label="Filter products">\n' +
      '        <button class="filter-btn" data-filter="all" aria-pressed="true">' + esc(pp.allLabel) + '</button>\n' +
      pp.filters.map(function (f) {
        return '        <button class="filter-btn" data-filter="' + esc(f.key) + '" aria-pressed="false">' + esc(f.label) + '</button>';
      }).join('\n') + '\n      </div>\n';

    const cards = data.products.map(function (p) {
      var pv = productView(p);
      var specsArr = (p.specs || []).slice();
      if (pv.perGram && p.valueBlurb) {
        specsArr = specsArr.concat([{ label: 'Value', value: 'AED ' + pv.perGram + '/g, ' + p.valueBlurb }]);
      }
      var specs = '';
      if (specsArr.length) {
        specs = '            <details class="specs">\n              <summary>Details</summary>\n              <dl>\n' +
          specsArr.map(function (s) {
            return '                <div class="spec-row"><dt>' + esc(s.label) + '</dt><dd>' + esc(s.value) + '</dd></div>';
          }).join('\n') +
          '\n              </dl>\n            </details>\n';
      }
      var href = productHref(p);
      return '        <article class="card product-card" data-category="' + esc(pv.category) + '">\n' +
        '          <div class="p-img">\n' +
        '            <a href="' + esc(href) + '"><img src="' + esc(asset(pv.image)) + '" alt="' + esc(pv.imageAlt) + '" loading="lazy" width="400" height="300"></a>\n' +
        '            <span class="weight-badge">' + esc(pv.badge) + '</span>\n' +
        statusBadge(pv.status) + '\n          </div>\n' +
        '          <div class="p-body">\n' +
        '            <h3><a href="' + esc(href) + '">' + esc(pv.name) + '</a></h3>\n' +
        '            <p class="p-desc">' + esc(pv.pageDesc) + '</p>\n' +
        productPriceHtml(pv) + '\n' +
        '            ' + orderBtn(b, pv, 'card') + '\n' +
        '            <a class="p-detail-link" href="' + esc(href) + '">View details →</a>\n' +
        specs +
        '          </div>\n        </article>';
    }).join('\n\n');

    const compareRows = data.products.filter(function (p) { return p.compare; }).map(function (p) {
      var pv = productView(p);
      var perGram = pv.perGram ? 'AED ' + pv.perGram + '/g' : 'n/a';
      return '            <tr><td>' + esc(pv.name) + '</td><td>AED ' + esc(pv.price) + '</td><td>' + perGram + '</td><td>' + esc(pv.compare.servings) + '</td><td>' + esc(pv.compare.bestFor) + '</td></tr>';
    }).join('\n');

    const compare =
      '\n  <!-- Size comparison -->\n  <section class="section-alt">\n    <div class="container">\n' +
      '      <span class="eyebrow">' + esc(pp.compare.eyebrow) + '</span>\n' +
      '      <h2>' + esc(pp.compare.heading) + '</h2>\n' +
      '      <div class="table-wrap">\n        <table class="compare">\n          <thead>\n' +
      '            <tr><th scope="col">Tin</th><th scope="col">Price</th><th scope="col">Per gram</th><th scope="col">Servings</th><th scope="col">Best for</th></tr>\n' +
      '          </thead>\n          <tbody>\n' + compareRows + '\n          </tbody>\n        </table>\n      </div>\n' +
      '    </div>\n  </section>\n';

    const idn = pp.identify;
    const identify =
      '\n  <!-- Identify real saffron -->\n  <section id="identify">\n    <div class="container">\n' +
      '      <span class="eyebrow">' + esc(idn.eyebrow) + '</span>\n' +
      '      <h2>' + esc(idn.heading) + '</h2>\n' +
      '      <p class="section-sub">' + esc(idn.sub) + '</p>\n      <div class="grid-3">\n' +
      idn.steps.map(function (s, i) {
        return '        <div class="step">\n          <span class="step-num">' + (i + 1) + '</span>\n' +
          '          <h3>' + esc(s.title) + '</h3>\n          <p>' + esc(s.text) + '</p>\n        </div>';
      }).join('\n') +
      '\n      </div>\n' +
      '      <p style="margin-top:24px;"><a href="' + esc(pageUrl(idn.footerLink.href)) + '">' + esc(idn.footerLink.label) + '</a></p>\n' +
      '    </div>\n  </section>\n';

    const del = pp.delivery;
    const delivery =
      '\n  <!-- Delivery & payment -->\n  <section class="section-alt">\n    <div class="container">\n' +
      '      <span class="eyebrow">' + esc(del.eyebrow) + '</span>\n' +
      '      <h2>' + esc(del.heading) + '</h2>\n      <div class="grid-3">\n' +
      del.cards.map(function (c) {
        return '        <div class="card feature-card">\n' +
          '          <div class="feature-icon" aria-hidden="true">' + esc(c.icon) + '</div>\n' +
          '          <h3>' + esc(c.title) + '</h3>\n' +
          '          <p>' + inlineMd(b, c.text) + '</p>\n        </div>';
      }).join('\n') +
      '\n      </div>\n    </div>\n  </section>\n';

    return head(data, { seoKey: 'products', file: 'products.html', jsonLd: jsonLd }) +
      header(data, 'products.html') +
      '\n<main id="main">\n' + breadcrumbs('Products') +
      '\n  <section style="padding-top:24px;">\n    <div class="container">\n' +
      '      <h1>' + esc(pp.h1) + '</h1>\n' +
      '      <p class="section-sub">' + esc(pp.sub) + '</p>\n\n' +
      filterBtns + '\n      <div class="grid-3" id="products-grid">\n' + cards + '\n      </div>\n' +
      '    </div>\n  </section>\n' +
      compare + identify + delivery + '</main>\n\n' +
      footer(data, 'products');
  }

  /* ---------- product detail pages (products/<slug>/) ---------- */

  function productDetailLd(data, p) {
    var b = data.brand, pv = productView(p), url = productUrl(b, p);
    return ld({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: b.siteUrl + '/' },
            { '@type': 'ListItem', position: 2, name: 'Products', item: b.siteUrl + pageUrl('products.html') },
            { '@type': 'ListItem', position: 3, name: pv.schemaName, item: url }
          ]
        },
        {
          '@type': 'Product', name: pv.schemaName,
          sku: pv.id,
          image: b.siteUrl + '/' + pv.image,
          description: pv.schemaDesc,
          brand: { '@type': 'Brand', name: b.name },
          offers: {
            '@type': 'Offer', priceCurrency: 'AED',
            price: String(pv.sale && typeof pv.sale.price === 'number' ? pv.sale.price : pv.price),
            // A sale end date wins; otherwise the standing date from brand.
            // Never compute this: a rolling date would change every build and
            // break the output-drift check.
            priceValidUntil: (pv.sale && pv.sale.until) ? pv.sale.until : b.priceValidUntil,
            itemCondition: 'https://schema.org/NewCondition',
            availability: statusAvailability(pv.status), url: url,
            shippingDetails: shippingDetails(b),
            hasMerchantReturnPolicy: merchantReturnPolicy(b)
          }
        }
      ]
    });
  }

  function renderProductDetail(data, p) {
    var b = data.brand, pv = productView(p);
    var url = productUrl(b, p);
    var seo = {
      title: 'Buy ' + pv.schemaName + ' | ' + b.name,
      description: (p.descBody || pv.schemaDesc) + ' From AED ' + pv.price + '. Order on WhatsApp.',
      ogTitle: pv.schemaName + ' | ' + b.name,
      ogDescription: p.descBody || pv.schemaDesc
    };

    var specsArr = (p.specs || []).slice();
    if (pv.perGram && p.valueBlurb) {
      specsArr = specsArr.concat([{ label: 'Value', value: 'AED ' + pv.perGram + '/g, ' + p.valueBlurb }]);
    }
    var specs = '';
    if (specsArr.length) {
      specs = '        <div class="pd-specs">\n          <h2>Details</h2>\n          <dl class="spec-list">\n' +
        specsArr.map(function (s) {
          return '            <div class="spec-row"><dt>' + esc(s.label) + '</dt><dd>' + esc(s.value) + '</dd></div>';
        }).join('\n') +
        '\n          </dl>\n        </div>\n';
    }

    var hero =
      '\n  <section style="padding-top:24px;">\n    <div class="container product-detail">\n' +
      '      <div class="pd-media">\n' +
      '        <img src="' + esc(asset(pv.image)) + '" alt="' + esc(pv.imageAlt) + '" width="600" height="600" fetchpriority="high">\n' +
      statusBadge(pv.status) + '\n      </div>\n' +
      '      <div class="pd-info">\n' +
      '        <h1>' + esc(pv.name) + '</h1>\n' +
      '        <p class="pd-desc">' + esc(p.descBody || pv.pageDesc) + '</p>\n' +
      harvestReportLine(data) +
      '        ' + productPriceHtml(pv) + '\n' +
      '        ' + orderBtn(b, pv, 'detail') + '\n' +
      specs +
      guaranteeBlock(data) +
      '        <p class="pd-links"><a href="' + pageUrl('products.html#identify') + '">How to spot real saffron</a> · <a href="' + pageUrl('recipes.html') + '">Saffron recipes</a></p>\n' +
      /* The graded saffron tins carry the two claims a buyer checks: which
         grade this is, and what the lab report behind the purity guarantee
         actually says. The gift products make neither claim, so they do not
         get these links. */
      (p.category === 'saffron'
        ? '        <p class="pd-links"><a href="/blog/grade-names/">What Mongra grade means</a> · <a href="/blog/read-lab-report/">How to read our lab report</a></p>\n'
        : '') +
      '      </div>\n    </div>\n  </section>\n';

    var others = data.products.filter(function (x) { return productSlug(x) !== productSlug(p); });
    var related =
      '\n  <section class="section-alt">\n    <div class="container">\n' +
      '      <h2>More from ' + esc(b.name) + '</h2>\n      <ul class="related-products">\n' +
      others.map(function (x) {
        var xv = productView(x);
        return '        <li><a href="' + productHref(x) + '">' + esc(xv.name) + ' - AED ' + esc(xv.price) + '</a></li>';
      }).join('\n') +
      '\n      </ul>\n      <p><a href="' + pageUrl('products.html') + '">← Back to all products</a></p>\n' +
      '    </div>\n  </section>\n';

    return head(data, { seo: seo, url: url, ogImage: p.image, jsonLd: productDetailLd(data, p) }, { appleIcon: true }) +
      header(data, 'products.html') +
      '\n<main id="main">\n' + breadcrumbs(pv.name, { label: 'Products', href: 'products.html' }) +
      hero + related + '</main>\n\n' +
      footer(data, 'product-detail');
  }

  /* ---------- recipes.html ---------- */

  // Short name for a HowToStep, summarised from the step's own opening clause.
  // Nothing is invented: it is the first sentence, shortened at a comma when
  // that sentence runs long. Never cut mid-phrase.
  function stepName(s) {
    var t = plainMd(String(s || '')).trim();
    var m = t.match(/^[^.;]+/);
    t = (m ? m[0] : t).trim();
    if (t.split(/\s+/).length > 9) {
      var c = t.split(',')[0].trim();
      if (c.split(/\s+/).length >= 3) t = c;
    }
    return t.replace(/[\s,;:-]+$/, '');
  }

  // Anchor for one step, so the HowToStep url resolves to real markup.
  function stepAnchor(r, i) { return r.id + '-step-' + (i + 1); }

  function renderRecipes(data) {
    const b = data.brand, rp = data.recipesPage;
    const jsonLd = ld({
      '@context': 'https://schema.org',
      '@graph': [breadcrumbLd(data, 'Recipes', 'recipes.html')].concat(
        data.recipes.map(function (r) {
          return {
            '@type': 'Recipe', name: r.schemaName || r.name,
            image: b.siteUrl + '/' + r.image,
            description: r.schemaDesc || r.cardDesc,
            inLanguage: 'en',
            recipeCategory: r.recipeCategory || undefined,
            totalTime: r.totalISO, recipeYield: r.yield, recipeCuisine: r.cuisine,
            recipeIngredient: r.ingredients.map(plainMd),
            keywords: r.keywords || undefined,
            recipeInstructions: r.steps.map(function (s, i) {
              return {
                '@type': 'HowToStep',
                name: stepName(s),
                text: plainMd(s),
                url: b.siteUrl + pageUrl('recipes.html') + '#' + stepAnchor(r, i)
              };
            }),
            // DELIBERATELY ABSENT, do not "fix" these:
            //   aggregateRating - we have no real reviews. Fabricated rating
            //     markup risks a Google manual action and CLAUDE.md forbids it.
            //   nutrition - estimated calorie figures presented as structured
            //     data would be invented. Add only after real per-recipe
            //     calculation.
            //   video, and per-step image - the media does not exist. Do not
            //     substitute stock or placeholder assets.
            // Google reports all three as "missing" non-critical items. That is
            // expected and accepted.
            author: { '@type': 'Organization', name: b.name }
          };
        })
      )
    });

    const cards = data.recipes.map(function (r, i) {
      return '        <!-- ' + (i + 1) + '. ' + r.name + ' -->\n' +
        '        <article class="card recipe-card">\n' +
        '          <div class="p-img"><img src="' + esc(asset(r.image)) + '" alt="' + esc(r.imageAlt) + '" loading="lazy" width="400" height="250"></div>\n' +
        '          <div class="recipe-body">\n' +
        '            <div class="recipe-meta"><span>⏱ ' + esc(r.timeLabel) + '</span><span>' + esc(r.cuisineLabel) + '</span><span>' + esc(r.servesLabel) + '</span></div>\n' +
        '            <h2 style="font-size:22px;margin:0;">' + esc(r.name) + '</h2>\n' +
        '            <p>' + esc(r.cardDesc) + '</p>\n' +
        '            <details class="recipe-detail">\n' +
        '              <summary>View full recipe</summary>\n' +
        '              <h4>Ingredients</h4>\n              <ul>\n' +
        r.ingredients.map(function (x) { return '                <li>' + inlineMd(b, x) + '</li>'; }).join('\n') +
        '\n              </ul>\n              <h4>Method</h4>\n              <ol>\n' +
        r.steps.map(function (x, i) {
          // id matches the HowToStep url in the Recipe JSON-LD above.
          return '                <li id="' + esc(stepAnchor(r, i)) + '">' + inlineMd(b, x) + '</li>';
        }).join('\n') +
        '\n              </ol>\n' +
        (r.tip ? '              <p class="recipe-tip">' + inlineMd(b, r.tip) + '</p>\n' : '') +
        '              <button class="print-btn" type="button">🖨 Print recipe</button>\n' +
        '            </details>\n          </div>\n        </article>';
    }).join('\n\n');

    const g = rp.golden;
    const golden =
      '\n  <!-- Golden rule -->\n  <section class="section-alt">\n    <div class="container center">\n' +
      '      <span class="eyebrow">' + esc(g.eyebrow) + '</span>\n' +
      '      <h2>' + esc(g.heading) + '</h2>\n' +
      '      <p class="section-sub">' + esc(g.sub) + '</p>\n      <p>\n' +
      '        <a class="btn btn-primary" href="' + esc(pageUrl(g.primary.href)) + '">' + esc(g.primary.label) + '</a>\n' +
      '        &nbsp;\n' +
      '        <a class="btn btn-outline" href="' + esc(pageUrl(g.secondary.href)) + '">' + esc(g.secondary.label) + '</a>\n' +
      '      </p>\n    </div>\n  </section>\n';

    return head(data, { seoKey: 'recipes', file: 'recipes.html', jsonLd: jsonLd }) +
      header(data, 'recipes.html') +
      '\n<main id="main">\n' + breadcrumbs('Recipes') +
      '\n  <section style="padding-top:24px;">\n    <div class="container">\n' +
      '      <h1>' + esc(rp.h1) + '</h1>\n' +
      '      <p class="section-sub">' + esc(rp.sub) + '</p>\n\n      <div class="grid-3">\n\n' +
      cards + '\n\n      </div>\n    </div>\n  </section>\n' +
      golden + '</main>\n\n' +
      footer(data, 'recipes');
  }

  /* ---------- blogs.html ---------- */

  // Published posts only. draft:true keeps a post in the data but off the site.
  // Single gate for the index cards, the post pages, the sitemap and llms.txt.
  /* Newest first. Nine posts share 2026-08-29, so the tiebreak is explicit:
     posts with the same date keep their order in the data file. The decorate
     and undecorate around the sort makes that deliberate rather than relying
     on the engine's sort being stable.

     Order matters to two consumers. blogs.html lists posts in this order, and
     the related-posts fallback fills from it. sitemap.xml, llms.txt and the
     page-emission loop are unaffected beyond the order their entries appear
     in; each emits one entry per post either way. */
  /* The date a post last said something new. Sorting on this puts a rewritten
     post back at the top of the index instead of leaving it at its original
     publication position, which is where a 1,000-word merge would otherwise
     sit below the thinnest pages on the site. */
  function postDate(p) { return p.dateModified || p.dateISO; }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  /* ISO to "September 1, 2026", without toLocaleDateString: that depends on the
     host's ICU data and would render differently under Node and the browser,
     and templates.js has to produce identical output in both. */
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return MONTHS[parseInt(m[2], 10) - 1] + ' ' + parseInt(m[3], 10) + ', ' + m[1];
  }

  /* The meta line. A post that has been revised shows the revision date, since
     that is what the reader is looking at. The post page also keeps the
     original publication date, so neither is hidden. Structured data is
     untouched: datePublished stays dateISO and dateModified stays dateModified,
     so nothing here becomes a claim the schema does not make. */
  function postMeta(p, catLabel, withPublished) {
    var cat = '<span class="cat">' + esc(catLabel[p.categoryKey] || p.categoryKey) + '</span>';
    var published = '<time datetime="' + esc(p.dateISO) + '">' + esc(p.dateDisplay) + '</time>';
    if (!p.dateModified) return '<div class="blog-meta">' + cat + published + '</div>';
    var updated = '<time datetime="' + esc(p.dateModified) + '">Updated ' +
      esc(fmtDate(p.dateModified)) + '</time>';
    return '<div class="blog-meta">' + cat +
      (withPublished ? published + updated : updated) + '</div>';
  }

  function livePosts(data) {
    return (data.posts || [])
      .filter(function (p) { return !p.draft; })
      .map(function (p, i) { return { post: p, seq: i }; })
      .sort(function (a, b) {
        var ka = postDate(a.post), kb = postDate(b.post);
        if (ka === kb) return a.seq - b.seq;
        return ka < kb ? 1 : -1;
      })
      .map(function (x) { return x.post; });
  }

  var RELATED_COUNT = 3;

  /* Curated `related` ids first, in the order given. If a post has none, or
     too few, fill from the same category and then from anything else, both
     newest first because livePosts is sorted. Never array order, never empty,
     never the post itself. tools/check_related.py fails the build on a
     reference that does not resolve to a live post, on a self-reference, and
     on a reference to a draft. */
  function relatedPosts(data, p) {
    var live = livePosts(data);
    var self = postSlug(p);
    var byId = {};
    live.forEach(function (x) { byId[x.id] = x; });

    var out = [];
    function add(x) {
      if (!x || postSlug(x) === self) return;
      if (out.indexOf(x) !== -1) return;
      if (out.length < RELATED_COUNT) out.push(x);
    }
    (p.related || []).forEach(function (id) { add(byId[id]); });
    live.forEach(function (x) { if (x.categoryKey === p.categoryKey) add(x); });
    live.forEach(add);
    return out;
  }

  // Shared by the blog index and every post page.
  function blogSidebar(data) {
    var b = data.brand, sb = data.blogPage.sidebar;
    // Cheapest saffron that can actually be ordered. Do not reintroduce a
    // hardcoded id here: it would ignore status and could advertise a product
    // that is out of stock.
    var raw = data.products
      .filter(function (p) { return p.category === 'saffron' && p.status === 'available'; })
      .sort(function (x, y) { return x.price - y.price; })[0];
    var pv = raw ? productView(raw) : null;
    var priceHtml = pv
      ? '<span data-price="' + esc(pv.price) + '">AED ' + esc(pv.price) + '</span> <span>/ ' + esc(pv.size) + ' tin</span>'
      : 'AED ' + esc(sb.priceAmount) + ' <span>' + esc(sb.priceUnit) + '</span>';
    return '        <aside class="sidebar" aria-label="Blog sidebar">\n' +
      '          <div class="card">\n' +
      '            <h3>' + esc(sb.orderHeading) + '</h3>\n' +
      '            <p style="color:var(--muted);font-size:15px;margin:8px 0 4px;">' + esc(sb.orderText) + '</p>\n' +
      '            <div class="p-price" style="margin-bottom:12px;">' + priceHtml + '</div>\n' +
      '            <a class="btn btn-whatsapp" style="width:100%;"' + waAttrs(b, sb.waText) + ' data-wa-pos="sidebar" target="_blank" rel="noopener">' + esc(sb.waLabel) + '</a>\n' +
      '          </div>\n' +
      '          <div class="card">\n' +
      '            <h3>' + esc(sb.alsoHeading) + '</h3>\n            <ul>\n' +
      sb.links.map(function (l) { return '              <li><a href="' + esc(pageUrl(l.href)) + '">' + esc(l.label) + '</a></li>'; }).join('\n') +
      '\n            </ul>\n          </div>\n        </aside>\n';
  }

  function renderBlogs(data) {
    const b = data.brand, bp = data.blogPage;
    const catLabel = {};
    bp.categories.forEach(function (c) { catLabel[c.key] = c.postLabel || c.label; });
    // A post with draft:true is written but not published: no card, no
    // JSON-LD, no llms.txt entry. Seasonal posts sit here until their window.
    const posts = livePosts(data);

    // The index is now a listing. Each post carries its own BlogPosting on its
    // own page, so this is a Blog with an item list rather than 13 postings.
    const jsonLd = ld({
      '@context': 'https://schema.org',
      '@graph': [
        breadcrumbLd(data, 'Blog', 'blogs.html'),
        {
          '@type': 'Blog', name: bp.h1, url: b.siteUrl + pageUrl('blogs.html'),
          publisher: { '@type': 'Organization', name: b.name },
          // Links only. Every post carries its own full BlogPosting on its own
          // page, so repeating headline, date and description here is weight
          // for nothing.
          blogPost: posts.map(function (p) {
            return { '@type': 'BlogPosting', headline: p.title, url: postUrl(b, p) };
          })
        }
      ]
    });

    const filterBtns =
      '      <div class="filter-bar" data-filter-bar data-filter-target="#blog-list" role="group" aria-label="Filter articles">\n' +
      '        <button class="filter-btn" data-filter="all" aria-pressed="true">' + esc(bp.allLabel) + '</button>\n' +
      bp.categories.map(function (c) {
        return '        <button class="filter-btn" data-filter="' + esc(c.key) + '" aria-pressed="false">' + esc(c.label) + '</button>';
      }).join('\n') + '\n      </div>\n';

    const articles = posts.map(function (p) {
      // id kept on the card on purpose: old /blogs#<slug> links still land here.
      // Fragments never reach the server, so an edge redirect for them is
      // impossible. This is the redirect.
      return '          <article class="card blog-card" data-category="' + esc(p.categoryKey) + '" id="' + esc(p.id) + '">\n' +
        (p.image ? '            <div class="blog-img"><a href="' + esc(postHref(p)) + '"><img src="' + esc(asset(p.image)) + '" alt="' + esc(p.imageAlt || p.title) + '" loading="lazy" width="800" height="450"></a></div>\n' : '') +
        '            ' + postMeta(p, catLabel, false) + '\n' +
        '            <h2><a href="' + esc(postHref(p)) + '">' + esc(p.title) + '</a></h2>\n' +
        '            <p class="excerpt">' + esc(p.excerpt) + '</p>\n' +
        '            <p class="read-more"><a href="' + esc(postHref(p)) + '">Read full article</a></p>\n' +
        '          </article>';
    }).join('\n\n');

    const sidebar = blogSidebar(data);

    return head(data, { seoKey: 'blog', file: 'blogs.html', jsonLd: jsonLd }) +
      header(data, 'blogs.html') +
      '\n<main id="main">\n' + breadcrumbs('Blog') +
      '\n  <section style="padding-top:24px;">\n    <div class="container">\n' +
      '      <h1>' + esc(bp.h1) + '</h1>\n' +
      '      <p class="section-sub">' + esc(bp.sub) + '</p>\n\n' +
      filterBtns + '\n      <div class="blog-layout">\n        <div id="blog-list">\n\n' +
      articles + '\n\n        </div>\n\n' + sidebar +
      '      </div>\n    </div>\n  </section>\n</main>\n\n' +
      footer(data, 'blogs');
  }

  // One page per post at /blog/<slug>/, built on the renderProductDetail shape.
  function renderPostPage(data, p) {
    var b = data.brand, bp = data.blogPage;
    var url = postUrl(b, p);
    var catLabel = {};
    bp.categories.forEach(function (c) { catLabel[c.key] = c.postLabel || c.label; });
    var seo = {
      title: p.metaTitle || (p.title + ' | ' + b.name),
      description: p.metaDescription || p.excerpt,
      ogTitle: p.metaTitle || p.title,
      ogDescription: p.metaDescription || p.excerpt
    };
    var jsonLd = ld({
      '@context': 'https://schema.org',
      '@graph': [
        breadcrumbLd(data, p.title, postPath(p)),
        {
          '@type': 'BlogPosting', headline: p.title,
          image: p.image ? b.siteUrl + '/' + p.image : undefined,
          datePublished: p.dateISO, dateModified: p.dateModified || p.dateISO,
          description: p.excerpt, inLanguage: 'en',
          articleSection: catLabel[p.categoryKey] || p.categoryKey,
          author: { '@type': 'Organization', name: b.name },
          publisher: { '@type': 'Organization', name: b.name, logo: { '@type': 'ImageObject', url: b.siteUrl + '/' + b.logo } },
          mainEntityOfPage: url, url: url
        }
      ]
    });
    var others = relatedPosts(data, p);
    var more = others.length
      ? '\n  <section class="section-alt">\n    <div class="container">\n' +
        '      <h2>More from the blog</h2>\n      <ul class="related-products">\n' +
        others.map(function (x) {
          return '        <li><a href="' + esc(postHref(x)) + '">' + esc(x.title) + '</a></li>';
        }).join('\n') +
        '\n      </ul>\n    </div>\n  </section>\n'
      : '';
    return head(data, { seo: seo, url: url, ogImage: p.image, jsonLd: jsonLd }, { appleIcon: true }) +
      header(data, 'blogs.html') +
      '\n<main id="main">\n' + breadcrumbs(p.title, { label: 'Blog', href: 'blogs.html' }) +
      '\n  <section style="padding-top:24px;">\n    <div class="container">\n' +
      '      <div class="blog-layout">\n        <article class="blog-post">\n' +
      (p.image ? '          <div class="blog-img"><img src="' + esc(asset(p.image)) + '" alt="' + esc(p.imageAlt || p.title) + '" width="800" height="450" fetchpriority="high"></div>\n' : '') +
      '          ' + postMeta(p, catLabel, true) + '\n' +
      '          <h1>' + esc(p.title) + '</h1>\n' +
      '          <p class="excerpt">' + esc(p.excerpt) + '</p>\n' +
      bodyWithChecker(data, p) + '\n' +
      '          <p class="pd-links"><a href="' + pageUrl('blogs.html') + '">All articles</a></p>\n' +
      '        </article>\n\n' + blogSidebar(data) +
      '      </div>\n    </div>\n  </section>\n' + more + '</main>\n\n' +
      footer(data, 'blog-post');
  }

  /* ---------- 404.html & sitemap.xml ---------- */

  function render404(data) {
    const n = data.notFound, b = data.brand;
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      '  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <title>Page Not Found | ' + esc(b.name) + '</title>\n' +
      '  <meta name="robots" content="noindex">\n' +
      '  <link rel="icon" type="image/webp" href="' + esc(asset(b.favicon)) + '">\n' +
      '  <link rel="stylesheet" href="/assets/css/style.css">\n</head>\n<body>\n' +
      '<main style="min-height:70vh;display:flex;align-items:center;">\n' +
      '  <div class="container center">\n' +
      '    <h1>' + esc(n.title) + '</h1>\n' +
      '    <p class="section-sub" style="margin:0 auto 24px;">' + esc(n.text) + '</p>\n' +
      '    <p>\n      <a class="btn btn-primary" href="' + esc(pageUrl(n.primary.href)) + '">' + esc(n.primary.label) + '</a>\n' +
      '      &nbsp;\n      <a class="btn btn-outline" href="' + esc(pageUrl(n.secondary.href)) + '">' + esc(n.secondary.label) + '</a>\n' +
      '    </p>\n  </div>\n</main>\n\n' +
      footer(data, '404');
  }

  // Body for one policy section. Blank lines separate paragraphs; a block whose
  // every line starts with "- " becomes a list. Kept separate from bodyToHtml so
  // blog rendering is untouched.
  function policyBody(brand, body) {
    var blocks = String(body || '').replace(/\r\n/g, '\n').split(/\n\s*\n/);
    return blocks.map(function (blk) {
      blk = blk.trim();
      if (!blk) return '';
      var lines = blk.split('\n');
      var allBullets = lines.every(function (l) { return /^-\s+/.test(l.trim()); });
      if (allBullets) {
        return '      <ul>\n' + lines.map(function (l) {
          return '        <li>' + inlineMd(brand, l.trim().replace(/^-\s+/, '')) + '</li>';
        }).join('\n') + '\n      </ul>';
      }
      return '      <p>' + inlineMd(brand, blk.replace(/\n/g, ' ')) + '</p>';
    }).filter(Boolean).join('\n');
  }

  // One renderer for every policy page, driven entirely by data.policies[key].
  function renderPolicyPage(data, key) {
    var b = data.brand;
    var p = (data.policies || {})[key];
    if (!p) return '';
    var url = b.siteUrl + pageUrl(p.slug);
    var jsonLd = ld({ '@context': 'https://schema.org', '@type': 'WebPage', name: p.title, url: url, publisher: { '@type': 'Organization', name: b.name } });
    var gaBlock = b.gaId
      ? '  <script async src="https://www.googletagmanager.com/gtag/js?id=' + esc(b.gaId) + '"></script>\n' +
        '  <script>\n    window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}\n' +
        "    gtag('js',new Date());gtag('config','" + b.gaId + "');\n  </script>\n"
      : '';
    return '<!DOCTYPE html>\n<html lang="en" dir="ltr">\n<head>\n' +
      '  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <title>' + esc(p.metaTitle || (p.title + ' | ' + b.name)) + '</title>\n' +
      '  <meta name="description" content="' + esc(p.metaDescription || '') + '">\n' +
      '  <meta name="robots" content="index, follow">\n' +
      '  <link rel="canonical" href="' + esc(url) + '">\n' +
      '  <meta property="og:type" content="website">\n' +
      '  <meta property="og:title" content="' + esc(p.metaTitle || p.title) + '">\n' +
      '  <meta property="og:description" content="' + esc(p.metaDescription || '') + '">\n' +
      '  <meta property="og:url" content="' + esc(url) + '">\n' +
      '  <link rel="icon" type="image/webp" href="' + esc(asset(b.favicon)) + '">\n' +
      '  <link rel="stylesheet" href="/assets/css/style.css">\n' +
      gaBlock +
      jsonLd + '\n</head>\n' +
      header(data, '') +
      '\n<main id="main">\n' + breadcrumbs(p.title) +
      '\n  <section style="padding-top:24px;">\n    <div class="container" style="max-width:760px;">\n' +
      '      <h1>' + esc(p.title) + '</h1>\n' +
      '      <p style="color:var(--muted);font-size:14px;">Last updated: ' + esc(p.lastUpdated) + '</p>\n\n' +
      (p.sections || []).map(function (sec) {
        return (sec.heading ? '      <h2>' + esc(sec.heading) + '</h2>\n' : '') + policyBody(b, sec.body);
      }).join('\n\n') + '\n' +
      '    </div>\n  </section>\n</main>\n\n' +
      footer(data, key);
  }

  // Named entry point kept because the admin preview map calls it.
  function renderPrivacyPolicy(data) {
    return renderPolicyPage(data, 'privacy');
  }

  function renderSitemap(data, dateStr) {
    // lastmod tracks the content, not the build clock, so a rebuild on any
    // later day does not churn the sitemap.
    const published = String((data.meta && data.meta.lastPublished) || '');
    const d = dateStr || (/^\d{4}-\d{2}-\d{2}/.test(published)
      ? published.slice(0, 10)
      : new Date(published || Date.now()).toISOString().slice(0, 10));
    const u = data.brand.siteUrl;
    function url(loc, freq, pri) {
      return '  <url>\n    <loc>' + loc + '</loc>\n    <lastmod>' + d + '</lastmod>\n' +
        '    <changefreq>' + freq + '</changefreq>\n    <priority>' + pri + '</priority>\n  </url>';
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      url(u + pageUrl('index.html'), 'weekly', '1.0') + '\n' +
      url(u + pageUrl('products.html'), 'weekly', '0.9') + '\n' +
      data.products.map(function (p) { return url(productUrl(data.brand, p), 'monthly', '0.8'); }).join('\n') + '\n' +
      url(u + pageUrl('recipes.html'), 'monthly', '0.8') + '\n' +
      url(u + pageUrl('blogs.html'), 'monthly', '0.8') + '\n' +
      livePosts(data).map(function (p) { return url(postUrl(data.brand, p), 'monthly', '0.6'); }).join('\n') + '\n' +
      Object.keys(data.policies || {}).map(function (k) {
        return url(u + pageUrl(data.policies[k].slug), 'yearly', '0.3');
      }).join('\n') + '\n' +
      '</urlset>\n';
  }

  function renderLlms(data) {
    var b = data.brand;
    var u = b.siteUrl;

    // Product and recipe names come from the data, not a hardcoded list, so this
    // file cannot drift out of step with the catalogue the way it had.
    function commaList(items) {
      if (items.length < 2) return items.join('');
      return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
    }
    var names = (data.products || []).map(function (p) { return productView(p); });
    function withStatus(s) {
      return names.filter(function (p) {
        // Same convention as statusAvailability: anything else counts as in stock.
        return s === 'available'
          ? (p.status !== 'out_of_stock' && p.status !== 'coming_soon')
          : p.status === s;
      }).map(function (p) { return p.name; });
    }
    var inStock = withStatus('available');
    var outOfStock = withStatus('out_of_stock');
    var comingSoon = withStatus('coming_soon');
    var catalogue = 'Full product catalogue.';
    if (inStock.length) catalogue += ' In stock: ' + commaList(inStock) + '.';
    if (outOfStock.length) catalogue += ' Out of stock: ' + commaList(outOfStock) + '.';
    if (comingSoon.length) catalogue += ' Coming soon: ' + commaList(comingSoon) + '.';
    var recipeNames = commaList((data.recipes || []).map(function (r) { return r.name; }));
    var postLines = livePosts(data).map(function (p) {
      return '- [' + p.title + '](' + postUrl(b, p) + '): ' + (p.metaDescription || p.excerpt);
    }).join('\n');

    return '# ' + b.name + '\n\n' +
      '> ' + b.orgDescription + '\n\n' +
      '## Pages\n\n' +
      '- [Home](' + u + pageUrl('index.html') + '): Products, ordering information, FAQ, and the brand story.\n' +
      '- [Products](' + u + pageUrl('products.html') + '): ' + catalogue + '\n' +
      '- [Recipes](' + u + pageUrl('recipes.html') + '): Tested saffron recipes: ' + recipeNames + '.\n' +
      '- [Blog](' + u + pageUrl('blogs.html') + '): Index of every article below.\n' +
      Object.keys(data.policies || {}).map(function (k) {
        var pol = data.policies[k];
        return '- [' + pol.title + '](' + u + pageUrl(pol.slug) + '): ' + pol.metaDescription;
      }).join('\n') + '\n' +
      (postLines ? '\n## Articles\n\n' + postLines + '\n' : '');
  }

  /* ---------- public API ---------- */

  function renderAll(data) {
    var out = {
      'index.html': renderIndex(data),
      'products.html': renderProducts(data),
      'recipes.html': renderRecipes(data),
      'blogs.html': renderBlogs(data),
      '404.html': render404(data),
      'sitemap.xml': renderSitemap(data),
      'llms.txt': renderLlms(data),
      // Published alongside everything else, so the live id always matches the
      // templates that produced the live pages. The admin reads this back
      // before publishing.
      'build-id.json': JSON.stringify({ buildId: BUILD_ID }) + '\n'
    };
    // Every policy page comes from the same renderer, keyed by its slug.
    Object.keys(data.policies || {}).forEach(function (k) {
      out[data.policies[k].slug] = renderPolicyPage(data, k);
    });
    (data.products || []).forEach(function (p) {
      out[productPath(p) + 'index.html'] = renderProductDetail(data, p);
    });
    // Drafts emit no page at all, same gate as the index and the sitemap.
    livePosts(data).forEach(function (p) {
      out[postPath(p) + 'index.html'] = renderPostPage(data, p);
    });
    return out;
  }

  return {
    BUILD_ID: BUILD_ID,
    esc: esc, waUrl: waUrl, waAttrs: waAttrs, waNumbers: waNumbers, inlineMd: inlineMd, plainMd: plainMd,
    productView: productView, productSlug: productSlug, productUrl: productUrl,
    renderIndex: renderIndex, renderProducts: renderProducts,
    renderProductDetail: renderProductDetail,
    renderRecipes: renderRecipes, renderBlogs: renderBlogs,
    renderPostPage: renderPostPage, postSlug: postSlug, postUrl: postUrl,
    checkerHtml: checkerHtml, bodyWithChecker: bodyWithChecker,
    render404: render404, renderSitemap: renderSitemap,
    renderLlms: renderLlms, renderPrivacyPolicy: renderPrivacyPolicy,
    renderPolicyPage: renderPolicyPage,
    renderOverlayHtml: renderOverlayHtml, renderAll: renderAll,
    socialIconNames: socialIconNames
  };
}));
