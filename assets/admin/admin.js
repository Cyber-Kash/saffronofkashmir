/* ============================================================
   Saffron of Kashmir — Admin app
   Edits data/site-data.json, regenerates the site via
   SOKTemplates, and publishes through the GitHub Contents API.
   No build tools, no server — works from the hosted site or
   from a local copy of this folder.
   ============================================================ */
(function () {
  'use strict';

  const A = SOKTemplates.esc;            // attribute/HTML escaper
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  /* Platform names that render a footer icon. Source of truth is SOCIAL_ICONS
     in assets/admin/templates.js; the literal list is only a fallback for the
     case where templates.js predates the socialIconNames() export. */
  const SOCIAL_ICON_NAMES = (typeof SOKTemplates.socialIconNames === 'function')
    ? SOKTemplates.socialIconNames()
    : ['instagram', 'facebook', 'tiktok', 'pinterest', 'linkedin'];
  const SOCIAL_NO_ICON_MSG =
    'No icon available for this platform; it will appear in structured data but not in the footer.';
  function socialHasIcon(name) {
    const n = String(name == null ? '' : name).trim().toLowerCase();
    return n === '' || SOCIAL_ICON_NAMES.indexOf(n) !== -1;
  }

  /* Publish route. 'atomic' = one commit via the Git Data API (default).
     'contents' = the original one-PUT-per-file path, kept as a fallback. */
  const LS_PUBMODE = 'sokadmin.publishMode';
  function publishMode() {
    try { return localStorage.getItem(LS_PUBMODE) === 'contents' ? 'contents' : 'atomic'; }
    catch (e) { return 'atomic'; }
  }
  function setPublishMode(m) {
    try { localStorage.setItem(LS_PUBMODE, m === 'contents' ? 'contents' : 'atomic'); } catch (e) { /* ignore */ }
  }

  const LS_CFG = 'sokadmin.cfg';
  const LS_DRAFT = 'sokadmin.draft';
  const DATA_PATH = 'data/site-data.json';

  /* The panel writes here, never to main.

     main carries a ruleset requiring the `verify` status check. A commit made
     through the API has never run CI, so a push straight at main is refused
     and the panel reports a failure it cannot explain. That is what blocked
     publishing for twelve days.

     Pushing to `content` instead cannot be blocked: .github/workflows/
     publish-content.yml runs every check on it and only then fast-forwards
     main, so the live site still only ever receives checked content. */
  const DEFAULT_BRANCH = 'content';
  const LEGACY_BRANCH = 'main';
  const PAGE_FILES = ['index.html', 'products.html', 'recipes.html', 'blogs.html', '404.html', 'sitemap.xml'];

  const S = {
    cfg: { owner: '', repo: '', branch: DEFAULT_BRANCH, token: '' },
    data: null,
    baseline: '',
    /* Blob sha of data/site-data.json as this panel loaded it.
       '' = never loaded (demo mode). A string = known provenance.
       null = loaded from a draft that predates this field, so provenance is
       unknown and the publish guard refuses rather than guessing. */
    dataSha: '',
    user: '',
    demo: false,
    section: 'home',
    pendingImagePath: null   // data path waiting for an upload, or '@media'
  };

  /* ================= utilities ================= */

  function cleanJson(obj, space) {
    return JSON.stringify(obj, (k, v) => (k && k.charAt(0) === '_' ? undefined : v), space);
  }
  function clone(obj) { return JSON.parse(cleanJson(obj)); }

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, val) {
    const ks = path.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = val;
  }

  function slugify(s) {
    return String(s || '').toLowerCase().replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
  }
  function dateDisplayFrom(iso) {
    const d = new Date((iso || '') + 'T00:00:00');
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  function siteUrl() {
    return String((S.data && S.data.brand.siteUrl) || '').replace(/\/+$/, '');
  }
  function rawUrl(name) {
    if (!name) return '';
    if (S.demo) return encodeURI(name);
    return 'https://raw.githubusercontent.com/' + S.cfg.owner + '/' + S.cfg.repo + '/' +
      S.cfg.branch + '/' + encodeURIComponent(name);
  }

  /* base64 <-> utf8 */
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ================= GitHub client ================= */

  async function gh(path, opts) {
    opts = opts || {};
    const res = await fetch('https://api.github.com' + path, Object.assign({}, opts, {
      headers: Object.assign({
        'Authorization': 'Bearer ' + S.cfg.token,
        'Accept': 'application/vnd.github+json'
      }, opts.headers || {})
    }));
    if (!res.ok) {
      let msg = res.status + '', body = null;
      try { body = await res.json(); msg = body.message || msg; } catch (e) { /* ignore */ }
      const err = new Error(msg);
      err.status = res.status;
      /* The parsed body is kept because GitHub puts the real cause in it. Three
         completely different faults come back as HTTP 422 and are told apart
         only by the message text. See classifyRefFault. */
      err.body = body;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function repoPath(p) {
    return '/repos/' + S.cfg.owner + '/' + S.cfg.repo + '/contents/' +
      p.split('/').map(encodeURIComponent).join('/');
  }

  async function getFile(path) {
    const j = await gh(repoPath(path) + '?ref=' + encodeURIComponent(S.cfg.branch));
    return { sha: j.sha, text: j.content != null ? b64decode(j.content) : null };
  }

  async function putFile(path, contentB64, message, sha) {
    const body = { message: message, content: contentB64, branch: S.cfg.branch };
    if (sha) body.sha = sha;
    try {
      return await gh(repoPath(path), { method: 'PUT', body: JSON.stringify(body) });
    } catch (e) {
      if (e.status === 409 || e.status === 422) {          // sha out of date → refetch once
        try {
          const cur = await gh(repoPath(path) + '?ref=' + encodeURIComponent(S.cfg.branch));
          body.sha = cur.sha;
          return await gh(repoPath(path), { method: 'PUT', body: JSON.stringify(body) });
        } catch (e2) { throw e2.status === 404 ? e : e2; }
      }
      throw e;
    }
  }

  /* ---------- Git Data API (atomic publish) ----------
     The Contents API writes one commit per file. These endpoints build a
     single commit off-line and only then move the branch, so a failure at
     any point before the ref update leaves the branch untouched. */

  function gitPath(sub) { return '/repos/' + S.cfg.owner + '/' + S.cfg.repo + '/git/' + sub; }
  function refSuffix() {
    /* keep slashes in branch names like feature/x, encode each segment */
    return 'heads/' + String(S.cfg.branch).split('/').map(encodeURIComponent).join('/');
  }
  function ghJson(path, method, body) {
    return gh(path, { method: method, body: JSON.stringify(body) });
  }

  function apiGetRef() { return gh(gitPath('ref/' + refSuffix())); }
  function apiGetCommit(sha) { return gh(gitPath('commits/' + sha)); }
  function apiGetTree(sha) { return gh(gitPath('trees/' + sha + '?recursive=1')); }
  function apiCreateBlob(b64) { return ghJson(gitPath('blobs'), 'POST', { content: b64, encoding: 'base64' }); }
  function apiCreateTree(baseTree, entries) { return ghJson(gitPath('trees'), 'POST', { base_tree: baseTree, tree: entries }); }
  function apiCreateCommit(message, tree, parent) { return ghJson(gitPath('commits'), 'POST', { message: message, tree: tree, parents: [parent] }); }
  function apiUpdateRef(sha) { return ghJson(gitPath('refs/' + refSuffix()), 'PATCH', { sha: sha, force: false }); }

  /* git blob id = sha1("blob <bytelen>\0" + bytes). Lets us skip unchanged
     files by comparing against the base tree without downloading every file. */
  async function gitBlobSha(text) {
    const subtle = (typeof crypto !== 'undefined') && crypto.subtle && crypto.subtle.digest;
    if (!subtle) return null;                       // caller then uploads everything
    const bytes = new TextEncoder().encode(text);
    const head = new TextEncoder().encode('blob ' + bytes.length + '\0');
    const buf = new Uint8Array(head.length + bytes.length);
    buf.set(head, 0); buf.set(bytes, head.length);
    const digest = await crypto.subtle.digest('SHA-1', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function deleteFile(path, sha, message) {
    return gh(repoPath(path), {
      method: 'DELETE',
      body: JSON.stringify({ message: message, sha: sha, branch: S.cfg.branch })
    });
  }

  /* ================= state / drafts ================= */

  function draftKey() { return S.cfg.owner + '/' + S.cfg.repo; }

  let draftTimer = null;
  function scheduleDraft() {
    if (S.demo) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(LS_DRAFT, JSON.stringify({
          key: draftKey(), savedAt: new Date().toISOString(),
          /* Which version of the file this draft was edited on top of. A draft
             can sit in localStorage for weeks; without this the panel cannot
             tell whether restoring it would revert someone else's work. */
          dataSha: S.dataSha || null,
          data: clone(S.data)
        }));
      } catch (e) { /* storage full — ignore */ }
    }, 600);
  }
  function clearDraft() { localStorage.removeItem(LS_DRAFT); }

  function isDirty() { return cleanJson(S.data) !== S.baseline; }

  function updateStatus() {
    const chip = $('#status-chip');
    if (S.demo) { chip.textContent = 'Demo mode'; chip.className = 'chip demo'; return; }
    if (isDirty()) { chip.textContent = '● Unpublished changes'; chip.className = 'chip dirty'; }
    else { chip.textContent = '✓ All changes published'; chip.className = 'chip clean'; }
  }

  function markDirty() { updateStatus(); scheduleDraft(); }

  /* ================= field builders ================= */

  function f(label, path, o) {
    o = o || {};
    const val = getPath(S.data, path);
    /* Regulated content is rendered read-only rather than hidden. Someone has
       to be able to SEE the FSSAI number to check it against the certificate;
       they just must not be the one to change it. */
    const lock = lockedFor(path);
    const dis = lock ? ' disabled' : '';
    const hint = lock ? lockNoteHtml(lock) : (o.hint ? '<div class="hint">' + o.hint + '</div>' : '');
    let ctrl;
    if (o.type === 'textarea') {
      ctrl = '<textarea data-path="' + path + '"' + dis +
        (o.coerce ? ' data-coerce="' + o.coerce + '"' : '') +
        ' rows="' + (o.rows || 3) + '">' +
        A(o.coerce === 'lines' ? (val || []).join('\n') : (val == null ? '' : val)) +
        '</textarea>';
    } else if (o.type === 'select') {
      ctrl = '<select data-path="' + path + '"' + dis + (o.coerce ? ' data-coerce="' + o.coerce + '"' : '') + '>' +
        (o.options || []).map(op =>
          '<option value="' + A(op.v) + '"' + (String(op.v) === String(val) ? ' selected' : '') + '>' +
          A(op.l) + '</option>').join('') + '</select>';
    } else if (o.type === 'checkbox') {
      return '<div class="f inline"><input type="checkbox" id="cb-' + path.replace(/\./g, '-') +
        '" data-path="' + path + '"' + dis + (val ? ' checked' : '') + '>' +
        '<label for="cb-' + path.replace(/\./g, '-') + '">' + label + '</label>' + hint + '</div>';
    } else {
      ctrl = '<input type="' + (o.type || 'text') + '" data-path="' + path + '"' + dis +
        (o.coerce ? ' data-coerce="' + o.coerce + '"' : '') +
        ' value="' + A(val == null ? '' : val) + '"' +
        (o.placeholder ? ' placeholder="' + A(o.placeholder) + '"' : '') + '>';
    }
    return '<div class="f' + (lock ? ' locked' : '') + '"><label>' + label +
      (lock ? ' <span class="lock-tag">locked</span>' : '') + '</label>' + ctrl + hint + '</div>';
  }

  function num(label, path, o) {
    return f(label, path, Object.assign({ type: 'number', coerce: 'number' }, o));
  }

  function imgField(label, path, o) {
    o = o || {};
    const val = getPath(S.data, path) || '';
    const bg = val ? ' style="background-image:url(\'' + A(rawUrl(val)) + '\')"' : '';
    return '<div class="f"><label>' + label + '</label>' +
      '<div class="imgfield">' +
      '<div class="thumb" data-thumb-for="' + path + '"' + bg + '>' + (val ? '' : 'no image') + '</div>' +
      '<div class="grow"><div class="row">' +
      '<input data-path="' + path + '" data-img value="' + A(val) + '" placeholder="filename.webp">' +
      '<button class="btn btn-outline btn-sm" data-action="upload" data-path="' + path + '" type="button">Upload</button>' +
      '</div>' +
      (o.hint ? '<div class="hint">' + o.hint + '</div>' : '<div class="hint">Filename of an image in the repository (see the Media tab), or upload a new one.</div>') +
      '</div></div></div>';
  }

  function card(icon, title, inner, extra) {
    return '<div class="card"' + (extra || '') + '><h3><span class="ic">' + icon + '</span>' + title + '</h3>' + inner + '</div>';
  }

  const MD_HINT = 'Supports links and emphasis: <code>[text](page.html)</code>, <code>[text](wa:Your WhatsApp message)</code>, <code>**bold**</code>, <code>*italic*</code>.';

  /* ================= the publish gate =================

     Seven checks plus the lock list, run in this browser before anything is
     written to GitHub. The same checks run again in the workflow after the
     push, from a clean checkout, because a check that lives inside the thing
     being checked is advisory. This copy exists so that a defect is caught
     where the person can still fix it, in the editor, instead of arriving as
     an issue ten minutes later.

     Which checks these are, and why these seven: they are every tools/ check
     whose input the panel already holds in memory. The two that are missing
     cannot run here for reasons, not by omission.

       output drift   the panel IS the builder, so its output matches its own
                      data by construction. It can never detect that its own
                      templates are stale. That is what the build id guard is
                      for, and it runs separately.
       check_locked   the panel is the actor being checked. The enforcing copy
                      must live where the person publishing cannot skip it.
                      The copy below is the courtesy warning, not the lock.

     NEITHER LIST IS DUPLICATED HERE. tools/figures.json and tools/locked.json
     are read at run time and Python reads the same two files. Writing the
     figures or the locks out again in JavaScript would put two copies in the
     repo that drift apart, which hard rule 9 in CLAUDE.md forbids.

     EVERY CHECK ASSERTS IT EXAMINED SOMETHING. Hard rule 8: "found zero
     problems" and "found zero things to examine" must not produce the same
     output. A check that examined nothing is reported as a failure, not a
     pass, because that is the state every broken guard in this repo was in.

     EVERY REFUSAL NAMES four things: what was touched, why it is locked or
     wrong, who changes it, and that the live site has not moved. The wording
     comes from tools/locked.json so the panel and the workflow say the same
     sentences. A refusal that only says no teaches nothing, and someone
     blocked from writing "ISO 3632 certified" who is not told the approved
     form writes "internationally certified quality" instead, which is a
     vaguer false claim rather than a precise one. */

  const GATE_FILES = { locked: 'tools/locked.json', figures: 'tools/figures.json' };
  let GATE_SPEC = null;

  /* Fail CLOSED, unlike the build id and data guards above.

     Those fail open because a network blip is not evidence of staleness. This
     is different: without the two spec files the panel cannot tell whether
     regulated content changed, which is a known unknown rather than a blip,
     and the workflow would refuse the push anyway. Refusing here costs one
     reload; refusing there costs a push, an issue and a wait. */
  async function gateSpecs() {
    if (GATE_SPEC) return GATE_SPEC;
    const out = {};
    for (const key of Object.keys(GATE_FILES)) {
      const rel = GATE_FILES[key];
      let res;
      try {
        res = await fetch(rel + '?cb=' + Date.now(), { cache: 'no-store' });
      } catch (err) {
        throw new Error('could not read ' + rel + ' (' + err.message + ')');
      }
      if (!res.ok) throw new Error(rel + ' returned HTTP ' + res.status);
      try { out[key] = await res.json(); }
      catch (err) { throw new Error(rel + ' did not parse as JSON'); }
    }
    const nLocks = (out.locked.paths || []).length + (out.locked.tokens || []).length;
    if (!nLocks) throw new Error(GATE_FILES.locked + ' defines no locks at all');
    if (!(out.figures.figures || []).length)
      throw new Error(GATE_FILES.figures + ' defines no figures at all');
    GATE_SPEC = out;
    return GATE_SPEC;
  }

  function gateDev() {
    return (GATE_SPEC && GATE_SPEC.locked.dev) || 'A developer changes this through a pull request.';
  }
  function gateUnchanged() {
    return (GATE_SPEC && GATE_SPEC.locked.unchanged) ||
      'Nothing was published and the live site is unchanged.';
  }

  /* ---------- paths ----------
     The panel addresses fields as products.0.specs.1.value. check_locked.py
     addresses the same value as products[].specs[].value, and keeps post ids
     rather than indexes so a lock on one article's body does not become a
     lock on every article's body. These convert between the two. */

  function normIndexes(p) { return String(p).replace(/\[\d+\]/g, '[]'); }

  function canonicalPath(dotPath, data) {
    const parts = String(dotPath).split('.');
    let node = data || S.data;
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      const k = parts[i];
      const isIdx = /^\d+$/.test(k);
      if (isIdx) {
        if (out === 'posts') {
          const item = node ? node[Number(k)] : null;
          out = 'posts[' + ((item && item.id) || '?') + ']';
        } else {
          out += '[]';
        }
      } else {
        out = out ? out + '.' + k : k;
      }
      node = node == null ? null : node[isIdx ? Number(k) : k];
    }
    return normIndexes(out);
  }

  function lockMatches(canon, match) {
    return canon === match ||
           canon.indexOf(match + '.') === 0 ||
           canon.indexOf(match + '[') === 0;
  }

  /* The lock covering a panel field path, or null. Used both to render the
     field read-only and to refuse a publish that changed it. */
  function lockedFor(dotPath, data) {
    if (!GATE_SPEC) return null;
    const canon = canonicalPath(dotPath, data);
    const paths = GATE_SPEC.locked.paths || [];
    for (let i = 0; i < paths.length; i++) {
      if (lockMatches(canon, paths[i].match)) return paths[i];
    }
    return null;
  }

  function lockNoteHtml(lock) {
    return '<div class="hint lock-note">🔒 <strong>' + A(lock.what) +
      '.</strong> ' + A(lock.why) + ' ' + A(gateDev()) + '</div>';
  }

  /* leaf values, keyed the way check_locked.py keys them */
  function flattenData(node, path, out) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) flattenData(node[i], path + '[' + i + ']', out);
    } else if (node && typeof node === 'object') {
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i], v = node[k];
        if (k === 'posts' && Array.isArray(v)) {
          for (let j = 0; j < v.length; j++) {
            flattenData(v[j], 'posts[' + ((v[j] && v[j].id) || '?') + ']', out);
          }
          continue;
        }
        flattenData(v, path ? path + '.' + k : k, out);
      }
    } else {
      out[path] = node;
    }
  }

  /* strings only, keyed the way check_figures.py keys them */
  function walkStrings(node, path, out) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walkStrings(node[i], path + '[' + i + ']', out);
    } else if (node && typeof node === 'object') {
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i], v = node[k];
        if (k === 'posts' && Array.isArray(v)) {
          for (let j = 0; j < v.length; j++) {
            walkStrings(v[j], 'posts[' + ((v[j] && v[j].id) || '?') + ']', out);
          }
          continue;
        }
        walkStrings(v, path ? path + '.' + k : k, out);
      }
    } else if (typeof node === 'string') {
      out[path] = node;
    }
  }

  /* Every substring of `value` the pattern matches, in order. null means the
     pattern itself will not compile here, which is a different problem and is
     reported separately rather than read as "no claims found". */
  function tokenMatches(pattern, value) {
    let rx;
    try { rx = new RegExp(pattern, 'g'); } catch (err) { return null; }
    if (typeof value !== 'string') return [];
    const out = [];
    let m;
    while ((m = rx.exec(value)) !== null) {
      if (m[0] === '') { rx.lastIndex++; continue; }
      out.push(m[0]);
    }
    return out;
  }

  /* Entries of `from` not accounted for by `take`, counting duplicates, so
     adding a second identical claim is still seen as an addition. */
  function multisetDiff(from, take) {
    const pool = take.slice();
    const out = [];
    for (let i = 0; i < from.length; i++) {
      const at = pool.indexOf(from[i]);
      if (at === -1) out.push(from[i]); else pool.splice(at, 1);
    }
    return out.sort();
  }

  function sameClaims(a, b) {
    return a.slice().sort().join('\u0000') === b.slice().sort().join('\u0000');
  }

  function clip(v, n) {
    if (typeof v !== 'string') return v == null ? '(empty)' : String(v);
    return v.length > (n || 110) ? v.slice(0, n || 110) + '...' : v;
  }

  /* An item's display name. recipes[] has no `title`: it uses `name` for the
     card and `schemaName` for structured data. Reading the wrong key here
     produced "undefined" in a refusal message, which is exactly the kind of
     junk value check 1 exists to catch. */
  function itemLabel(kind, item, idx) {
    if (!item) return kind + ' ' + idx;
    if (kind === 'recipes') return item.name || item.schemaName || ('recipe ' + idx);
    if (kind === 'posts') return item.title || item.id || ('article ' + idx);
    if (kind === 'products') {
      try { return SOKTemplates.productView(item).name; }
      catch (e) { return item.baseName || ('product ' + idx); }
    }
    return item.title || item.name || item.id || (kind + ' ' + idx);
  }

  /* ---------- the checks ----------
     Each returns { id, name, examined, unit, findings }. findings is a list of
     { where, what, why, todo, who, was, now }; every field optional except
     where and what. */

  const JUNK_TOKENS = ['[object Object]', '-Infinity', 'Infinity', 'NaN', 'undefined', 'null'];
  const RX_SCRIPT_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  const RX_LD = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const CHECKER_SIGNALS = ['indicator', 'nothing', 'inconclusive'];
  const OUTCOME_KEYS = ['indicator', 'nothing', 'inconclusive'];

  function blankKeepingLines(s) { return s.replace(/[^\n]/g, ' '); }

  function walkJsonValues(node, path, hit) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walkJsonValues(node[i], path + '[' + i + ']', hit);
    } else if (node && typeof node === 'object') {
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i++) walkJsonValues(node[keys[i]], path + '.' + keys[i], hit);
    } else if (typeof node === 'string') {
      if (JUNK_TOKENS.indexOf(node.trim()) !== -1) hit(path.replace(/^\./, ''), node.trim());
    }
  }

  /* 1. junk values anywhere in the finished pages */
  function checkJunk(files) {
    const findings = [];
    const names = Object.keys(files);
    names.forEach(function (rel) {
      const raw = files[rel];
      if (/\.html$/.test(rel)) {
        RX_LD.lastIndex = 0;
        let m;
        while ((m = RX_LD.exec(raw)) !== null) {
          try {
            walkJsonValues(JSON.parse(m[1].trim()), '', function (p, tok) {
              findings.push({ where: rel + '  ' + p, what: 'the value is the word "' + tok + '"' });
            });
          } catch (err) { /* check 2 reports unparseable blocks */ }
        }
        RX_SCRIPT_STYLE.lastIndex = 0;
        scanLines(rel, raw.replace(RX_SCRIPT_STYLE, blankKeepingLines), findings);
      } else if (/\.json$/.test(rel)) {
        try {
          walkJsonValues(JSON.parse(raw), '', function (p, tok) {
            findings.push({ where: rel + '  ' + p, what: 'the value is the word "' + tok + '"' });
          });
        } catch (err) {
          findings.push({ where: rel, what: 'the file is not valid JSON (' + err.message + ')' });
        }
      } else {
        scanLines(rel, raw, findings);
      }
    });
    return {
      id: 'junk', name: 'Broken values in the finished pages',
      examined: names.length, unit: 'page', findings: findings
    };
  }

  function scanLines(rel, text, findings) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (let t = 0; t < JUNK_TOKENS.length; t++) {
        const col = lines[i].indexOf(JUNK_TOKENS[t]);
        if (col === -1) continue;
        findings.push({
          where: rel + '  line ' + (i + 1),
          what: 'the page shows the word "' + JUNK_TOKENS[t] + '" where a value should be',
          why: 'That is what a missing or miscalculated value looks like once it reaches a page. ' +
               'It is visible to customers and to Google.',
          now: lines[i].slice(Math.max(0, col - 45), col + JUNK_TOKENS[t].length + 45).trim()
        });
        break;
      }
    }
  }

  /* 2. Google structured data parses */
  function checkJsonLd(files) {
    const findings = [];
    let blocks = 0, without = [];
    Object.keys(files).forEach(function (rel) {
      if (!/\.html$/.test(rel)) return;
      RX_LD.lastIndex = 0;
      let m, n = 0;
      while ((m = RX_LD.exec(files[rel])) !== null) {
        n++; blocks++;
        try { JSON.parse(m[1].trim()); }
        catch (err) {
          findings.push({
            where: rel + '  structured data block ' + n,
            what: 'the block Google reads is not valid (' + err.message + ')',
            why: 'Google drops the whole block, so the page loses its rich result.'
          });
        }
      }
      if (!n) without.push(rel);
    });
    return {
      id: 'jsonld', name: 'Google structured data',
      examined: blocks, unit: 'structured data block', findings: findings,
      note: without.length ? without.length + ' page(s) carry none, which is expected for 404' : ''
    };
  }

  /* 3. a product id matches its own web address */
  function checkProductIds(files) {
    const findings = [];
    let pages = 0;
    Object.keys(files).forEach(function (rel) {
      const mm = rel.match(/^products\/([^/]+)\/index\.html$/);
      if (!mm) return;
      pages++;
      const slug = mm[1], raw = files[rel];
      let sku = null;
      RX_LD.lastIndex = 0;
      let m;
      while ((m = RX_LD.exec(raw)) !== null) {
        let node;
        try { node = JSON.parse(m[1].trim()); } catch (err) { continue; }
        const graph = (node && node['@graph']) || (Array.isArray(node) ? node : [node]);
        (graph || []).forEach(function (g) {
          if (g && g['@type'] === 'Product' && g.sku != null) sku = String(g.sku);
        });
      }
      if (sku !== null && sku !== slug) {
        findings.push({
          where: '/products/' + slug + '/',
          what: 'the product code sent to Google is "' + sku + '" but the web address says "' + slug + '"',
          why: 'The code and the address are both built from the product id. When they disagree, ' +
               'Google Shopping and the sales reports are keyed on different things.',
          todo: 'Fix the product id in Products so it matches the web address.'
        });
      }
      const wa = raw.match(/data-wa-product="([^"]*)"/g) || [];
      wa.forEach(function (a) {
        const v = a.slice('data-wa-product="'.length, -1);
        if (v !== slug) {
          findings.push({
            where: '/products/' + slug + '/',
            what: 'an order button reports "' + v + '" but the web address says "' + slug + '"',
            why: 'Order tracking is keyed on that value, so the sales report will not join up.'
          });
        }
      });
      const canon = raw.match(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/);
      if (canon) {
        const seg = canon[1].replace(/\/+$/, '').split('/').pop();
        if (seg !== slug) {
          findings.push({
            where: '/products/' + slug + '/',
            what: 'the page tells Google its address ends in "' + seg + '" but it is at "' + slug + '"'
          });
        }
      }
    });
    return {
      id: 'productids', name: 'Product codes and web addresses',
      examined: pages, unit: 'product page', findings: findings
    };
  }

  /* 4. every "More from the blog" link goes somewhere real */
  function checkRelated(data) {
    const findings = [];
    const posts = data.posts || [];
    const byId = {}, drafts = {};
    posts.forEach(function (p) { if (p && p.id) { byId[p.id] = p; if (p.draft) drafts[p.id] = 1; } });
    let refs = 0;
    posts.forEach(function (p, i) {
      const list = p && p.related;
      if (!Array.isArray(list)) return;
      list.forEach(function (ref) {
        refs++;
        const label = itemLabel('posts', p, i);
        if (ref === p.id) {
          findings.push({ where: '"' + label + '"', what: 'it links to itself under More from the blog',
                          todo: 'Remove its own name from the related list.' });
        } else if (!byId[ref]) {
          findings.push({ where: '"' + label + '"',
                          what: 'it links to an article called "' + ref + '" that does not exist',
                          why: 'Readers would hit a missing page.',
                          todo: 'Pick a different article, or remove the link. A redirect does not fix an internal link.' });
        } else if (drafts[ref]) {
          findings.push({ where: '"' + label + '"',
                          what: 'it links to "' + ref + '", which is still a draft and has no page yet',
                          todo: 'Publish that article first, or link to a different one.' });
        }
      });
    });
    return {
      id: 'related', name: 'More from the blog links',
      examined: posts.length, unit: 'article', findings: findings,
      note: refs + ' link(s) checked'
    };
  }

  /* 5. the purity checker still quotes sentences the article contains */
  function checkChecker(data) {
    const findings = [];
    const posts = data.posts || [];
    const bodies = {}, drafts = {};
    posts.forEach(function (p) {
      if (!p || !p.id) return;
      bodies[p.id] = String(p.body == null ? '' : p.body).replace(/\s+/g, ' ').trim();
      if (p.draft) drafts[p.id] = 1;
    });
    const norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };
    let anchors = 0, checkers = 0;

    posts.forEach(function (post, pi) {
      const checker = post && post.checker;
      if (!checker) return;
      checkers++;
      const host = post.id || '?';
      const label = itemLabel('posts', post, pi);

      const anchored = function (where, entry) {
        let target = host, anchor = entry;
        if (entry && typeof entry === 'object') { target = entry.anchorPost || host; anchor = entry.anchor; }
        if (!norm(anchor)) {
          findings.push({ where: where, what: 'it states something with no sentence behind it',
                          why: 'Every line the checker shows has to be traceable to a published sentence.',
                          todo: 'Ask a developer.', who: gateDev() });
          return;
        }
        if (!(target in bodies)) {
          findings.push({ where: where, what: 'it quotes an article "' + target + '" that does not exist',
                          todo: 'Ask a developer.', who: gateDev() });
          return;
        }
        if (drafts[target]) {
          findings.push({ where: where, what: 'it quotes "' + target + '", which is still a draft and has no page',
                          todo: 'Ask a developer.', who: gateDev() });
          return;
        }
        anchors++;
        if (bodies[target].indexOf(norm(anchor)) === -1) {
          findings.push({
            where: where,
            what: 'it quotes a sentence that is no longer in "' + target + '"',
            why: 'The checker tells readers what a result means by pointing at the article. ' +
                 'Editing the article out from under it leaves a claim with nothing behind it.',
            todo: 'Put the sentence back, or ask a developer to re-anchor the checker.',
            who: gateDev(),
            now: norm(anchor).slice(0, 90)
          });
        }
      };

      if (post.draft) {
        findings.push({ where: '"' + label + '"', what: 'the purity checker sits on a draft, so it has no page' });
      }
      const after = norm(checker.afterSection);
      if (!after) {
        findings.push({ where: '"' + label + '"', what: 'the checker does not say which section it goes after' });
      } else if (norm(post.body).indexOf('## ' + after) === -1) {
        findings.push({
          where: '"' + label + '"',
          what: 'the checker is placed after a section called "' + after + '" that the article no longer has',
          why: 'It would silently move to the end of the article instead.',
          todo: 'Restore that sub-heading, or ask a developer to move the checker.', who: gateDev()
        });
      }
      const questions = checker.questions || [];
      if (!questions.length) {
        findings.push({ where: '"' + label + '"', what: 'the checker has no questions, so it examines nothing' });
      }
      questions.forEach(function (q, qi) {
        const where = '"' + label + '" question ' + (qi + 1);
        (q.options || []).forEach(function (o, oi) {
          const wo = where + ', answer ' + (oi + 1);
          const sig = o.signal;
          if (typeof sig === 'number' || typeof sig === 'boolean') {
            findings.push({ where: wo, what: 'the answer carries a score (' + sig + ')',
                            why: 'The checker states an outcome, never a score. A number reads as a measurement we did not take.',
                            todo: 'Ask a developer.', who: gateDev() });
          } else if (CHECKER_SIGNALS.indexOf(sig) === -1) {
            findings.push({ where: wo, what: 'the answer means "' + sig + '", which is not one of ' + CHECKER_SIGNALS.join(', ') });
          }
          if (!norm(o.because)) {
            findings.push({ where: wo, what: 'the answer shows no reasoning' });
          }
          anchored(wo, o);
        });
      });
      ['notes', 'cannotSee'].forEach(function (key) {
        const entries = checker[key] || [];
        if (key === 'cannotSee' && !entries.length) {
          findings.push({ where: '"' + label + '"',
                          what: 'the list of what home testing cannot detect is empty, and that list is the point of the feature' });
        }
        entries.forEach(function (en, ei) {
          anchored('"' + label + '" ' + key + ' ' + (ei + 1), en);
        });
      });
      const outcomes = checker.outcomes || {};
      OUTCOME_KEYS.forEach(function (k) {
        const oc = outcomes[k];
        if (!oc) { findings.push({ where: '"' + label + '" outcome "' + k + '"', what: 'it is missing' }); return; }
        ['heading', 'body'].forEach(function (fl) {
          if (!norm(oc[fl])) findings.push({ where: '"' + label + '" outcome "' + k + '"', what: 'its ' + fl + ' is empty' });
        });
      });
      Object.keys(outcomes).forEach(function (k) {
        if (OUTCOME_KEYS.indexOf(k) === -1) {
          findings.push({ where: '"' + label + '" outcome "' + k + '"',
                          what: 'it is not one of ' + OUTCOME_KEYS.join(', ') });
        }
      });
    });

    return {
      id: 'checker', name: 'Purity checker',
      examined: anchors, unit: 'quoted sentence', findings: findings,
      note: checkers + ' checker(s)'
    };
  }

  /* 6. figures that must agree everywhere they are stated */
  function checkFigures(data) {
    const findings = [];
    const figs = (GATE_SPEC.figures.figures) || [];
    const strings = {};
    walkStrings(data, '', strings);
    const paths = Object.keys(strings);
    let examined = 0;

    figs.forEach(function (fig) {
      (fig.patterns || []).forEach(function (pat) {
        let rx;
        try { rx = new RegExp(pat, 'g'); }
        catch (err) {
          findings.push({ where: 'tools/figures.json  ' + fig.name,
                          what: 'a pattern does not work in this browser (' + err.message + ')',
                          todo: 'Ask a developer.', who: gateDev() });
          return;
        }
        paths.forEach(function (p) {
          const text = strings[p];
          let m;
          rx.lastIndex = 0;
          while ((m = rx.exec(text)) !== null) {
            if (m[0] === '') { rx.lastIndex++; continue; }
            for (let gi = 1; gi < m.length; gi++) {
              const v = m[gi];
              if (v === undefined) continue;
              examined++;
              if ((fig.accepted || []).indexOf(v) === -1) {
                findings.push({
                  where: p,
                  what: 'it gives ' + fig.name + ' as "' + v + '", where the rest of the site says "' +
                        (fig.accepted || []).join('" or "') + '"',
                  why: 'The whole argument on this site is that other people\'s figures do not add up. ' +
                       'Two different values for the same figure is the thing we criticise.',
                  todo: 'Decide which value is right and correct the other place, rather than leaving both.',
                  now: m[0]
                });
              }
            }
          }
        });
      });
    });

    return {
      id: 'figures', name: 'Figures that must agree',
      examined: examined, unit: 'stated figure', findings: findings,
      note: figs.length + ' tracked figure(s) across ' + paths.length + ' pieces of text'
    };
  }

  /* 7. parity: what visible text is about to change, and did the site shrink

     Parity has no failure of its own: it reports differences, and a difference
     is usually the whole point of publishing. Two things about it ARE failures
     and both are the 29 Aug 2026 incident, where three publishes silently
     reverted 14 pages and sitemap.xml fell from 27 URLs to 11:

       a page that no longer renders at all
       fewer pages than before

     Everything else is reported for review rather than refused. */
  function checkParity(files, baselineData) {
    const findings = [];
    let before = null, beforeErr = null;
    try { before = SOKTemplates.renderAll(baselineData); }
    catch (err) { beforeErr = err; }

    if (beforeErr) {
      return {
        id: 'parity', name: 'Visible text review', examined: 0, unit: 'page',
        findings: [{ where: 'the version you started from',
                     what: 'it could not be rebuilt, so there is nothing to compare against (' + beforeErr.message + ')',
                     todo: 'Reload the panel (Ctrl+Shift+R) and try again.' }]
      };
    }

    const beforeNames = Object.keys(before), afterNames = Object.keys(files);
    const gone = beforeNames.filter(function (n) { return afterNames.indexOf(n) === -1; });
    if (gone.length) {
      findings.push({
        where: gone.slice(0, 8).join(', ') + (gone.length > 8 ? ' and ' + (gone.length - 8) + ' more' : ''),
        what: gone.length + ' page(s) that exist today would stop existing',
        why: 'This is exactly what happened on 29 August 2026: a publish regenerated the site with ' +
             'fewer pages and every blog and policy page was orphaned for a day.',
        todo: 'Reload the panel (Ctrl+Shift+R) and check nothing was deleted by accident.'
      });
    }

    const changed = [];
    afterNames.forEach(function (n) {
      if (!/\.(html|xml|txt)$/.test(n)) return;
      const b = before[n];
      if (b === undefined) { changed.push({ page: n, kind: 'new' }); return; }
      const bt = visibleText(b), at = visibleText(files[n]);
      if (bt !== at) changed.push({ page: n, kind: 'changed', before: bt, after: at });
    });

    return {
      id: 'parity', name: 'Visible text review',
      examined: afterNames.length, unit: 'page', findings: findings,
      review: changed,
      note: changed.length
        ? changed.length + ' page(s) change visible text'
        : 'no visible text changes'
    };
  }

  function visibleText(html) {
    return String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* the lock list, rules 1 to 9 of tools/locked.json */
  function checkLockedContent(data, baselineData) {
    const findings = [];
    const spec = GATE_SPEC.locked;
    const b = {}, a = {};
    flattenData(baselineData, '', b);
    flattenData(data, '', a);

    const seen = {}, keys = [];
    Object.keys(b).concat(Object.keys(a)).forEach(function (k) {
      if (!seen[k]) { seen[k] = 1; keys.push(k); }
    });
    keys.sort();

    const changed = keys.filter(function (k) { return b[k] !== a[k]; });

    changed.forEach(function (key) {
      const canon = normIndexes(key);
      let hit = null;
      (spec.paths || []).forEach(function (lock) { if (!hit && lockMatches(canon, lock.match)) hit = lock; });
      if (hit) {
        findings.push({
          where: key, what: 'you changed ' + hit.what, why: hit.why,
          who: gateDev(), was: clip(b[key]), now: clip(a[key])
        });
        return;
      }
      /* Fire on a change to the CLAIM, not to the string holding it. Mirrors
         token_locks_for in tools/check_locked.py, which is the enforcing copy
         and was narrowed first. See tools/locked.json for why. */
      (spec.tokens || []).forEach(function (lock) {
        const was = tokenMatches(lock.pattern, b[key]);
        const now = tokenMatches(lock.pattern, a[key]);
        if (was === null || now === null) {
          findings.push({
            where: 'tools/locked.json  ' + lock.what,
            what: 'its pattern does not work in this browser, so this lock could not be checked',
            why: 'A lock that cannot run must not read as a lock that found nothing.',
            todo: 'Reload the panel (Ctrl+Shift+R). If it persists, send this to a developer.',
            who: gateDev()
          });
          return;
        }
        if (sameClaims(was, now)) return;
        const removed = multisetDiff(was, now);
        const added = multisetDiff(now, was);
        findings.push({
          where: key,
          what: 'you changed ' + lock.what,
          why: lock.why,
          todo: lock.instead,
          who: gateDev(),
          removed: removed,
          added: added
        });
      });
    });

    return {
      id: 'locked', name: 'Regulated content',
      examined: keys.length, unit: 'value', findings: findings,
      note: changed.length + ' value(s) changed'
    };
  }

  /* ---------- runner ---------- */

  async function runGate(data, baselineData) {
    let specErr = null;
    try { await gateSpecs(); } catch (err) { specErr = err; }
    if (specErr) {
      return {
        ok: false, blocked: true,
        checks: [{
          id: 'specs', name: 'The rules this panel checks against', examined: 0, unit: 'rule file',
          findings: [{
            where: 'tools/locked.json and tools/figures.json',
            what: 'they could not be read, so the panel cannot tell whether regulated content changed (' +
                  specErr.message + ')',
            why: 'These two files say which content is locked and which figures must agree. ' +
                 'Without them this check would pass everything, which is worse than refusing.',
            todo: 'Reload the panel (Ctrl+Shift+R). If it keeps happening, send this message to a developer.',
            who: gateDev()
          }]
        }]
      };
    }

    let files = null, renderErr = null;
    try { files = SOKTemplates.renderAll(data); }
    catch (err) { renderErr = err; }
    if (renderErr) {
      return {
        ok: false, blocked: true,
        checks: [{
          id: 'render', name: 'Building the pages', examined: 0, unit: 'page',
          findings: [{
            where: 'the whole site',
            what: 'the pages could not be built from your content (' + renderErr.message + ')',
            why: 'Nothing can be checked or published until the pages build.',
            todo: 'Undo your last edit and try again. If it persists, send this message to a developer.',
            who: gateDev()
          }]
        }]
      };
    }

    const checks = [
      checkJunk(files),
      checkJsonLd(files),
      checkProductIds(files),
      checkRelated(data),
      checkChecker(data),
      checkFigures(data),
      checkParity(files, baselineData),
      checkLockedContent(data, baselineData)
    ];

    /* Hard rule 8. A check that looked at nothing is a failure, not a pass:
       every broken guard this repo has found was in exactly that state, and
       reported success. */
    checks.forEach(function (c) {
      if (c.examined > 0) return;
      c.findings = c.findings.concat([{
        where: c.name,
        what: 'this check examined no ' + c.unit + ' at all, so it proves nothing',
        why: 'A check that looks at nothing and a check that finds nothing must not ' +
             'report the same result. Every guard in this project that was only ever ' +
             'seen green had already stopped working.',
        todo: 'Reload the panel (Ctrl+Shift+R). If it persists, send this message to a developer.',
        who: gateDev()
      }]);
      c.starved = true;
    });

    const failed = checks.filter(function (c) { return c.findings.length; });
    return { ok: !failed.length, blocked: !!failed.length, checks: checks, failed: failed };
  }

  /* The refusal, as plain text. Each entry names what was touched, why, who
     changes it, and that the live site has not moved. */
  function gateRefusalHtml(result) {
    const parts = [];
    parts.push('<p><strong>Not published. The live site has not changed.</strong></p>');
    parts.push('<p>Everything you edited is still here. Fix the points below and press Publish again.</p>');
    (result.failed || result.checks.filter(function (c) { return c.findings.length; })).forEach(function (c) {
      parts.push('<p style="margin:14px 0 4px;"><strong>' + A(c.name) + '</strong></p>');
      c.findings.slice(0, 12).forEach(function (fd) {
        const rows = [];
        rows.push('<div><code>' + A(fd.where) + '</code></div>');
        rows.push('<div>' + A(fd.what) + '</div>');
        if (fd.why) rows.push('<div style="color:#6b5c48;">' + A(fd.why) + '</div>');
        if (fd.todo) rows.push('<div><strong>What to do:</strong> ' + A(fd.todo) + '</div>');
        if (fd.who) rows.push('<div style="color:#6b5c48;">' + A(fd.who) + '</div>');
        if (fd.removed !== undefined || fd.added !== undefined) {
          /* Naming the claim beats clipping the first 110 characters of a
             5,000 character article body, which told the reader nothing. */
          if ((fd.removed || []).length) {
            rows.push('<div style="color:#6b5c48;">claim removed: ' +
              A(fd.removed.map(function (x) { return '"' + x + '"'; }).join(', ')) + '</div>');
          }
          if ((fd.added || []).length) {
            rows.push('<div style="color:#6b5c48;">claim added: ' +
              A(fd.added.map(function (x) { return '"' + x + '"'; }).join(', ')) + '</div>');
          }
        } else if (fd.was !== undefined && fd.now !== undefined) {
          rows.push('<div style="color:#6b5c48;">was: ' + A(String(fd.was)) + '</div>');
          rows.push('<div style="color:#6b5c48;">now: ' + A(String(fd.now)) + '</div>');
        } else if (fd.now !== undefined) {
          rows.push('<div style="color:#6b5c48;">' + A(String(fd.now)) + '</div>');
        }
        parts.push('<div style="margin:0 0 10px;padding:8px 10px;border-left:3px solid #c0392b;background:#fff5f4;">' +
          rows.join('') + '</div>');
      });
      if (c.findings.length > 12) {
        parts.push('<p style="color:#6b5c48;">and ' + (c.findings.length - 12) + ' more of the same kind.</p>');
      }
    });
    parts.push('<p>' + A(gateUnchanged()) + '</p>');
    return parts.join('');
  }

  /* Exposed so the gate can be exercised against real data outside the publish
     button. tools/prove_gate.js drives this in a real browser: every check is
     watched refusing on its own fault and passing on untouched data. */
  window.SOKGate = {
    run: runGate,
    specs: gateSpecs,
    lockedFor: lockedFor,
    canonicalPath: canonicalPath,
    refusalHtml: gateRefusalHtml,
    /* the upload rules, exposed for the same reason: a rule about which file
       names may overwrite what is in the repository root is worth watching
       refuse, not worth reasoning about */
    imageNameProblem: function (name, file) { return imageNameProblem(name, file); },
    isImageName: function (name) { return isImageName(name); },
    sanitiseUploadName: function (n) {
      return String(n).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
    },
    /* Exposed so the three-different-faults-one-status-code mapping can be
       driven with the real API bodies rather than reasoned about. */
    classifyRefFault: function (err, forced) { return classifyRefFault(err, forced); }
  };

  /* ---------- generic list editors ---------- */

  const KINDS = {
    policySection: {
      label: (it) => (it.heading || 'Untitled section'),
      sub: (it) => String(it.body || '').replace(/\s+/g, ' ').slice(0, 70),
      make: () => ({ _open: true, heading: 'New section', body: '' })
    },
    product: {
      label: (it) => (it.baseName && it.size ? it.baseName + ' ' + it.size : it.baseName || 'Untitled product'),
      sub: (it) => 'AED ' + (it.price || 0) + ' · ' + (it.category || '') + (it.featured ? ' · ★ featured' : ''),
      make: () => ({
        _open: true, id: 'new-product', baseName: 'New Product', size: '', grams: null,
        unitLabel: '/ tin', price: 0, image: '', altContext: '', descBody: '',
        homeDesc: '', pageDesc: '', valueBlurb: '',
        status: 'available', sale: null,
        category: (S.data.productsPage.filters[0] || {}).key || 'saffron',
        featured: false,
        specs: [], compare: null
      })
    },
    recipe: {
      label: (it) => (it.name || 'Untitled recipe'),
      sub: (it) => (it.timeLabel || '') + ' · ' + (it.cuisineLabel || ''),
      make: () => ({
        _open: true, id: 'new-recipe', name: 'New Recipe', schemaName: '', cardDesc: '', schemaDesc: '',
        image: '', imageAlt: '', timeLabel: '30 min', totalISO: 'PT30M',
        cuisineLabel: 'Kashmiri', cuisine: 'Kashmiri', servesLabel: 'Serves 4', yield: '4 servings',
        ingredients: [], steps: [], tip: ''
      })
    },
    post: {
      label: (it) => (it.title || 'Untitled article'),
      sub: (it) => (it.dateDisplay || it.dateISO || ''),
      make: () => {
        const iso = new Date().toISOString().slice(0, 10);
        return {
          _open: true, id: 'new-article', title: 'New article',
          categoryKey: (S.data.blogPage.categories[0] || {}).key || 'guide',
          dateISO: iso, dateDisplay: dateDisplayFrom(iso), excerpt: '', body: ''
        };
      }
    },
    faq: { label: (it) => (it.q || 'New question'), sub: () => '', make: () => ({ _open: true, q: 'New question?', a: '' }) },
    testimonial: {
      label: (it) => (it.name || 'New testimonial'),
      sub: (it) => '★'.repeat(it.stars || 5),
      make: () => ({ _open: true, stars: 5, quote: '', name: '' })
    },
    social: {
      label: (it) => (it.name || 'New profile'),
      sub: (it) => (socialHasIcon(it.name) ? (it.url || '') : '⚠ no icon'),
      make: () => ({ _open: true, name: '', url: '' })
    },
    whycard: { label: (it) => (it.title || 'New card'), sub: () => '', make: () => ({ _open: true, icon: '✨', title: 'New card', text: '' }) },
    step: { label: (it) => (it.title || 'New step'), sub: () => '', make: () => ({ _open: true, title: 'New step', text: '' }) },
    dcard: { label: (it) => (it.title || 'New card'), sub: () => '', make: () => ({ _open: true, icon: '✨', title: 'New card', text: '' }) }
  };

  function listEditor(listPath, kind, bodyFn, addLabel) {
    const arr = getPath(S.data, listPath) || [];
    const K = KINDS[kind];
    const lock = lockedFor(listPath);
    const items = arr.map((it, i) => {
      const open = !!it._open;
      const sub = K.sub(it);
      return '<div class="item">' +
        '<div class="item-head" data-action="toggle" data-list="' + listPath + '" data-idx="' + i + '">' +
        '<span>' + (open ? '▾' : '▸') + '</span>' +
        '<span class="ttl">' + A(K.label(it)) + (sub ? ' <span class="sub">— ' + A(sub) + '</span>' : '') + '</span>' +
        (lock ? '<span class="ctrl"><span class="lock-tag">locked</span></span>'
              : '<span class="ctrl">' +
        '<button type="button" title="Move up" data-action="up" data-list="' + listPath + '" data-idx="' + i + '">↑</button>' +
        '<button type="button" title="Move down" data-action="down" data-list="' + listPath + '" data-idx="' + i + '">↓</button>' +
        '<button type="button" title="Duplicate" data-action="dup" data-list="' + listPath + '" data-idx="' + i + '">⧉</button>' +
        '<button type="button" class="del" title="Delete" data-action="del" data-list="' + listPath + '" data-idx="' + i + '">✕</button>' +
        '</span>') + '</div>' +
        (open ? '<div class="item-body">' + bodyFn(listPath + '.' + i, it, i) + '</div>' : '') +
        '</div>';
    }).join('');
    if (lock) return lockNoteHtml(lock) + '<div class="items">' + items + '</div>';
    return '<div class="items">' + items + '</div>' +
      '<div class="add-row"><button class="btn btn-outline btn-sm" type="button" data-action="add" data-list="' +
      listPath + '" data-kind="' + kind + '">+ ' + (addLabel || 'Add item') + '</button></div>';
  }

  /* compact rows for tiny pair-lists (specs, filters, links, categories) */
  function rowsEditor(listPath, fields, addLabel, defaults) {
    const arr = getPath(S.data, listPath) || [];
    const lock = lockedFor(listPath);
    const dis = lock ? ' disabled' : '';
    const head = '<div style="display:grid;grid-template-columns:' +
      fields.map(fl => fl.w || '1fr').join(' ') + ' 30px;gap:8px;font-size:12px;color:#8d7c63;margin:8px 0 2px;">' +
      fields.map(fl => '<span>' + fl.label + '</span>').join('') + '<span></span></div>';
    const rows = arr.map((it, i) =>
      '<div style="display:grid;grid-template-columns:' + fields.map(fl => fl.w || '1fr').join(' ') +
      ' 30px;gap:8px;margin:5px 0;align-items:center;">' +
      fields.map(fl =>
        '<input data-path="' + listPath + '.' + i + '.' + fl.key + '"' + dis + ' value="' +
        A(it[fl.key] == null ? '' : it[fl.key]) + '"' +
        (fl.placeholder ? ' placeholder="' + A(fl.placeholder) + '"' : '') + '>').join('') +
      (lock ? '<span></span>'
            : '<button type="button" class="btn-ghost" title="Remove" data-action="row-del" data-list="' + listPath +
              '" data-idx="' + i + '">✕</button>') + '</div>'
    ).join('');
    if (lock) return lockNoteHtml(lock) + head + rows;
    return head + rows +
      '<div class="add-row"><button class="btn btn-outline btn-sm" type="button" data-action="row-add" data-list="' +
      listPath + '" data-defaults="' + A(JSON.stringify(defaults)) + '">+ ' + addLabel + '</button></div>';
  }

  /* ================= sections ================= */

  function secHome() {
    const d = S.data;
    return '<div class="page-h"><div><h2>Homepage</h2><p>Everything on the front page, top to bottom.</p></div></div>' +

      card('🌅', 'Hero (top of page)',
        f('Small line above the title', 'hero.eyebrow') +
        f('Main heading (H1)', 'hero.title', { type: 'textarea', rows: 2 }) +
        f('Intro paragraph', 'hero.lead', { type: 'textarea' }) +
        '<div class="grid2">' +
        f('Primary button text', 'hero.primaryCta.label') +
        f('Primary button link', 'hero.primaryCta.href') +
        '</div>' +
        f('WhatsApp button text', 'hero.waCtaLabel') +
        f('Checklist points', 'hero.points', { type: 'textarea', coerce: 'lines', rows: 4, hint: 'One point per line.' }) +
        imgField('Hero image', 'hero.image') +
        f('Hero image description (alt text)', 'hero.imageAlt')) +

      card('🏅', '“Why Choose Us” cards',
        '<div class="grid2">' + f('Small line', 'whyUs.eyebrow') + f('Heading', 'whyUs.heading') + '</div>' +
        listEditor('whyUs.cards', 'whycard', p =>
          '<div class="grid2">' + f('Icon (emoji)', p + '.icon') + f('Title', p + '.title') + '</div>' +
          f('Text', p + '.text', { type: 'textarea' }), 'Add card')) +

      card('🛍️', 'Product showcase strip',
        '<div class="grid2">' + f('Small line', 'homeProducts.eyebrow') + f('Heading', 'homeProducts.heading') + '</div>' +
        f('Subtitle', 'homeProducts.sub', { type: 'textarea', rows: 2 }) +
        f('“View all” button text', 'homeProducts.viewAllLabel') +
        '<div class="hint" style="margin-top:8px;">Products marked <strong>“Show on homepage”</strong> appear here — ' +
        '<a href="#" data-goto="products">manage products →</a></div>') +

      card('🧭', '“How It Works” steps',
        '<div class="grid2">' + f('Small line', 'howItWorks.eyebrow') + f('Heading', 'howItWorks.heading') + '</div>' +
        listEditor('howItWorks.steps', 'step', p =>
          f('Title', p + '.title') + f('Text', p + '.text', { type: 'textarea' }), 'Add step')) +

      card('🏔️', 'Heritage story',
        '<div class="grid2">' + f('Small line', 'story.eyebrow') + f('Heading', 'story.heading') + '</div>' +
        f('Paragraphs', 'story.paragraphs', { type: 'textarea', coerce: 'lines', rows: 7, hint: 'Each line becomes one paragraph.' }) +
        imgField('Image', 'story.image') +
        f('Image description (alt text)', 'story.imageAlt') +
        '<div class="grid2">' + f('Link text', 'story.linkLabel') + f('Link target', 'story.linkHref') + '</div>') +

      card('📞', 'Contact strip',
        f('Heading', 'contact.heading') +
        f('Text', 'contact.text', { type: 'textarea' }) +
        f('Origin line', 'contact.originLine', { hint: 'Phone, email and Instagram in this strip come from <a href="#" data-goto="brand">Brand &amp; contact</a>.' })) +

      card('🦶', 'Footer',
        f('About text', 'footer.about', { type: 'textarea' }) +
        '<div class="grid2">' +
        f('Right-hand line', 'footer.bottomRight') +
        '</div>');
  }

  function secProducts() {
    const filterOpts = S.data.productsPage.filters.map(fl => ({ v: fl.key, l: fl.label + ' (' + fl.key + ')' }));
    return '<div class="page-h"><div><h2>Products</h2><p>Catalogue, prices, WhatsApp messages, spec tables and the products page sections.</p></div></div>' +

      card('📃', 'Page heading',
        f('Page title (H1)', 'productsPage.h1') +
        f('Subtitle', 'productsPage.sub', { type: 'textarea', rows: 2 }) +
        '<div class="subgrp"><div class="lbl">Filter buttons</div>' +
        f('“All” button text', 'productsPage.allLabel') +
        rowsEditor('productsPage.filters',
          [{ key: 'key', label: 'Category key', w: '130px', placeholder: 'saffron' }, { key: 'label', label: 'Button label' }],
          'Add filter', { key: '', label: '' }) +
        '<div class="hint">Each product below is assigned one category key.</div></div>') +

      card('🧺', 'Product catalogue',
        listEditor('products', 'product', (p, it, i) =>
          '<div class=”grid2”>' + f('Base name', p + '.baseName', { placeholder: 'Royal Mongra' }) + f('Size', p + '.size', { placeholder: '2g' }) + '</div>' +
          '<div class=”grid3”>' +
          num('Price (AED)', p + '.price') +
          f('Unit label', p + '.unitLabel', { placeholder: '/ tin' }) +
          f('Category', p + '.category', { type: 'select', options: filterOpts }) +
          '</div>' +
          '<div class=”grid2”>' +
          num('Grams in pack (saffron tins only)', p + '.grams', { placeholder: 'leave blank for honey / oil / tea', hint: 'Used to calculate per-gram price automatically.' }) +
          f('Value blurb (saffron tins only)', p + '.valueBlurb', { placeholder: 'best value for home chefs' }) +
          '</div>' +
          f('Availability status', p + '.status', {
            type: 'select',
            options: [
              { v: 'available', l: 'Available (in stock)' },
              { v: 'out_of_stock', l: 'Out of stock' },
              { v: 'coming_soon', l: 'Coming soon (pre-order)' }
            ]
          }) +
          '<div class=”subgrp”><div class=”lbl”>Sale / discount</div>' +
          '<div class=”f inline”><input type=”checkbox” id=”sale-' + i + '” data-action=”toggle-sale” data-idx=”' + i + '”' +
          (it.sale ? ' checked' : '') + '><label for=”sale-' + i + '”>This product is on sale</label></div>' +
          (it.sale ?
            '<div class=”grid3”>' +
            num('Sale price (AED)', p + '.sale.price') +
            f('Label (e.g. 20% off)', p + '.sale.label') +
            f('Valid until', p + '.sale.until', { placeholder: 'YYYY-MM-DD or leave blank', hint: 'Optional — not shown on the site.' }) +
            '</div>'
            : '') +
          '</div>' +
          f('Show on homepage', p + '.featured', { type: 'checkbox' }) +
          imgField('Photo', p + '.image') +
          '<div class=”f”><label>Alt text</label><div class=”hint”>Auto-derived: “' + A((it.baseName || 'Base name') + ' ' + (it.size || 'size') + ', [alt context]') + '”</div></div>' +
          f('Alt context (descriptive tail, no size)', p + '.altContext', { placeholder: 'saffron tin from Pampore, Kashmir' }) +
          f('Description on products page', p + '.pageDesc', { type: 'textarea', rows: 2 }) +
          f('Description on homepage', p + '.homeDesc', { type: 'textarea', rows: 2, hint: 'Used when “Show on homepage” is on. Leave blank to reuse the products-page text.' }) +
          f('Schema description body (no size)', p + '.descBody', { type: 'textarea', rows: 2, hint: 'Auto-derives: “Base name Size. [this text]” for Google.' }) +
          '<div class=”subgrp”><div class=”lbl”>Details table (optional)</div>' +
          rowsEditor(p + '.specs',
            [{ key: 'label', label: 'Label', w: '140px' }, { key: 'value', label: 'Value' }],
            'Add row', { label: '', value: '' }) +
          '<div class=”hint”>Do not add a “Value (AED/g)” row — it is derived automatically from price and grams.</div></div>' +
          '<div class=”subgrp”><div class=”lbl”>Size-comparison table</div>' +
          '<div class=”f inline”><input type=”checkbox” id=”cmp-' + i + '” data-action=”toggle-compare” data-idx=”' + i + '”' +
          (it.compare ? ' checked' : '') + '><label for=”cmp-' + i + '”>Include this product in the comparison table</label></div>' +
          (it.compare ?
            '<div class=”grid2”>' + f('Servings', p + '.compare.servings', { placeholder: '80-100' }) + f('Best for', p + '.compare.bestFor') + '</div>' +
            '<div class=”hint”>Name and per-gram price are derived automatically.</div>'
            : '') +
          '</div>',
          'Add product')) +

      card('⚖️', 'Comparison section heading',
        '<div class="grid2">' + f('Small line', 'productsPage.compare.eyebrow') + f('Heading', 'productsPage.compare.heading') + '</div>') +

      card('🔍', '“How to identify real saffron”',
        '<div class="grid2">' + f('Small line', 'productsPage.identify.eyebrow') + f('Heading', 'productsPage.identify.heading') + '</div>' +
        f('Subtitle', 'productsPage.identify.sub', { type: 'textarea', rows: 2 }) +
        listEditor('productsPage.identify.steps', 'step', p =>
          f('Title', p + '.title') + f('Text', p + '.text', { type: 'textarea' }), 'Add test') +
        '<div class="grid2">' + f('Footer link text', 'productsPage.identify.footerLink.label') +
        f('Footer link target', 'productsPage.identify.footerLink.href') + '</div>') +

      card('🚚', 'Delivery / payment / bulk cards',
        '<div class="grid2">' + f('Small line', 'productsPage.delivery.eyebrow') + f('Heading', 'productsPage.delivery.heading') + '</div>' +
        listEditor('productsPage.delivery.cards', 'dcard', p =>
          '<div class="grid2">' + f('Icon (emoji)', p + '.icon') + f('Title', p + '.title') + '</div>' +
          f('Text', p + '.text', { type: 'textarea', hint: MD_HINT }), 'Add card'));
  }

  function secRecipes() {
    return '<div class="page-h"><div><h2>Recipes</h2><p>Each recipe also produces Google “Recipe” rich-result data automatically.</p></div></div>' +

      card('📃', 'Page heading',
        f('Page title (H1)', 'recipesPage.h1') +
        f('Subtitle', 'recipesPage.sub', { type: 'textarea', rows: 2 })) +

      card('🍲', 'Recipe collection',
        listEditor('recipes', 'recipe', p =>
          '<div class="grid2">' + f('Recipe name', p + '.name') + f('Time shown on card', p + '.timeLabel', { placeholder: '50 min' }) + '</div>' +
          '<div class="grid2">' + f('Cuisine label', p + '.cuisineLabel') + f('Serves label', p + '.servesLabel', { placeholder: 'Serves 4' }) + '</div>' +
          imgField('Photo', p + '.image') +
          f('Photo description (alt text)', p + '.imageAlt') +
          f('One-line description', p + '.cardDesc', { type: 'textarea', rows: 2 }) +
          f('Ingredients', p + '.ingredients', { type: 'textarea', coerce: 'lines', rows: 8, hint: 'One ingredient per line. ' + MD_HINT }) +
          f('Method', p + '.steps', { type: 'textarea', coerce: 'lines', rows: 8, hint: 'One step per line — numbering is automatic.' }) +
          f('Tip box', p + '.tip', { type: 'textarea', rows: 2, hint: MD_HINT }) +
          '<div class="subgrp"><div class="lbl">Search listing (Google)</div>' +
          '<div class="grid2">' + f('Recipe name for Google', p + '.schemaName') + f('Total time (ISO)', p + '.totalISO', { placeholder: 'PT50M', hint: 'PT15M = 15 min · PT1H30M = 1 hr 30 min.' }) + '</div>' +
          f('Keywords', p + '.keywords', { placeholder: 'kesar doodh, saffron milk, cardamom', hint: 'Comma separated. The dish name and its main ingredients. Do not stuff; a short honest list beats a long one.' }) +
          '<div class="grid2">' + f('Cuisine for Google', p + '.cuisine') + f('Yield', p + '.yield', { placeholder: '4 servings' }) + '</div>' +
          f('Short description for Google', p + '.schemaDesc', { type: 'textarea', rows: 2 }) + '</div>',
          'Add recipe')) +

      card('✨', '“Golden rule” banner (bottom of page)',
        '<div class="grid2">' + f('Small line', 'recipesPage.golden.eyebrow') + f('Heading', 'recipesPage.golden.heading') + '</div>' +
        f('Text', 'recipesPage.golden.sub', { type: 'textarea', rows: 3 }) +
        '<div class="grid2">' + f('Primary button text', 'recipesPage.golden.primary.label') + f('Primary button link', 'recipesPage.golden.primary.href') + '</div>' +
        '<div class="grid2">' + f('Secondary button text', 'recipesPage.golden.secondary.label') + f('Secondary button link', 'recipesPage.golden.secondary.href') + '</div>');
  }

  function secPosts() {
    const catOpts = S.data.blogPage.categories.map(c => ({ v: c.key, l: c.label + ' (' + c.key + ')' }));
    return '<div class="page-h"><div><h2>Blog posts</h2><p>Each article gets its own page at /blog/&lt;id&gt;/, listed as an excerpt on the blog index.</p></div></div>' +

      card('📃', 'Page heading & categories',
        f('Page title (H1)', 'blogPage.h1') +
        f('Subtitle', 'blogPage.sub', { type: 'textarea', rows: 2 }) +
        '<div class="subgrp"><div class="lbl">Categories</div>' +
        f('“All” button text', 'blogPage.allLabel') +
        rowsEditor('blogPage.categories',
          [{ key: 'key', label: 'Key', w: '110px', placeholder: 'guide' },
           { key: 'label', label: 'Filter button label' },
           { key: 'postLabel', label: 'Label shown on article' }],
          'Add category', { key: '', label: '', postLabel: '' }) + '</div>') +

      card('📰', 'Articles',
        listEditor('posts', 'post', (p, it, i) =>
          f('Title', p + '.title') +
          '<div class="grid2">' +
          '<div class="f"><label>Link id (slug)</label><div style="display:flex;gap:8px;">' +
          '<input data-path="' + p + '.id" value="' + A(it.id) + '" style="flex:1;">' +
          '<button class="btn btn-outline btn-sm" type="button" data-action="slugify" data-idx="' + i + '">From title</button></div>' +
          '<div class="hint">Page: ' + A(siteUrl()) + '/blog/' + A(it.id) + '/ &nbsp; ' +
          '<button class="btn btn-outline btn-sm" type="button" data-preview="blog/' + A(it.id) + '/index.html">Preview page</button>' +
          '<br>Changing the id moves a live URL. The old /blogs#' + A(it.id) + ' anchor stays on the index.</div></div>' +
          f('Category', p + '.categoryKey', { type: 'select', options: catOpts }) +
          '</div>' +
          f('Draft (written but not published)', p + '.draft', { type: 'checkbox', hint: 'A draft produces no page, no index card, no sitemap entry and no llms.txt line.' }) +
          '<div class="grid2">' +
          f('Browser tab title', p + '.metaTitle', { hint: 'Under 60 characters.' }) +
          f('Search description', p + '.metaDescription', { hint: 'Under 155 characters.' }) +
          '</div>' +
          '<div class="grid2">' +
          '<div class="f"><label>Date</label><div style="display:flex;gap:8px;">' +
          '<input type="date" data-path="' + p + '.dateISO" value="' + A(it.dateISO) + '" style="flex:1;">' +
          '<button class="btn btn-outline btn-sm" type="button" data-action="autodate" data-idx="' + i + '">Format →</button></div></div>' +
          f('Date as shown', p + '.dateDisplay') +
          '</div>' +
          f('Excerpt (shown before “Read full article”)', p + '.excerpt', { type: 'textarea', rows: 3 }) +
          imgField('Image (optional)', p + '.image') +
          f('Image description (alt text)', p + '.imageAlt', { hint: 'Shown on the blog card and used for Google and social previews. Leave the image blank to show no image.' }) +
          f('Article body', p + '.body', { type: 'textarea', rows: 14, hint: 'Blank line = new paragraph. Start a line with <code>## </code> for a sub-heading. ' + MD_HINT }),
          'Add article')) +

      card('🧷', 'Sidebar',
        f('Order box heading', 'blogPage.sidebar.orderHeading') +
        f('Order box text', 'blogPage.sidebar.orderText', { type: 'textarea', rows: 2 }) +
        '<div class="grid2">' + num('Price shown (AED)', 'blogPage.sidebar.priceAmount') + f('Price unit', 'blogPage.sidebar.priceUnit', { placeholder: '/ 1g tin' }) + '</div>' +
        '<div class="grid2">' + f('Button text', 'blogPage.sidebar.waLabel') + '</div>' +
        f('WhatsApp message', 'blogPage.sidebar.waText', { type: 'textarea', rows: 2 }) +
        '<div class="subgrp"><div class="lbl">Links box</div>' +
        f('Heading', 'blogPage.sidebar.alsoHeading') +
        rowsEditor('blogPage.sidebar.links',
          [{ key: 'label', label: 'Text' }, { key: 'href', label: 'Link', w: '200px' }],
          'Add link', { label: '', href: '' }) + '</div>');
  }

  function secFaq() {
    return '<div class="page-h"><div><h2>FAQs</h2><p>Shown on the homepage, and sent to Google as FAQ rich-result data.</p></div></div>' +
      card('❓', 'Questions',
        '<div class="grid2">' + f('Small line', 'faq.eyebrow') + f('Heading', 'faq.heading') + '</div>' +
        listEditor('faq.items', 'faq', p =>
          f('Question', p + '.q') +
          f('Answer', p + '.a', { type: 'textarea', rows: 3, hint: MD_HINT }), 'Add question'));
  }

  function secTestimonials() {
    return '<div class="page-h"><div><h2>Testimonials</h2><p>Customer quotes on the homepage.</p></div></div>' +
      card('⭐', 'Quotes',
        '<div class="grid2">' + f('Small line', 'testimonials.eyebrow') + f('Heading', 'testimonials.heading') + '</div>' +
        listEditor('testimonials.items', 'testimonial', p =>
          f('Stars', p + '.stars', {
            type: 'select', coerce: 'number',
            options: [5, 4, 3, 2, 1].map(n => ({ v: n, l: '★'.repeat(n) + ' (' + n + ')' }))
          }) +
          f('Quote', p + '.quote', { type: 'textarea', rows: 3 }) +
          f('Name & city', p + '.name', { placeholder: 'Fatima Al-Rashidi, Dubai' }), 'Add testimonial'));
  }

  function secBrand() {
    return '<div class="page-h"><div><h2>Brand &amp; contact</h2><p>Used across every page — header, footer, contact strip, WhatsApp buttons and Google data.</p></div></div>' +
      card('🪪', 'Identity',
        '<div class="grid2">' + f('Brand name', 'brand.name') + f('Tagline under logo', 'brand.tagline') + '</div>' +
        f('Site address', 'brand.siteUrl', { hint: 'No trailing slash. Used for share links, sitemap and Google data.' }) +
        imgField('Logo', 'brand.logo') +
        imgField('Favicon (browser-tab icon)', 'brand.favicon') +
        imgField('Social-share image', 'brand.ogImage', { hint: 'Shown when the site is shared on WhatsApp, Facebook, etc. Ideal size 1200×630.' }) +
        f('Founding year', 'brand.foundingYear') +
        f('FSSAI registration number', 'brand.fssaiNumber', { placeholder: '21026111000535', hint: 'Shown in the footer as “FSSAI Registration No. …”. Leave blank to hide the line entirely.' }) +
        f('Company description for Google', 'brand.orgDescription', { type: 'textarea', rows: 2 })) +
      card('📞', 'Contact details',
        '<div class="grid2">' +
        f('Phone as displayed', 'brand.phoneDisplay', { placeholder: '+91 7006 603060' }) +
        f('Phone for tap-to-call', 'brand.phoneTel', { placeholder: '+917006603060', hint: 'Digits with country code, no spaces.' }) +
        '</div>' +
        '<div class="subgrp"><div class="lbl">WhatsApp order routing</div>' +
        '<div class="grid2">' +
        f('India number (orders and support)', 'brand.whatsappIndia', { placeholder: '917006603060', hint: 'Digits with country code, no spaces. This is the link everyone gets before JavaScript runs.' }) +
        f('UAE and Middle East number (enquiries and support)', 'brand.whatsappUae', { placeholder: '971522613060', hint: 'Digits with country code, no spaces. Used for visitors detected outside India.' }) +
        '</div>' +
        '<div class="hint">Order buttons load with the India number. Visitors detected in the UAE, Saudi, Qatar, Oman, Kuwait or Bahrain, or who pick AED, SAR, QAR or OMR in the currency menu, get the UAE number instead.</div></div>' +
        f('WhatsApp number (fallback if the two above are blank)', 'brand.whatsappNumber', { placeholder: '917006603060', hint: 'Country code + number, digits only.' }) +
        '<div class="subgrp"><div class="lbl">WhatsApp numbers for contact display</div>' +
        rowsEditor('brand.whatsappNumbers',
          [{ key: 'market', label: 'Market label', w: '200px', placeholder: 'UAE & Middle East' }, { key: 'number', label: 'Number (digits only)', placeholder: '971522613060' }],
          'Add number', { market: '', number: '' }) +
        '<div class="hint">Shown in the contact strip and footer. Each also becomes a ContactPoint in Google schema.</div></div>' +
        f('Default WhatsApp message', 'brand.defaultWaText', { type: 'textarea', rows: 2 }) +
        f('Email', 'brand.email')) +
      card('🔗', 'Social profiles',
        listEditor('brand.social', 'social', (p, it) =>
          '<div class="grid2">' +
          f('Platform', p + '.name', { placeholder: 'Instagram', hint: 'Instagram, Facebook, TikTok, Pinterest or LinkedIn. The footer icon is chosen from this name.' }) +
          f('Profile URL', p + '.url', { placeholder: 'https://www.instagram.com/yourhandle/' }) +
          '</div>' +
          '<div class="err" data-social-warn="' + p + '.name"' +
          (socialHasIcon(it.name) ? '' : ' style="display:block;"') + '>⚠ ' + A(SOCIAL_NO_ICON_MSG) + '</div>', 'Add profile') +
        '<div class="hint">Shown as icons in the footer, and sent to Google as the organisation&rsquo;s sameAs links. A platform with no matching icon is skipped in the footer.</div>') +
      card('📈', 'Analytics',
        '<div class="grid2">' +
        f('Google Analytics ID', 'brand.gaId', { placeholder: 'G-XXXXXXXXXX', hint: 'Leave blank to remove Google Analytics.' }) +
        f('Facebook Pixel ID', 'brand.fbPixelId', { hint: 'Leave blank to remove the pixel.' }) +
        '</div>');
  }

  function secSeo() {
    const pages = [['home', 'Home page'], ['products', 'Products page'], ['recipes', 'Recipes page'], ['blog', 'Blog page']];
    return '<div class="page-h"><div><h2>SEO &amp; meta</h2><p>Browser-tab titles, Google snippets, and social-share text for each page.</p></div></div>' +
      pages.map(pg => card('🔎', pg[1],
        f('Browser-tab / Google title', 'seo.' + pg[0] + '.title', { hint: 'Aim for ≤ 60 characters.' }) +
        f('Google description', 'seo.' + pg[0] + '.description', { type: 'textarea', rows: 2, hint: 'Aim for ≤ 160 characters.' }) +
        '<div class="grid2">' + f('Social-share title', 'seo.' + pg[0] + '.ogTitle') + '</div>' +
        f('Social-share description', 'seo.' + pg[0] + '.ogDescription', { type: 'textarea', rows: 2 })
      )).join('');
  }

  function secMedia() {
    return '<div class="page-h"><div><h2>Media</h2><p>Images in the repository. Click a filename to copy it, then paste into any image field.</p></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      (S.demo ? '' : '<button class="btn btn-outline btn-sm" data-action="find-unused" type="button">🔍 Find unused images</button>') +
      '<button class="btn btn-primary btn-sm" data-action="upload" data-path="@media" type="button">⤴ Upload image</button></div></div>' +
      (S.demo ? '<div class="banner purple"><div class="grow">Connect with a GitHub token to list and upload images.</div></div>' :
        '<div id="unused-panel"></div>' +
        '<div class="media-grid" id="media-grid"><div style="color:var(--muted);">Loading…</div></div>');
  }

  async function loadMedia() {
    if (S.demo) return;
    const grid = $('#media-grid');
    if (!grid) return;
    try {
      const list = await gh('/repos/' + S.cfg.owner + '/' + S.cfg.repo + '/contents?ref=' + encodeURIComponent(S.cfg.branch));
      const imgs = list.filter(x => x.type === 'file' && /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(x.name));
      if (!imgs.length) { grid.innerHTML = '<div style="color:var(--muted);">No images in the repository root yet.</div>'; return; }
      grid.innerHTML = imgs.map(x =>
        '<div class="media-cell">' +
        '<div class="imgbox" style="background-image:url(\'' + A(rawUrl(x.name)) + '?v=' + Date.now() + '\')"></div>' +
        '<div class="nm"><span>' + A(x.name) + '</span>' +
        '<button type="button" title="Copy filename" data-action="copy-name" data-name="' + A(x.name) + '">copy</button>' +
        '</div></div>').join('');
    } catch (e) {
      grid.innerHTML = '<div style="color:var(--danger);">Could not list images: ' + A(e.message) + '</div>';
    }
  }

  // Collect every image filename referenced anywhere in the content JSON.
  // site-data.json is the single source of truth, so any value that looks like
  // an image filename (logo, favicon, ogImage, product/recipe/post images, etc.)
  // is a reference. Returns a Set of lowercased filenames.
  function referencedImages(data) {
    const ref = new Set();
    JSON.stringify(data).replace(/[\w.\- ]+\.(?:png|jpe?g|webp|gif|svg|avif)/gi, function (m) {
      ref.add(m.trim().toLowerCase());
      return m;
    });
    return ref;
  }

  async function findUnusedImages() {
    if (S.demo) return;
    const panel = $('#unused-panel');
    if (!panel) return;
    panel.innerHTML = '<div class="banner"><div class="grow">Scanning the repository for unused images…</div></div>';
    try {
      const list = await gh('/repos/' + S.cfg.owner + '/' + S.cfg.repo + '/contents?ref=' + encodeURIComponent(S.cfg.branch));
      const imgs = list.filter(x => x.type === 'file' && /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(x.name));
      const ref = referencedImages(S.data);
      const unused = imgs.filter(x => !ref.has(x.name.toLowerCase()));
      if (!unused.length) {
        panel.innerHTML = '<div class="banner green"><div class="grow">Every image in the repository is used in your content. Nothing to clean up.</div></div>';
        return;
      }
      panel.innerHTML = '<div class="banner purple"><div class="grow"><strong>' + unused.length +
        ' image' + (unused.length === 1 ? '' : 's') + ' not referenced</strong> in your content. ' +
        'Deleting one removes it from the repository (publish history keeps a copy). Double-check before deleting.</div></div>' +
        '<div class="media-grid">' + unused.map(x =>
          '<div class="media-cell">' +
          '<div class="imgbox" style="background-image:url(\'' + A(rawUrl(x.name)) + '?v=' + Date.now() + '\')"></div>' +
          '<div class="nm"><span>' + A(x.name) + '</span>' +
          '<button type="button" class="del" title="Delete from repository" data-action="delete-image" data-name="' +
          A(x.name) + '" data-sha="' + A(x.sha) + '">delete</button>' +
          '</div></div>').join('') + '</div>';
    } catch (e) {
      panel.innerHTML = '<div class="banner"><div class="grow" style="color:var(--danger);">Could not scan images: ' + A(e.message) + '</div></div>';
    }
  }

  function secSettings() {
    const lp = S.data.meta && S.data.meta.lastPublished;
    return '<div class="page-h"><div><h2>Settings</h2><p>Connection, data and safety.</p></div></div>' +
      card('🔗', 'Connection',
        S.demo
          ? '<p style="color:var(--muted);font-size:14px;">Demo mode — not connected to GitHub. <a href="admin.html">Connect with a token</a> to publish changes.</p>'
          : '<p style="font-size:14px;">Connected as <strong>' + A(S.user) + '</strong> to <strong>' + A(S.cfg.owner + '/' + S.cfg.repo) +
            '</strong> on branch <strong>' + A(S.cfg.branch) + '</strong>.' +
            (lp ? '<br>Last published: ' + A(new Date(lp).toLocaleString()) : '') + '</p>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">' +
            '<button class="btn btn-outline btn-sm" data-action="reload-data" type="button">↻ Reload from GitHub (discard local edits)</button>' +
            '<button class="btn btn-outline btn-sm" data-action="backup" type="button">⬇ Download content backup</button>' +
            '<button class="btn btn-danger btn-sm" data-action="disconnect" type="button">Disconnect</button>' +
            '</div>') +
      card('📤', 'Publish method',
        '<div class="f"><label for="pubmode">How changes are committed</label>' +
        '<select id="pubmode" data-action="set-pubmode">' +
        '<option value="atomic"' + (publishMode() === 'atomic' ? ' selected' : '') + '>Single commit (recommended)</option>' +
        '<option value="contents"' + (publishMode() === 'contents' ? ' selected' : '') + '>One commit per file (legacy)</option>' +
        '</select></div>' +
        '<div class="hint">Single commit builds everything first and only then moves the branch, so a failure ' +
        'part-way through leaves the live site completely untouched. The legacy route writes each file ' +
        'separately and can leave the site half-updated if it fails; use it only if the new route misbehaves.</div>') +
      card('🛡️', 'Security notes',
        '<ul style="margin:6px 0 0 18px;padding:0;font-size:14px;line-height:1.7;color:#4d4136;">' +
        '<li>Your token is saved only in this browser (localStorage), never sent anywhere except api.github.com.</li>' +
        '<li>Use a <strong>fine-grained token</strong> limited to this one repository with <em>Contents: Read &amp; write</em> only.</li>' +
        '<li>You can revoke the token any time in GitHub → Settings → Developer settings.</li>' +
        '<li>This admin page is harmless to outsiders — without a token it cannot change anything.</li>' +
        '</ul>') +
      card('📘', 'Help',
        '<p style="font-size:14px;margin:4px 0;">Step-by-step instructions live in <a href="ADMIN-GUIDE.md" target="_blank" rel="noopener">ADMIN-GUIDE.md</a> in your site folder. ' +
        'Developers can also rebuild pages locally with <code>node build.js</code>.</p>');
  }

  function secDashboard() {
    const d = S.data;
    const b = d.brand;
    const siteU = siteUrl();
    const lp = d.meta && d.meta.lastPublished;
    const products = d.products || [];
    const posts = d.posts || [];

    // Quick links
    const gscHref = 'https://search.google.com/search-console?resource_id=' + encodeURIComponent(siteU + '/');
    const psiHref = 'https://pagespeed.web.dev/report?url=' + encodeURIComponent(siteU + '/');

    const quickLinks = card('🔗', 'Quick links',
      '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">' +
      (b.gaId
        ? '<a class="btn btn-outline btn-sm" href="https://analytics.google.com/" target="_blank" rel="noopener">📊 Google Analytics ↗</a>'
        : '<span style="font-size:13.5px;color:var(--muted);align-self:center;">Google Analytics — add a GA ID in <a href="#" data-goto="brand">Brand &amp; contact</a> first.</span>') +
      '<a class="btn btn-outline btn-sm" href="' + A(gscHref) + '" target="_blank" rel="noopener">🔎 Search Console ↗</a>' +
      '<a class="btn btn-outline btn-sm" href="' + A(psiHref) + '" target="_blank" rel="noopener">⚡ PageSpeed Insights ↗</a>' +
      '</div>'
    );

    // Stats
    const onSale = products.filter(p => p.sale && typeof p.sale.price === 'number');
    const outOfStock = products.filter(p => p.status === 'out_of_stock');
    const comingSoon = products.filter(p => p.status === 'coming_soon');

    function statRow(label, value) {
      return '<tr>' +
        '<td style="padding:8px 0;border-bottom:1px dashed var(--line);color:var(--muted);width:180px;font-size:14px;">' + label + '</td>' +
        '<td style="padding:8px 0;border-bottom:1px dashed var(--line);font-size:14px;font-weight:600;">' + value + '</td>' +
        '</tr>';
    }

    function pill(name, bg, color) {
      return '<span style="background:' + bg + ';color:' + color + ';border-radius:4px;padding:1px 7px;font-size:13px;font-weight:600;margin-right:4px;">' + A(name) + '</span>';
    }

    const statsHtml = card('📊', 'Site stats',
      '<table style="width:100%;border-collapse:collapse;">' +
      statRow('Products', products.length) +
      statRow('On sale', onSale.length || '—') +
      statRow('Out of stock', outOfStock.length ? outOfStock.map(p => pill(SOKTemplates.productView(p).name, '#fcebed', 'var(--danger)')).join('') : '—') +
      statRow('Coming soon', comingSoon.length ? comingSoon.map(p => pill(SOKTemplates.productView(p).name, '#fdf6e7', '#7c5a12')).join('') : '—') +
      statRow('Blog posts', posts.length) +
      statRow('Last published', lp ? A(new Date(lp).toLocaleString()) : '<span style="color:var(--muted);">Never</span>') +
      '</table>'
    );

    // Content QA
    const issues = [];

    products.forEach(p => {
      const nm = '<strong>' + A(SOKTemplates.productView(p).name) + '</strong>';
      if (!p.image) issues.push('Product ' + nm + ': no image set.');
      if (!p.altContext) issues.push('Product ' + nm + ': alt context is empty.');
      if (p.sale && !p.sale.until) issues.push('Product ' + nm + ': on sale with no "valid until" date set.');
    });

    [['home', 'Home'], ['products', 'Products'], ['recipes', 'Recipes'], ['blog', 'Blog']].forEach(([key, label]) => {
      const s = d.seo && d.seo[key];
      if (s) {
        if (!s.title) issues.push('<strong>' + label + ' page</strong>: SEO title is empty.');
        if (!s.description) issues.push('<strong>' + label + ' page</strong>: SEO description is empty.');
      }
    });

    posts.forEach(p => {
      const ttl = '<strong>' + A(p.title || p.id) + '</strong>';
      if (!p.excerpt) issues.push('Post ' + ttl + ': excerpt is empty.');
      if (!p.body) issues.push('Post ' + ttl + ': body is empty.');
    });

    const qa = card('✅', 'Content QA',
      issues.length === 0
        ? '<p style="color:var(--ok);font-size:14px;margin:8px 0 0;">✓ All clear — no issues found.</p>'
        : '<ul style="margin:10px 0 0 18px;padding:0;font-size:14px;line-height:1.9;">' +
          issues.map(i => '<li style="color:var(--danger);">⚠ ' + i + '</li>').join('') +
          '</ul>'
    );

    return '<div class="page-h"><div><h2>Dashboard</h2>' +
      '<p>At-a-glance overview — read-only, no API calls, built entirely from your current content.</p></div></div>' +
      quickLinks + statsHtml + qa;
  }

  function secPolicies() {
    const pols = S.data.policies || {};
    const warn = '<p style="background:#fdf6e7;border:1px solid #e8c96a;border-radius:6px;padding:10px 14px;font-size:13.5px;color:#7c5a12;margin:0 0 16px;">' +
      '⚠ These are legal pages. Do not add a business address, and do not say where parcels are sent from. ' +
      'Both are deliberate. Have a lawyer read the Terms page before changing it.</p>';
    const cards = Object.keys(pols).map(function (k) {
      const p = pols[k];
      return card('📄', A(p.title || k),
        '<div class="grid2">' +
        f('Page title (the H1)', 'policies.' + k + '.title') +
        f('Last updated', 'policies.' + k + '.lastUpdated', { placeholder: '29 August 2026', hint: 'Shown under the heading. Plain text, not a date picker.' }) +
        '</div>' +
        f('File name', 'policies.' + k + '.slug', { hint: 'Changing this moves a live URL. Do not change it without a redirect.' }) +
        f('Browser tab title', 'policies.' + k + '.metaTitle') +
        f('Search description', 'policies.' + k + '.metaDescription', { type: 'textarea', rows: 2 }) +
        '<div class="subgrp"><div class="lbl">Sections</div>' +
        listEditor('policies.' + k + '.sections', 'policySection', (path) =>
          f('Heading', path + '.heading', { hint: 'Leave blank for an intro paragraph with no heading.' }) +
          f('Body', path + '.body', { type: 'textarea', rows: 8, hint: 'Blank line starts a new paragraph. A block of lines each starting "- " becomes a bullet list. **bold**, *italic*, [link](url) and `code` all work.' }),
          'Add section') +
        '</div>');
    }).join('');
    return warn + cards;
  }

  function secOverlay() {
    const ov = S.data.overlay || {};
    const enabled = ov.enabled;
    const statusNote = enabled
      ? '<p style="background:#e6f9ee;border:1px solid #b2dfca;border-radius:6px;padding:10px 14px;font-size:13.5px;color:#1a6b3a;margin:0 0 16px;">🟢 Overlay is <strong>live</strong>. Visitors who haven\'t seen it yet will see it after 4 seconds or on first scroll.</p>'
      : '<p style="background:#fdf6e7;border:1px solid #e8c96a;border-radius:6px;padding:10px 14px;font-size:13.5px;color:#7c5a12;margin:0 0 16px;">⚠ Overlay is <strong>disabled</strong>. Enable it below once you\'re ready.</p>';
    const toggleCard = card('🎁', 'Overlay status',
      statusNote +
      f('Enable overlay', 'overlay.enabled', { type: 'checkbox' })
    );
    const contentCard = card('✏️', 'Content',
      f('Heading', 'overlay.heading', { placeholder: 'Welcome — 10% Off Your First Order' }) +
      f('Body text', 'overlay.text', { type: 'textarea', rows: 2 }) +
      f('Discount label (shown large)', 'overlay.discountText', { placeholder: '10% off your first order' }) +
      f('Button label', 'overlay.buttonLabel', { placeholder: 'Claim My Discount' }) +
      f('Success message', 'overlay.successText', { placeholder: 'Thank you! Your discount code is on its way — check your inbox.' }) +
      imgField('Optional image (left of form)', 'overlay.image', { hint: 'Leave blank for no image. Use a portrait or square image, max ~400 px wide.' })
    );
    const settingsCard = card('⚙️', 'Settings',
      f('Mailchimp form endpoint', 'overlay.formEndpoint', {
        hint: 'Paste the full URL from your Mailchimp embedded form (the "action" attribute). Must contain /subscribe/post?',
        placeholder: 'https://yourlist.us5.list-manage.com/subscribe/post?u=…&id=…'
      }) +
      f('Privacy policy link (href)', 'overlay.privacyHref', {
        placeholder: 'privacy-policy.html',
        hint: 'Relative path to your privacy policy page.'
      })
    );
    return '<div class="page-h"><div><h2>Discount overlay</h2>' +
      '<p>First-visit email capture — shows after 4 s or first scroll, once per session, never again after subscription.</p></div></div>' +
      toggleCard + contentCard + settingsCard;
  }

  function secCurrencies() {
    const b = S.data.brand;
    const base = b.baseCurrency || 'AED';
    const currs = b.currencies || {};
    const order = ['AED', 'USD', 'INR', 'SAR', 'QAR', 'OMR'];
    const rateRows = order.filter(c => currs[c]).map(c => {
      const cu = currs[c];
      const isBase = c === base;
      return card('💱', cu.name + ' (' + c + ')' + (isBase ? ' — base currency' : ''),
        f('Display symbol', 'brand.currencies.' + c + '.symbol', { placeholder: c }) +
        (isBase
          ? '<p style="font-size:13px;color:var(--muted);margin:4px 0 0;">Rate is always 1 — this is the base.</p>'
          : num('Exchange rate (1 ' + base + ' = ? ' + c + ')', 'brand.currencies.' + c + '.rate', { placeholder: '1.0' })) +
        (isBase
          ? ''
          : num('Price adjustment (%)', 'brand.currencies.' + c + '.markup', {
              placeholder: '0',
              hint: 'Applied on top of the exchange rate. Positive = mark up (e.g. 15 adds 15% for shipping). Negative = mark down (e.g. -20 lowers price by 20%). 0 = pure conversion.'
            })) +
        num('Decimal places', 'brand.currencies.' + c + '.decimals', { placeholder: '2' })
      );
    }).join('');
    return '<div class="page-h"><div><h2>Currencies &amp; rates</h2>' +
      '<p>Rates are applied client-side. Update them whenever exchange rates drift significantly.</p></div></div>' +
      '<div class="card" style="background:#fdf6e7;border-color:#e8c96a;">' +
      '<p style="font-size:13.5px;margin:0;">ℹ Prices are stored in <strong>' + A(base) + '</strong>. All other currencies are converted at the rates below. After changing rates, publish to update the live site.</p>' +
      '</div>' +
      rateRows;
  }

  const SECTIONS = {
    dashboard: secDashboard,
    home: secHome, products: secProducts, recipes: secRecipes, posts: secPosts,
    faq: secFaq, testimonials: secTestimonials, brand: secBrand, seo: secSeo,
    media: secMedia, settings: secSettings, overlay: secOverlay, currencies: secCurrencies,
    policies: secPolicies
  };

  function render(sec) {
    S.section = sec || S.section;
    $$('#sidenav button').forEach(b => b.classList.toggle('active', b.dataset.sec === S.section));
    $('#panel').innerHTML = SECTIONS[S.section]();
    if (S.section === 'media') loadMedia();
    window.scrollTo(0, 0);
  }
  function rerender() {                      // keep scroll position on structural edits
    const y = window.scrollY;
    $('#panel').innerHTML = SECTIONS[S.section]();
    if (S.section === 'media') loadMedia();
    window.scrollTo(0, y);
  }

  /* ================= events ================= */

  function coerce(el) {
    const c = el.dataset.coerce;
    if (el.type === 'checkbox') return el.checked;
    if (c === 'number') { const n = Number(el.value); return el.value === '' || isNaN(n) ? 0 : n; }
    if (c === 'lines') return el.value.split('\n');
    return el.value;
  }

  document.addEventListener('input', e => {
    const el = e.target;
    if (!el.dataset || !el.dataset.path || S.data == null) return;
    /* Second line. `disabled` is a rendering decision and a rendering decision
       can be undone from the browser console in four seconds. This refuses the
       write itself. Neither is the enforcing copy: tools/check_locked.py is,
       and it runs after the push where nobody can reach it. */
    const wlock = lockedFor(el.dataset.path);
    if (wlock) {
      toast('Locked: ' + wlock.what + '. ' + gateDev(), 7000);
      rerender();
      return;
    }
    setPath(S.data, el.dataset.path, coerce(el));
    if (el.dataset.img !== undefined) {
      const th = $('[data-thumb-for="' + el.dataset.path + '"]');
      if (th) {
        const v = el.value.trim();
        th.style.backgroundImage = v ? 'url("' + rawUrl(v).replace(/"/g, '\\"') + '")' : '';
        th.textContent = v ? '' : 'no image';
      }
    }
    /* keep the "no footer icon" warning truthful while typing */
    if (/^brand\.social\.\d+\.name$/.test(el.dataset.path)) {
      const w = $('[data-social-warn="' + el.dataset.path + '"]');
      if (w) w.style.display = socialHasIcon(el.value) ? '' : 'block';
    }
    markDirty();
  });

  document.addEventListener('change', e => {        // tidy line-lists on blur
    const el = e.target;
    if (el && el.dataset && el.dataset.action === 'set-pubmode') {
      setPublishMode(el.value);
      toast(el.value === 'atomic' ? 'Publishing as a single commit.' : 'Publishing one commit per file (legacy).');
      return;
    }
    if (!el.dataset || !el.dataset.path || S.data == null) return;
    if (el.dataset.coerce === 'lines') {
      const arr = el.value.split('\n').map(s => s.trim()).filter(Boolean);
      setPath(S.data, el.dataset.path, arr);
      el.value = arr.join('\n');
      markDirty();
    }
  });

  document.addEventListener('click', e => {
    /* close preview menu when clicking elsewhere */
    if (!e.target.closest('.menu-wrap')) $('#preview-menu').classList.remove('open');

    const nav = e.target.closest('#sidenav [data-sec]');
    if (nav) { render(nav.dataset.sec); return; }

    const t = e.target.closest('[data-action],[data-goto],[data-preview]');
    if (!t) return;

    if (t.dataset.goto) { e.preventDefault(); render(t.dataset.goto); return; }
    if (t.dataset.preview) { openPreview(t.dataset.preview); $('#preview-menu').classList.remove('open'); return; }

    const act = t.dataset.action;
    const listPath = t.dataset.list;
    const idx = t.dataset.idx != null ? Number(t.dataset.idx) : null;
    const arr = listPath ? getPath(S.data, listPath) : null;

    /* Adding, deleting, duplicating or reordering a locked list changes it
       just as surely as typing in it does. */
    if (listPath && ['add', 'del', 'dup', 'up', 'down', 'row-add', 'row-del'].indexOf(act) !== -1) {
      const llock = lockedFor(listPath);
      if (llock) {
        toast('Locked: ' + llock.what + '. ' + gateDev(), 7000);
        return;
      }
    }

    switch (act) {
      case 'toggle': {
        if (e.target.closest('.ctrl')) return;
        arr[idx]._open = !arr[idx]._open;
        rerender(); break;
      }
      case 'add': {
        arr.forEach(it => { it._open = false; });
        arr.push(KINDS[t.dataset.kind].make());
        markDirty(); rerender();
        break;
      }
      case 'del': {
        if (confirm('Delete this item? You can still undo by not publishing, or via Settings → Reload from GitHub.')) {
          arr.splice(idx, 1); markDirty(); rerender();
        }
        break;
      }
      case 'dup': {
        const cp = clone(arr[idx]); cp._open = true;
        if (cp.id) cp.id = cp.id + '-copy';
        arr.splice(idx + 1, 0, cp); markDirty(); rerender();
        break;
      }
      case 'up': {
        if (idx > 0) { const x = arr.splice(idx, 1)[0]; arr.splice(idx - 1, 0, x); markDirty(); rerender(); }
        break;
      }
      case 'down': {
        if (idx < arr.length - 1) { const x = arr.splice(idx, 1)[0]; arr.splice(idx + 1, 0, x); markDirty(); rerender(); }
        break;
      }
      case 'row-add': {
        arr.push(JSON.parse(t.dataset.defaults)); markDirty(); rerender(); break;
      }
      case 'row-del': {
        arr.splice(idx, 1); markDirty(); rerender(); break;
      }
      case 'toggle-compare': {
        const pItem = S.data.products[idx];
        pItem.compare = t.checked ? { servings: '', bestFor: '' } : null;
        markDirty(); rerender();
        break;
      }
      case 'toggle-sale': {
        const pItem = S.data.products[idx];
        pItem.sale = t.checked ? { price: 0, label: '', until: '' } : null;
        markDirty(); rerender();
        break;
      }
      case 'slugify': {
        S.data.posts[idx].id = slugify(S.data.posts[idx].title);
        markDirty(); rerender(); break;
      }
      case 'autodate': {
        S.data.posts[idx].dateDisplay = dateDisplayFrom(S.data.posts[idx].dateISO);
        markDirty(); rerender(); break;
      }
      case 'upload': {
        if (S.demo) { toast('Uploads are disabled in demo mode'); return; }
        S.pendingImagePath = t.dataset.path;
        $('#file-input').click();
        break;
      }
      case 'copy-name': {
        navigator.clipboard.writeText(t.dataset.name).then(
          () => toast('Copied “' + t.dataset.name + '”'),
          () => toast('Copy failed — select it manually'));
        break;
      }
      case 'find-unused': {
        findUnusedImages();
        break;
      }
      case 'delete-image': {
        const nm = t.dataset.name;
        if (!confirm('Delete “' + nm + '” from the repository? This cannot be undone from here (the file stays in your Git history).')) break;
        toast('Deleting ' + nm + '…', 60000);
        deleteFile(nm, t.dataset.sha, 'Delete unused image ' + nm + ' via site admin').then(
          () => { toast('Deleted ' + nm + ' ✓'); findUnusedImages(); loadMedia(); },
          (err) => toast('Could not delete: ' + err.message));
        break;
      }
      case 'reload-data': {
        if (confirm('Discard local edits and reload the content currently on GitHub?')) reloadFromGitHub();
        break;
      }
      case 'backup': {
        const blob = new Blob([cleanJson(S.data, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'site-data-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click(); URL.revokeObjectURL(a.href);
        break;
      }
      case 'disconnect': {
        if (confirm('Disconnect this browser? Your token will be removed. Unpublished local edits are kept as a draft.')) {
          localStorage.removeItem(LS_CFG);
          location.hash = ''; location.reload();
        }
        break;
      }
      case 'resume-draft': { applyDraft(); break; }
      case 'discard-draft': { clearDraft(); $('#draft-banner').innerHTML = ''; toast('Draft discarded'); break; }
    }
  });

  /* image upload */
  $('#file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024 &&
        !confirm('This image is ' + (file.size / 1048576).toFixed(1) + ' MB. Large images slow your site down — upload anyway?')) return;

    /* Uploads land in the repository ROOT, because that is where every image
       on this site already lives and moving them would rewrite every reference
       in the data file. The root also holds build.js, robots.txt, CNAME and
       .nojekyll, and the old sanitiser happily produced any of those names: it
       stripped slashes but permitted every extension, so an upload called
       build.js offered to replace the build script and would have done it.

       Nothing here can reach another directory, because the sanitiser removes
       the slash. What it needed was a rule about WHICH root names an image may
       take. An allow-list of image extensions is that rule, and it refuses
       build.js, robots.txt and CNAME by construction rather than by listing
       them. The existing-file rule below is the second line: it refuses to
       overwrite anything in the root that is not itself an image, whatever it
       is called. */
    const name = file.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
    const bad = imageNameProblem(name, file);
    if (bad) { toast(bad, 11000); return; }
    toast('Uploading ' + name + '…', 60000);
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = () => rej(new Error('Could not read the file'));
        r.readAsDataURL(file);
      });
      let sha = null;
      try {
        const cur = await gh(repoPath(name) + '?ref=' + encodeURIComponent(S.cfg.branch));
        if (!isImageName(name)) {
          toast('Not uploaded. There is already a file called "' + name + '" in the site folder and it is ' +
                'not an image, so replacing it would break the site. Rename your image and try again.', 12000);
          return;
        }
        if (!confirm('“' + name + '” already exists in the repository. Replace it?')) { toast('Upload cancelled'); return; }
        sha = cur.sha;
      } catch (err) { if (err.status !== 404) throw err; }
      await putFile(name, b64, 'Upload image ' + name + ' via site admin', sha);
      if (S.pendingImagePath && S.pendingImagePath !== '@media') {
        setPath(S.data, S.pendingImagePath, name);
        markDirty();
      }
      toast('Uploaded ' + name + ' ✓');
      rerender();
    } catch (err) {
      toast('Upload failed: ' + err.message, 5000);
    } finally {
      S.pendingImagePath = null;
    }
  });

  /* ---------- image upload rules ---------- */

  const IMAGE_EXT = ['.webp', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.avif'];

  function isImageName(name) {
    const n = String(name || '').toLowerCase();
    for (let i = 0; i < IMAGE_EXT.length; i++) {
      const ext = IMAGE_EXT[i];
      if (n.length > ext.length && n.slice(-ext.length) === ext) return true;
    }
    return false;
  }

  /* Returns a sentence to show the user, or null when the name is fine. */
  function imageNameProblem(name, file) {
    if (!name || name.charAt(0) === '.') {
      return 'Not uploaded. "' + (file && file.name ? file.name : 'that file') +
        '" does not leave a usable file name once spaces and punctuation are removed. Rename it and try again.';
    }
    if (!isImageName(name)) {
      return 'Not uploaded. "' + name + '" is not an image. This button only accepts ' +
        IMAGE_EXT.join(', ') + ' files, because anything else would be saved into the site folder ' +
        'alongside files the site is built from. Save your picture as a .webp or .jpg and try again.';
    }
    const type = file && file.type ? String(file.type) : '';
    if (type && type.indexOf('image/') !== 0) {
      return 'Not uploaded. "' + name + '" is named like an image but the file is a ' + type +
        '. Save it as a real image and try again.';
    }
    return null;
  }

  /* preview */
  function openPreview(file) {
    const map = {
      'index.html': SOKTemplates.renderIndex, 'products.html': SOKTemplates.renderProducts,
      'recipes.html': SOKTemplates.renderRecipes, 'blogs.html': SOKTemplates.renderBlogs,
      '404.html': SOKTemplates.render404
    };
    // Every policy page previews through the one shared renderer.
    Object.keys(S.data.policies || {}).forEach(function (k) {
      map[S.data.policies[k].slug] = function (d) { return SOKTemplates.renderPolicyPage(d, k); };
    });
    // Post pages, drafts included, so a draft can be previewed before it ships.
    (S.data.posts || []).forEach(function (p) {
      map['blog/' + SOKTemplates.postSlug(p) + '/index.html'] =
        function (d) { return SOKTemplates.renderPostPage(d, p); };
    });
    try {
      let html = map[file](S.data);
      const base = (S.demo && location.protocol !== 'file:') ? location.href.replace(/admin\.html.*$/, '') : siteUrl() + '/';
      html = html.replace('<head>', '<head><base href="' + base + '">');
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank');
      toast('Preview opened — images & styles load from your live site; links open live pages.');
    } catch (err) {
      toast('Preview failed: ' + err.message, 5000);
    }
  }

  $('#preview-btn').addEventListener('click', () => $('#preview-menu').classList.toggle('open'));

  /* ================= publish ================= */

  function validate() {
    const d = S.data;
    d.brand.siteUrl = String(d.brand.siteUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/.+/.test(d.brand.siteUrl)) return 'Brand & contact → Site address must start with https://';
    if (!d.brand.name.trim()) return 'Brand & contact → Brand name is required.';
    if (!d.brand.whatsappNumber.trim()) return 'Brand & contact → WhatsApp number is required.';
    for (const p of d.products) {
      if (!p.baseName || !p.baseName.trim()) return 'Products → every product needs a base name.';
      if (typeof p.price !== 'number' || p.price < 0) return 'Products → “' + SOKTemplates.productView(p).name + '” needs a valid price.';
    }
    const ids = {};
    for (const post of d.posts) {
      if (!/^[a-z0-9-]+$/.test(post.id)) return 'Blog posts → “' + post.title + '”: the link id may only contain lowercase letters, numbers and dashes (use the “From title” button).';
      if (ids[post.id]) return 'Blog posts → two articles share the link id “' + post.id + '”. Make them unique.';
      ids[post.id] = 1;
    }
    return null;
  }

  function pubRowsHtml(files) {
    return Object.keys(files).map(p =>
      '<div class="pub-row" data-file="' + p + '"><span>' + p + '</span><span class="st">queued</span></div>'
    ).join('');
  }
  function setRow(p, txt, cls) {
    const r = $('.pub-row[data-file="' + p + '"] .st');
    if (r) { r.textContent = txt; r.className = 'st ' + (cls || ''); }
  }

  /* stage list for the atomic route: one commit, so per-file rows would lie */
  const PUB_STAGES = [
    ['read', 'Reading current state'],
    ['blobs', 'Uploading files'],
    ['commit', 'Creating commit'],
    ['ref', 'Updating branch']
  ];
  function pubStagesHtml() {
    return PUB_STAGES.map(s =>
      '<div class="pub-row" data-stage="' + s[0] + '"><span>' + s[1] + '</span><span class="st">waiting</span></div>'
    ).join('');
  }
  function setStage(key, txt, cls) {
    const r = $('.pub-row[data-stage="' + key + '"] .st');
    if (r) { r.textContent = txt; r.className = 'st ' + (cls || ''); }
  }

  let publishing = false;

  function openPublish() {
    if (S.demo) { toast('Publishing is disabled in demo mode — connect with a GitHub token.'); return; }
    const err = validate();
    if (err) { toast(err, 6000); return; }
    const files = SOKTemplates.renderAll(S.data);
    $('#pub-rows').innerHTML = publishMode() === 'atomic'
      ? pubStagesHtml()
      : pubRowsHtml(Object.assign({}, files, { [DATA_PATH]: 1 }));
    $('#pub-note').style.display = 'none';
    $('#pub-go').disabled = false;
    $('#pub-go').textContent = 'Publish now';
    $('#pub-overlay').classList.add('open');
  }

  /* Why a branch update was refused, in words that name the actual cause.

     THREE DIFFERENT FAULTS COME BACK AS HTTP 422. The panel used to map every
     422 and 409 to "the branch moved while this publish was being prepared,
     so the update was refused rather than overwriting someone else's commit".
     That is one of the three. When the real cause was the ruleset, the owner
     went looking for someone else's commit that did not exist.

     Captured from the live API on 11 Sep 2026 by provoking each one against a
     scratch branch, rather than written from memory:

       PATCH /git/refs/heads/<protected branch>, commit with no CI run
         422  Repository rule violations found
              Required status check "verify" is expected.

       PATCH /git/refs/heads/<branch>, sha behind the tip, force false
         422  Update is not a fast forward

       PATCH /git/refs/heads/<branch that is not there>
         422  Reference does not exist

     The third is the one most worth separating. A mistyped or deleted branch
     is not a race and has nothing to do with anyone else's work, and telling
     someone to reload and re-apply their edits will not fix it.

     `forced` lets the caller state a cause it already knows, for the case
     where the panel detects the race itself rather than being told by a 422. */
  function classifyRefFault(err, forced) {
    const branch = (forced && forced.branch) || S.cfg.branch;
    const raw = (err && err.message) ? String(err.message) : '';
    const status = err ? err.status : 0;
    const NOTHING = '<strong style="color:var(--danger);">Nothing was published.</strong> ';
    const SAFE = ' Your edits are still here and the live site is unchanged.';

    function detailOf(text) {
      /* The rules body is a headline, a blank line, then the rule that fired. */
      const rest = text.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
      return rest ? '<br><br>The rule that refused it: <em>' + A(rest) + '</em>' : '';
    }

    const kind = (forced && forced.kind) ? forced.kind
      : status === 401 ? 'auth'
      : status === 403 ? 'permission'
      : /^Repository rule violations found/.test(raw) ? 'rules'
      : /not a fast forward/i.test(raw) ? 'moved'
      : /Reference does not exist/i.test(raw) ? 'missing'
      : 'unknown';

    if (kind === 'moved') {
      const where = (forced && forced.from && forced.to)
        ? '<br><br>You started from <code>' + A(String(forced.from).slice(0, 7) )+
          '</code> and <em>' + A(branch) + '</em> is now on <code>' +
          A(String(forced.to).slice(0, 7)) + '</code>.'
        : '';
      return { kind: kind, html: NOTHING +
        'Someone else published to <em>' + A(branch) + '</em> while your changes were being ' +
        'uploaded, so this was refused rather than writing over their work.' + where +
        '<br><br>Go to Settings, choose <em>Reload from GitHub</em>, re-apply your edits and ' +
        'publish again. Nothing of theirs was lost and nothing of yours has gone anywhere yet.' };
    }

    if (kind === 'rules') {
      return { kind: kind, html: NOTHING +
        'The <em>' + A(branch) + '</em> branch has a protection rule that refused this change. ' +
        'This is not about anyone else\'s work and nothing is lost.' + detailOf(raw) +
        '<br><br>If that mentions a status check, this panel is publishing straight at a ' +
        'protected branch. It should be publishing to <code>content</code>, which is checked ' +
        'automatically and then goes live on its own. Open Settings and check the branch name.' +
        SAFE };
    }

    if (kind === 'missing') {
      return { kind: kind, html: NOTHING +
        'There is no branch called <em>' + A(branch) + '</em> in this repository, so there was ' +
        'nothing to publish to. Nobody else is involved and nothing raced you.' +
        '<br><br>Open Settings and check the branch name. It should normally be ' +
        '<code>content</code>.' + SAFE };
    }

    if (kind === 'permission') {
      return { kind: kind, html: NOTHING +
        'This token is not allowed to write to <em>' + A(branch) + '</em>.' +
        '<br><br>It needs <em>Contents: Read and write</em> on this repository. If it is a ' +
        'fine-grained token it may also have expired. Send this message to a developer.' + SAFE };
    }

    if (kind === 'auth') {
      return { kind: kind, html: NOTHING +
        'GitHub rejected the token. It has most likely expired.' +
        '<br><br>Generate a new one and reconnect from the login screen.' + SAFE };
    }

    return { kind: 'unknown', html: NOTHING +
      'GitHub refused to move the <em>' + A(branch) + '</em> branch and gave this reason: <em>' +
      A(raw || 'no reason given') + '</em> (HTTP ' + A(String(status || '?')) + ').' +
      '<br><br>That is not one of the causes this panel knows how to explain, so send this ' +
      'message to a developer rather than guessing.' + SAFE };
  }

  /* Atomic route. Steps a-e touch nothing the branch can see; only step f
     moves it. Any failure before f returns early, so the branch is never
     left half-updated. Returns { ok, written, note } or { ok:false, ... }. */
  async function publishAtomic(files) {
    const paths = Object.keys(files);

    /* (a) ref -> base commit, (b) base commit -> base tree, plus the tree
       listing used to skip unchanged files */
    setStage('read', 'working…', 'run');
    let headSha, baseTreeSha, baseBlobs = null;
    try {
      const ref = await apiGetRef();                     // a
      headSha = ref.object.sha;
      const commit = await apiGetCommit(headSha);        // b
      baseTreeSha = commit.tree.sha;
      const tree = await apiGetTree(baseTreeSha);
      if (!tree.truncated) {
        baseBlobs = {};
        (tree.tree || []).forEach(e => { if (e.type === 'blob') baseBlobs[e.path] = e.sha; });
      }
    } catch (err) {
      setStage('read', 'failed', 'err');
      return { ok: false, stage: 'Reading current state', err: err };
    }
    setStage('read', 'done', 'ok');

    /* work out which files actually differ from the base tree */
    let changed;
    if (baseBlobs) {
      const keep = [];
      let canHash = true;
      for (const p of paths) {
        const sha = await gitBlobSha(files[p]);
        if (sha === null) { canHash = false; break; }   // no SubtleCrypto: send everything
        if (baseBlobs[p] !== sha) keep.push(p);
      }
      changed = canHash ? keep : paths;
    } else {
      changed = paths;                                  // tree truncated: cannot diff safely
    }

    if (!changed.length) {
      setStage('blobs', 'nothing changed', 'skip');
      setStage('commit', 'skipped', 'skip');
      setStage('ref', 'skipped', 'skip');
      return { ok: true, written: 0, noop: true };
    }

    /* (c) one blob per changed file */
    const entries = [];
    for (let i = 0; i < changed.length; i++) {
      setStage('blobs', 'uploading ' + (i + 1) + ' of ' + changed.length + '…', 'run');
      try {
        const blob = await apiCreateBlob(b64encode(files[changed[i]]));   // c
        entries.push({ path: changed[i], mode: '100644', type: 'blob', sha: blob.sha });
      } catch (err) {
        setStage('blobs', 'failed', 'err');
        return { ok: false, stage: 'Uploading files', err: err };
      }
    }
    setStage('blobs', changed.length + ' of ' + changed.length + ' uploaded', 'ok');

    /* (d) tree + (e) commit */
    setStage('commit', 'working…', 'run');
    let newCommit;
    try {
      const tree = await apiCreateTree(baseTreeSha, entries);             // d
      newCommit = await apiCreateCommit(
        'Update site content via admin (' + changed.length + ' file' + (changed.length === 1 ? '' : 's') + ')',
        tree.sha, headSha);                                              // e
    } catch (err) {
      setStage('commit', 'failed', 'err');
      return { ok: false, stage: 'Creating commit', err: err };
    }
    setStage('commit', 'done', 'ok');

    /* (e2) THE REF WINDOW.

       Step (a) read the branch tip, and the commit built above names it as its
       parent. Between then and now, 33 blobs went up one at a time. If someone
       published during that window the tip has moved, this commit's parent is
       no longer it, and moving the ref would either be refused or, with force,
       would quietly discard their work.

       Reading the ref once at the start and trusting it for the rest of the
       upload is the bug. What a ref read tells you is only true at the instant
       it is read, and that instant was thirty-odd HTTP round trips ago.

       Re-reading here does not make the window zero. Nothing client-side can,
       which is why force stays false and GitHub remains the final arbiter.
       What it buys is the explanation: a race caught here can name both
       commits and say plainly what happened, instead of surfacing as a 422
       that has to be guessed at afterwards. */
    setStage('ref', 'checking the branch…', 'run');
    let tipNow;
    try {
      tipNow = (await apiGetRef()).object.sha;
    } catch (err) {
      setStage('ref', 'failed', 'err');
      return { ok: false, stage: 'Updating branch', err: err, fault: classifyRefFault(err) };
    }
    if (tipNow !== headSha) {
      setStage('ref', 'refused', 'err');
      return {
        ok: false, stage: 'Updating branch',
        fault: classifyRefFault(null, { kind: 'moved', from: headSha, to: tipNow })
      };
    }

    /* (f) the only step that mutates the branch */
    setStage('ref', 'working…', 'run');
    try {
      await apiUpdateRef(newCommit.sha);                                 // f
    } catch (err) {
      setStage('ref', 'failed', 'err');
      return { ok: false, stage: 'Updating branch', err: err, fault: classifyRefFault(err) };
    }
    setStage('ref', 'done', 'ok');
    return { ok: true, written: changed.length, commit: newCommit.sha };
  }

  /* Pre-publish version guard.

     Compares the build id of the templates this panel actually loaded against
     the id on the live site. A mismatch means the site was rebuilt after this
     panel opened, so publishing now would regenerate every page with older
     templates and silently revert them. That happened on 29 Aug 2026 and cost
     a day of orphaned blog and policy pages.

     Blocking a publish is always preferable to silently reverting the site, so
     this returns a message on mismatch and only publishes on a clean match or
     an explicit "cannot tell" with the user's consent. */
  async function templatesAreCurrent() {
    /* Every fail-open path warns. A guard that quietly does nothing is worse
       than no guard, because it reads as protection that is not there. */
    const SKIP = 'Publish version guard SKIPPED: ';
    const UNGUARDED = ' Publishing UNGUARDED.';

    if (!window.SOKTemplates) {
      console.warn(SKIP + 'SOKTemplates is not loaded, so there is no build id to compare against.' + UNGUARDED);
      return { ok: true, note: 'SOKTemplates absent, guard skipped' };
    }
    const loaded = SOKTemplates.BUILD_ID || '';
    if (!loaded || loaded === 'dev') {
      console.warn(SKIP + 'templates carry an unstamped build id (' + (loaded || 'none') +
        '). Run node build.js to stamp one.' + UNGUARDED);
      return { ok: true, note: 'unstamped build, guard skipped' };
    }

    let res;
    try {
      res = await fetch(siteUrl() + '/build-id.json?cb=' + Date.now(), { cache: 'no-store' });
    } catch (err) {
      console.warn(SKIP + 'could not fetch build-id.json (' + err.message +
        '). A network problem is not evidence of staleness.' + UNGUARDED);
      return { ok: true, note: 'fetch failed, guard skipped' };
    }
    if (!res.ok) {
      console.warn(SKIP + 'build-id.json returned HTTP ' + res.status +
        '. If this is 404 the live site predates the guard.' + UNGUARDED);
      return { ok: true, note: 'build-id.json HTTP ' + res.status + ', guard skipped' };
    }

    let live = '';
    try {
      live = (await res.json()).buildId || '';
    } catch (err) {
      console.warn(SKIP + 'build-id.json did not parse as JSON (' + err.message + ').' + UNGUARDED);
      return { ok: true, note: 'build-id.json unparseable, guard skipped' };
    }
    if (!live) {
      console.warn(SKIP + 'live build-id.json carries no buildId value.' + UNGUARDED);
      return { ok: true, note: 'live build id empty, guard skipped' };
    }

    if (live === loaded) return { ok: true, note: 'build id matches (' + live + ')' };
    return {
      ok: false,
      loaded: loaded,
      live: live,
      msg: 'Publish blocked. This panel loaded templates ' + loaded +
           ' but the live site is on ' + live + '. Someone rebuilt the site after you opened this page. ' +
           'Publishing now would overwrite every page using the older templates. ' +
           'Reload the panel (Ctrl+Shift+R) and try again.'
    };
  }

  /* Pre-publish data guard.

     The build-id guard above compares TEMPLATE versions. It does not compare
     DATA, and that gap is the other half of the 29 Aug 2026 mechanism: a panel
     holding an older data/site-data.json publishes its own snapshot over the
     current one, reverting content silently.

     Nothing downstream catches it. A stale-data publish is internally
     consistent, so the data and the pages regenerated from it agree with each
     other and every CI check passes. publishAtomic commits with parent = the
     current head and force:false, so no history is lost; the content is simply
     reverted by a legitimate fast-forward.

     This compares the blob sha of the file this panel loaded against the sha on
     the branch right now. Mismatch means someone changed the data after this
     panel opened.

     Fail-open policy matches templatesAreCurrent: a network failure is not
     evidence of staleness. Unknown draft provenance is different, and fails
     CLOSED, because that is a known unknown rather than a blip. */
  async function dataIsCurrent() {
    const SKIP = 'Publish data guard SKIPPED: ';
    const UNGUARDED = ' Publishing UNGUARDED.';

    if (S.demo) return { ok: true, note: 'demo mode, no repo to compare against' };

    if (S.dataSha === null) {
      return {
        ok: false,
        loaded: '(unknown)',
        live: '(not checked)',
        msg: 'Publish blocked. This session restored an unpublished draft that does ' +
             'not record which version of the site data it was edited on top of, so ' +
             'there is no way to tell whether publishing it would revert someone ' +
             'else\'s changes. Copy anything you need out of the panel, reload it ' +
             '(Ctrl+Shift+R), and reapply your edits.'
      };
    }
    if (!S.dataSha) {
      console.warn(SKIP + 'no data blob sha was recorded when this panel loaded.' + UNGUARDED);
      return { ok: true, note: 'no loaded data sha, guard skipped' };
    }

    let live;
    try {
      live = (await getFile(DATA_PATH)).sha || '';
    } catch (err) {
      console.warn(SKIP + 'could not read the current ' + DATA_PATH + ' (' + err.message +
        '). A network problem is not evidence of staleness.' + UNGUARDED);
      return { ok: true, note: 'data fetch failed, guard skipped' };
    }
    if (!live) {
      console.warn(SKIP + 'GitHub returned no sha for ' + DATA_PATH + '.' + UNGUARDED);
      return { ok: true, note: 'live data sha empty, guard skipped' };
    }

    if (live === S.dataSha) return { ok: true, note: 'data sha matches (' + live.slice(0, 7) + ')' };
    return {
      ok: false,
      loaded: S.dataSha,
      live: live,
      msg: 'Publish blocked. This panel loaded site data ' + S.dataSha.slice(0, 7) +
           ' but the branch is now on ' + live.slice(0, 7) + '. Someone changed the ' +
           'content after you opened this page. Publishing now would overwrite their ' +
           'changes with your older copy. Reload the panel (Ctrl+Shift+R) and reapply ' +
           'your edits.'
    };
  }

  async function runPublish() {
    if (publishing) return;

    /* Templates first, then data. Both must pass; either refusal names both
       versions so the message says what actually moved. */
    let guard = await templatesAreCurrent();
    if (guard.ok) guard = await dataIsCurrent();
    if (!guard.ok) {
      const note = $('#pub-note');
      note.style.display = 'block';
      note.className = 'err';
      note.textContent = guard.msg;
      $('#pub-go').disabled = true;
      toast('Publish blocked: this panel is out of date. Reload it.', 9000);
      return;
    }

    /* The gate. Seven checks plus the lock list, against the data as it will
       actually be written, so underscore-prefixed view state is stripped
       first exactly as cleanJson strips it on the way out. */
    let gate;
    try {
      gate = await runGate(clone(S.data), JSON.parse(S.baseline));
    } catch (err) {
      gate = { ok: false, checks: [{
        id: 'gate', name: 'The pre-publish checks', examined: 0, unit: 'check',
        findings: [{ where: 'the panel',
                     what: 'the checks could not run (' + err.message + ')',
                     why: 'Publishing without them would push content nothing has looked at.',
                     todo: 'Reload the panel (Ctrl+Shift+R) and try again.' }] }] };
    }
    if (!gate.ok) {
      const gnote = $('#pub-note');
      gnote.style.display = 'block';
      gnote.className = 'err';
      gnote.innerHTML = gateRefusalHtml(gate);
      $('#pub-go').disabled = true;
      const nfail = gate.checks.filter(function (c) { return c.findings.length; }).length;
      toast('Not published. ' + nfail + ' check' + (nfail === 1 ? '' : 's') + ' refused. The live site is unchanged.', 10000);
      return;
    }

    publishing = true;
    $('#pub-go').disabled = true;
    $('#pub-go').textContent = 'Publishing…';
    $('#pub-cancel').disabled = true;

    S.data.meta = S.data.meta || {};
    S.data.meta.lastPublished = new Date().toISOString();

    const files = SOKTemplates.renderAll(S.data);
    files[DATA_PATH] = cleanJson(S.data, 2) + '\n';

    if (publishMode() === 'atomic') {
      const res = await publishAtomic(files);
      const note = $('#pub-note');
      note.style.display = 'block';
      if (res.ok) {
        S.baseline = cleanJson(S.data);
        clearDraft();
        updateStatus();
        note.innerHTML = res.noop
          ? 'Everything was already up to date — nothing to publish.'
          : '<strong>Done!</strong> ' + res.written + ' file(s) committed as one commit ' +
            '<code>' + A(String(res.commit).slice(0, 7)) + '</code>. GitHub Pages is now redeploying ' +
            '(usually under a minute). If the live site still shows old content, your Cloudflare cache ' +
            'may need a few minutes — or purge it in the Cloudflare dashboard (Caching → Purge Everything).';
      } else if (res.fault) {
        note.innerHTML = res.fault.html;
      } else {
        note.innerHTML = '<strong style="color:var(--danger);">Nothing was published.</strong> ' +
          'Failed at: <em>' + A(res.stage) + '</em> — ' + A(res.err && res.err.message ? res.err.message : 'unknown error') + '. ' +
          'The live site is unchanged. Check that your token has <em>Contents: Read &amp; write</em> ' +
          'for this repository, then press Publish again.';
      }
      $('#pub-go').disabled = false;
      $('#pub-go').textContent = 'Publish again';
      $('#pub-cancel').disabled = false;
      publishing = false;
      return;
    }

    let failed = 0, written = 0;
    for (const path of Object.keys(files)) {
      setRow(path, 'checking…', 'run');
      try {
        let sha = null, existing = null;
        try {
          const cur = await getFile(path);
          sha = cur.sha; existing = cur.text;
        } catch (err) { if (err.status !== 404) throw err; }
        if (existing === files[path]) { setRow(path, 'no changes', 'skip'); continue; }
        setRow(path, 'uploading…', 'run');
        await putFile(path, b64encode(files[path]), 'Update ' + path + ' via site admin', sha);
        setRow(path, 'published ✓', 'ok'); written++;
      } catch (err) {
        failed++;
        setRow(path, 'failed — ' + err.message, 'err');
        if (err.status === 401 || err.status === 403) break;   // auth problem: stop
      }
    }

    const note = $('#pub-note');
    note.style.display = 'block';
    if (failed === 0) {
      S.baseline = cleanJson(S.data);
      clearDraft();
      updateStatus();
      note.innerHTML = written === 0
        ? 'Everything was already up to date — nothing to publish.'
        : '<strong>Done!</strong> GitHub Pages is now redeploying (usually under a minute). ' +
          'If the live site still shows old content, your Cloudflare cache may need a few minutes — ' +
          'or purge it in the Cloudflare dashboard (Caching → Purge Everything).';
    } else {
      note.innerHTML = '<strong style="color:var(--danger);">' + failed + ' file(s) failed.</strong> ' +
        'Check that your token has <em>Contents: Read &amp; write</em> for this repository, then press Publish again — successful files are skipped automatically.';
    }
    $('#pub-go').disabled = false;
    $('#pub-go').textContent = 'Publish again';
    $('#pub-cancel').disabled = false;
    publishing = false;
  }

  $('#publish-btn').addEventListener('click', openPublish);
  $('#pub-go').addEventListener('click', runPublish);
  $('#pub-cancel').addEventListener('click', () => { if (!publishing) $('#pub-overlay').classList.remove('open'); });

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      toast('Edits autosave as a draft in this browser — use Publish to go live.');
    }
  });

  window.addEventListener('beforeunload', e => {
    if (!S.demo && S.data && isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ================= connect / boot ================= */

  function enterApp() {
    $('#login').style.display = 'none';
    $('#app').style.display = 'block';
    $('#repo-chip').textContent = S.demo ? 'demo data' : S.cfg.owner + '/' + S.cfg.repo + ' @ ' + S.cfg.branch;
    $('#open-site').href = siteUrl() || '#';
    if (S.demo) {
      $('#draft-banner').innerHTML =
        '<div class="banner purple" style="margin:14px 18px 0;"><div class="grow">' +
        '<strong>Demo mode.</strong> Edit freely and use Preview — changes live only in this tab. ' +
        'Connect with a GitHub token to publish for real.</div>' +
        '<a class="btn btn-outline btn-sm" href="admin.html">Connect</a></div>';
    }
    if (branchWasMigrated) {
      toast('This panel was set to publish to "' + LEGACY_BRANCH + '", which refuses every publish. ' +
            'It now publishes to "' + DEFAULT_BRANCH + '", which is checked and then goes live automatically.', 12000);
      branchWasMigrated = false;
    }

    /* Load the lock and figure lists, then redraw so regulated fields come
       back read-only. Until this resolves nothing is marked locked, which is
       why the publish gate re-reads them and refuses if they are missing. */
    gateSpecs().then(function () { rerender(); }, function (err) {
      console.warn('Gate specs unavailable: ' + err.message +
        '. Regulated fields will not be marked read-only, and publishing will be refused until this is fixed.');
    });

    render('home');
    updateStatus();
  }

  function showDraftBanner(savedAt) {
    $('#draft-banner').innerHTML =
      '<div class="banner" style="margin:14px 18px 0;"><div class="grow">' +
      '<strong>Unpublished draft found</strong> from ' + A(new Date(savedAt).toLocaleString()) +
      ' — saved automatically in this browser.</div>' +
      '<button class="btn btn-primary btn-sm" data-action="resume-draft" type="button">Resume draft</button>' +
      '<button class="btn btn-outline btn-sm" data-action="discard-draft" type="button">Discard</button></div>';
  }
  function applyDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_DRAFT));
      S.data = d.data;
      /* A draft written before this field existed, or by an older panel, has no
         provenance. null makes dataIsCurrent() refuse instead of comparing
         against whatever happens to be loaded now. */
      S.dataSha = Object.prototype.hasOwnProperty.call(d, 'dataSha') ? d.dataSha : null;
      $('#draft-banner').innerHTML = '';
      markDirty(); render(S.section);
      toast('Draft restored — publish when ready');
    } catch (e) { toast('Could not restore the draft'); }
  }

  async function reloadFromGitHub() {
    try {
      const df = await getFile(DATA_PATH);
      S.data = JSON.parse(df.text);
      S.dataSha = df.sha || null;
      S.baseline = cleanJson(S.data);
      clearDraft();
      $('#draft-banner').innerHTML = '';
      render(S.section); updateStatus();
      toast('Reloaded from GitHub');
    } catch (e) { toast('Reload failed: ' + e.message, 5000); }
  }

  async function connect(cfg, silent) {
    S.cfg = cfg; S.demo = false;
    const errBox = $('#login-err');
    try {
      const me = await gh('/user');
      S.user = me.login;
      await gh('/repos/' + cfg.owner + '/' + cfg.repo);
      const df = await getFile(DATA_PATH);
      S.data = JSON.parse(df.text);
      S.dataSha = df.sha || null;
      S.baseline = cleanJson(S.data);
      localStorage.setItem(LS_CFG, JSON.stringify(cfg));
      enterApp();
      /* offer stored draft if newer/different */
      try {
        const d = JSON.parse(localStorage.getItem(LS_DRAFT));
        if (d && d.key === draftKey() && cleanJson(d.data) !== S.baseline) showDraftBanner(d.savedAt);
      } catch (e) { /* no draft */ }
    } catch (err) {
      let msg = err.message;
      if (err.status === 401) msg = 'GitHub rejected the token. Check it was copied fully and has not expired.';
      else if (err.status === 404 && msg.toLowerCase().includes('not found'))
        msg = 'Could not find “' + cfg.owner + '/' + cfg.repo + '” or “' + DATA_PATH + '” on branch “' + cfg.branch +
          '”. Make sure the website package (including the data folder) is uploaded to the repository, and the token can access it.';
      if (silent) {
        $('#login').style.display = 'flex'; $('#app').style.display = 'none';
      }
      errBox.textContent = msg;
      errBox.style.display = 'block';
      throw err;
    }
  }

  $('#connect-btn').addEventListener('click', async () => {
    const cfg = {
      owner: $('#in-owner').value.trim(),
      repo: $('#in-repo').value.trim(),
      branch: $('#in-branch').value.trim() || DEFAULT_BRANCH,
      token: $('#in-token').value.trim()
    };
    const errBox = $('#login-err');
    errBox.style.display = 'none';
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      errBox.textContent = 'Please fill in the owner, repository and token.';
      errBox.style.display = 'block';
      return;
    }
    const btn = $('#connect-btn');
    btn.disabled = true; btn.textContent = 'Connecting…';
    try { await connect(cfg, false); } catch (e) { /* shown in errBox */ }
    btn.disabled = false; btn.textContent = 'Connect →';
  });

  $('#try-demo').addEventListener('click', e => {
    e.preventDefault();
    location.hash = '#demo';
    location.reload();
  });

  async function initDemo() {
    S.demo = true;
    try {
      const res = await fetch('data/site-data.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      S.data = await res.json();
      S.baseline = cleanJson(S.data);
      enterApp();
    } catch (err) {
      $('#login-err').textContent =
        'Demo mode needs to load data/site-data.json from the same folder — open this page from your hosted site (yoursite.com/admin.html#demo) or via a local web server.';
      $('#login-err').style.display = 'block';
      location.hash = '';
    }
  }

  let branchWasMigrated = false;

  function boot() {
    /* prefill from stored config or a github.io guess */
    let cfg = null;
    try { cfg = JSON.parse(localStorage.getItem(LS_CFG)); } catch (e) { /* ignore */ }

    /* A config saved before the content branch existed still names main, and
       every publish from it is refused by the ruleset with a message about a
       status check. Migrate it rather than leaving it pointing at a branch
       that cannot accept a publish, and say so, because a setting that
       changes itself silently is its own surprise. */
    if (cfg && cfg.branch === LEGACY_BRANCH) {
      cfg.branch = DEFAULT_BRANCH;
      try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
      branchWasMigrated = true;
    }

    if (cfg) {
      $('#in-owner').value = cfg.owner || '';
      $('#in-repo').value = cfg.repo || '';
      $('#in-branch').value = cfg.branch || DEFAULT_BRANCH;
      $('#in-token').value = cfg.token || '';
    } else if (location.hostname.endsWith('.github.io')) {
      const owner = location.hostname.split('.')[0];
      $('#in-owner').value = owner;
      $('#in-repo').value = location.hostname;
    }

    if (location.hash === '#demo') { initDemo(); return; }
    if (cfg && cfg.token) {
      connect(cfg, true).catch(() => { /* falls back to login with error shown */ });
    }
  }

  boot();
})();
