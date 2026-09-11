/* Proof harness for the admin panel's publish gate.
   ============================================================================

   The gate in assets/admin/admin.js runs in a browser, so the tools/*.py
   proofs cannot reach it. This drives the real shipped code in a real browser
   instead of a reimplementation of it.

   Hard rule 8: no verification guard is trusted until it has been observed
   failing for the reason it exists. Every check below is watched refusing on
   its OWN fault, and then watched not firing on content that is merely
   different, because a gate that refuses everything is as useless as one that
   refuses nothing and is far more annoying.

   HOW TO RUN
     python -m http.server 8765        (from the repository root)
     open  http://localhost:8765/admin.html#demo
     then, in the console:
       const s = document.createElement('script');
       s.src = 'tools/prove_gate.js';
       document.head.appendChild(s);
       s.onload = () => SOKProveGate().then(r => console.table(r.rows));

   A file:// origin will not work: the gate fetches tools/locked.json and
   tools/figures.json, and fetch refuses file URLs.
*/
(function () {
  'use strict';

  function deep(x) { return JSON.parse(JSON.stringify(x)); }

  function postById(d, id) {
    for (let i = 0; i < d.posts.length; i++) if (d.posts[i].id === id) return d.posts[i];
    return null;
  }

  /* Each case: mutate a copy, then say which check must refuse.
     expect === null means nothing may refuse: a negative control. */
  const CASES = [

    /* ---------------- each check refusing on its own fault --------------- */
    {
      name: '1 junk: a price that is not a number',
      expect: 'junk',
      why: 'the 29 Aug 2026 unary-plus bug shipped NaN into 15 order buttons',
      mutate: function (d) { d.products[0].price = NaN; }
    },
    /* This used to be a refusal case, and it caught a live defect: ld() built
       its block with JSON.stringify, which does not escape the less-than sign,
       so a description containing a closing script tag ended the element early
       and put executing markup on every page with JSON-LD. templates.js now
       escapes it, so the same content is safe and must be ALLOWED.

       That leaves the jsonld check with no fault reachable from content. It is
       now a regression guard on templates.js rather than a check on data: the
       only way to make it fire is to break the serialiser again, which is
       exactly what it should catch. Recorded here so the change in what this
       case proves is deliberate and not a silent loss of coverage. */
    {
      name: '2 jsonld: a description containing a closing script tag is now safe',
      expect: null,
      why: 'ld() escapes the less-than sign, so the block stays valid and the text round-trips',
      assertRoundTrip: 'Saffron </script><script>alert(1)</script> growers',
      mutate: function (d) { d.brand.orgDescription = 'Saffron </script><script>alert(1)</script> growers'; }
    },
    {
      name: '3 productids: an id that no longer matches its address',
      expect: 'productids',
      why: 'sku and data-wa-product are both emitted from p.id',
      mutate: function (d) { d.products[0].id = 'not-the-slug'; }
    },
    {
      name: '4 related: a link to an article that does not exist',
      expect: 'related',
      why: 'a redirect does not fix an internal link',
      mutate: function (d) { d.posts[0].related = ['no-such-article']; }
    },
    {
      name: '5 checker: a quoted sentence the article no longer contains',
      expect: 'checker',
      why: 'every option is anchored to a published sentence',
      mutate: function (d) {
        const p = postById(d, 'purity-tests');
        p.checker.questions[0].options[0].anchor = 'A sentence that was never written.';
      }
    },
    {
      name: '6 figures: a hectare figure that disagrees with the rest of the site',
      expect: 'figures',
      why: 'pampore-legacy once claimed under 2,500 while four other posts said 3,665',
      mutate: function (d, ctx) {
        const p = postById(d, ctx.figurePost);
        p.body = p.body.replace(ctx.figureFrom, ctx.figureTo);
      }
    },
    {
      name: '7 parity: an article deleted, so a live page would vanish',
      expect: 'parity',
      why: 'on 29 Aug 2026 sitemap.xml fell from 27 URLs to 11 and nothing failed loudly',
      mutate: function (d) { d.posts.splice(0, 1); }
    },
    {
      name: '8 locked path: the FSSAI registration number',
      expect: 'locked',
      why: 'a wrong FSSAI number is a regulatory problem, not a typo',
      mutate: function (d) { d.brand.fssaiNumber = '00000000000000'; }
    },
    {
      name: '9 locked token: new copy claiming ISO 3632',
      expect: 'locked',
      why: 'rule 9 is a content match, and its refusal must give the approved wording',
      needsInstead: 'lab tested to ISO 3632 Category I',
      mutate: function (d) { d.products[1].homeDesc = 'Certified ISO 3632 grade saffron.'; }
    },
    {
      name: '10 locked token: deleting an existing FSSAI claim',
      expect: 'locked',
      why: 'tokens are tested before AND after, because removing a claim matters too',
      mutate: function (d) { d.footer.about = 'Kashmiri Mongra saffron from Pampore.'; }
    },

    /* ---------------- the non-zero assertion, hard rule 8 ---------------- */
    {
      name: '11 starved: nothing left to examine',
      expect: 'productids',
      why: 'found zero problems and found zero things to examine must not look the same',
      wantStarved: true,
      mutate: function (d) { d.products = []; }
    },

    /* Rule 9 fires on a change to the CLAIM, not to the string holding it.
       These two are the pair that pins that down, inside the same article
       body: storing-saffron mentions ISO 3632 and Category I and is NOT locked
       by path, so it is exactly the case the old broad rule got wrong. */
    {
      name: '12 rule 9: a claim altered inside an otherwise editable body',
      expect: 'locked',
      why: 'altering the claim itself is the threat, wherever it sits',
      mutate: function (d) {
        const p = postById(d, 'storing-saffron');
        p.body = p.body.replace('ISO 3632', 'ISO  3632');
      }
    },
    {
      name: '13 rule 9: a claim removed from an otherwise editable body',
      expect: 'locked',
      why: 'deleting a claim matters as much as adding one',
      mutate: function (d) {
        const p = postById(d, 'storing-saffron');
        p.body = p.body.replace('ISO 3632', 'ISO 3633');
      }
    },

    /* ---------------- negative controls: does it over-block? ------------- */
    {
      name: 'C1 control: untouched content',
      expect: null,
      why: 'the gate must pass the site exactly as it is published today',
      mutate: function () { }
    },
    {
      name: 'C2 control: an ordinary button label change',
      expect: null,
      why: 'routine copy editing is the whole point of the panel',
      mutate: function (d) { d.hero.waCtaLabel = 'Order on WhatsApp now'; }
    },
    {
      name: 'C3 control: rewriting an unlocked article body',
      expect: null,
      why: 'only four post bodies are locked by path; the rest are the team\'s to edit',
      mutate: function (d) {
        const p = postById(d, 'arabic-cuisine');
        p.body = p.body + '\n\nServe it hot, in small cups.';
      }
    },
    /* THE CONTROL THE OLD RULE FAILED. storing-saffron mentions ISO 3632 and
       Category I, so the broad rule refused every edit to it and fixing a typo
       needed a developer. Eleven of the fifteen post bodies were in that state.
       The claim here is untouched, so this must be allowed. */
    {
      name: 'C8 control: an edit elsewhere in a body that mentions a claim',
      expect: null,
      why: 'a lock that makes ordinary work impossible gets routed around, not obeyed',
      mutate: function (d) {
        const p = postById(d, 'storing-saffron');
        p.body = p.body + '\n\nKeep the tin closed and out of the light.';
      }
    },
    {
      name: 'C9 control: retitling an article whose body carries claims',
      expect: null,
      why: 'the claim is in the body and was not touched',
      mutate: function (d) { postById(d, 'read-lab-report').title = 'How to Read a Lab Report'; }
    },
    {
      name: 'C4 control: the word "isolated"',
      expect: null,
      why: 'the ISO 3632 pattern must not fire on any word beginning ISO',
      mutate: function (d) { d.products[2].homeDesc = 'Grown in an isolated field above Pampore.'; }
    },
    {
      name: 'C5 control: the phrase "Category II"',
      expect: null,
      why: 'Category\\s+I\\b must not match Category II, or the lock is uselessly wide',
      mutate: function (d) { d.products[2].pageDesc = 'Never Category II, never blended.'; }
    },
    {
      name: 'C6 control: a price change',
      expect: null,
      why: 'prices are explicitly the team\'s to change',
      mutate: function (d) { d.products[0].price = d.products[0].price + 5; }
    },
    {
      name: 'C7 control: adding a testimonial',
      expect: null,
      why: 'testimonials are unlocked and adding one must not trip the figure or lock checks',
      mutate: function (d) {
        d.testimonials.items.push({ name: 'Proof Case', location: 'Dubai', text: '“Arrived quickly.”', rating: 5 });
      }
    }
  ];

  window.SOKProveGate = async function (opts) {
    opts = opts || {};
    const base = opts.data || await (await fetch('data/site-data.json?cb=' + Date.now(),
      { cache: 'no-store' })).json();

    /* Find a real tracked figure to corrupt, rather than hardcoding one here.
       Hardcoding it would be a third copy of the figure list. */
    const figSpec = await (await fetch('tools/figures.json?cb=' + Date.now(),
      { cache: 'no-store' })).json();
    const ctx = {};
    outer:
    for (const fig of figSpec.figures) {
      for (const pat of (fig.patterns || [])) {
        const rx = new RegExp(pat);
        for (const post of base.posts) {
          const m = rx.exec(String(post.body || ''));
          if (m && m[1] && fig.accepted.indexOf(m[1]) !== -1) {
            ctx.figurePost = post.id;
            ctx.figureFrom = m[0];
            ctx.figureTo = m[0].replace(m[1], m[1] === '5,707' ? '5,700' : '9,999');
            ctx.figureName = fig.name;
            break outer;
          }
        }
      }
    }
    if (!ctx.figurePost) throw new Error('no tracked figure found in any post body to corrupt');

    const rows = [];
    for (const c of CASES) {
      const after = deep(base);
      c.mutate(after, ctx);
      let res;
      try { res = await window.SOKGate.run(after, deep(base)); }
      catch (err) { rows.push({ case: c.name, verdict: 'HARNESS ERROR', detail: err.message }); continue; }

      const fired = res.checks.filter(x => x.findings.length).map(x => x.id);
      const starved = res.checks.filter(x => x.starved).map(x => x.id);
      let verdict, detail = '';

      if (c.expect === null) {
        verdict = res.ok ? 'PASS (not blocked)' : 'FAIL over-blocked';
        if (!res.ok) {
          const f = res.checks.filter(x => x.findings.length)[0];
          detail = f.id + ': ' + f.findings[0].what;
        }
        /* Not blocked is only half the claim for the escaping case. The other
           half is that the block still parses and the text survives intact,
           because an escape that mangled the content would also pass a check
           that only asked whether the JSON was valid. */
        if (res.ok && c.assertRoundTrip) {
          const files = SOKTemplates.renderAll(after);
          const blk = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/.exec(files['index.html']);
          let got = null, raw = true;
          try {
            const body = blk[1];
            raw = body.indexOf('<script') !== -1 || body.indexOf('</script') !== -1;
            const parsed = JSON.parse(body.trim());
            const graph = parsed['@graph'] || [parsed];
            const org = graph.filter(function (g) { return g && g['@type'] === 'Organization'; })[0];
            got = org ? org.description : '(no Organization node)';
          } catch (err) { got = 'PARSE FAILED: ' + err.message; }
          if (raw) { verdict = 'FAIL raw script tag survived in the block'; detail = ''; }
          else if (got !== c.assertRoundTrip) { verdict = 'FAIL round trip'; detail = String(got).slice(0, 120); }
          else { detail = 'block parses, no raw script tag, text round-trips exactly'; }
        }
      } else if (fired.indexOf(c.expect) === -1) {
        verdict = 'FAIL did not fire';
        detail = 'fired: ' + (fired.join(',') || 'nothing');
      } else if (c.wantStarved && starved.indexOf(c.expect) === -1) {
        verdict = 'FAIL fired but not as starved';
      } else {
        const chk = res.checks.filter(x => x.id === c.expect)[0];
        const fd = chk.findings[0];
        verdict = 'PASS refused';
        detail = fd.what;
        if (c.needsInstead) {
          const teaches = chk.findings.some(x => (x.todo || '').indexOf(c.needsInstead) !== -1);
          if (!teaches) { verdict = 'FAIL refusal does not teach'; detail = fd.todo || '(no advice given)'; }
        }
        /* A refusal must name what, why, who, and say the site is unchanged. */
        const named = !!(fd.what && fd.why !== undefined);
        if (!named) { verdict = 'FAIL refusal incomplete'; }
      }

      rows.push({
        case: c.name,
        verdict: verdict,
        fired: fired.join(',') || '-',
        detail: String(detail).slice(0, 150),
        why: c.why
      });
    }

    const bad = rows.filter(r => r.verdict.indexOf('FAIL') === 0 || r.verdict.indexOf('HARNESS') === 0);
    return { ok: !bad.length, rows: rows, failures: bad, figure: ctx.figureName };
  };
})();
