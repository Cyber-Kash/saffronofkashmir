# Infrastructure

Configuration that exists only in the Cloudflare and GitHub Pages dashboards and
nowhere in this repository.

**Verification status.** Every line is marked.

`[verified]` was read from an authenticated GitHub API, from public DNS, or
observed directly over HTTP. Most of this file was re-checked on 10 Sep 2026 in
preparation for moving the repository into an organisation, so that anything the
move broke would be visible against a recorded baseline.

On 10 Sep 2026 a read-only Cloudflare API token was issued (Zone Read, Zone
Settings Read, DNS Read, and the rules-related read permissions) and **every
remaining `[unconfirmed]` item was read directly from the Cloudflare API**.
Nothing in this file is now supplied rather than read.

Zone `saffronofkashmir.com`, id `3588da5304b3a7960765473e4dfc09fe`, status
active, **plan Free Website**, nameservers `donald` and `rosemary`.

That capture corrected three things this file previously asserted. Each
correction is marked where it appears.

---

## 1. SSL/TLS

**Mode: Full (Strict).** `[verified 10 Sep 2026]` Read from
`GET /zones/{id}/settings/ssl`:

```
ssl                       strict     modified 2026-09-01
always_use_https          on         modified 2026-04-24
automatic_https_rewrites  on
opportunistic_encryption  on
tls_1_3                   zrt
min_tls_version           1.0
```

`strict` is Full (Strict). The `modified 2026-09-01` timestamp matches the
switch away from Flexible recorded below.

**`min_tls_version` is 1.0**, which permits TLS 1.0 and 1.1. Nothing here
depends on raising it and no change is proposed, but it is recorded because it
is the one setting in this block that is more permissive than it needs to be.

Behaviour consistent with the mode, also `[verified 10 Sep 2026]`:

```
http://saffronofkashmir.com/       301 -> https://saffronofkashmir.com/
http://www.saffronofkashmir.com/   301 -> https://saffronofkashmir.com/
https://saffronofkashmir.com/      200
```

Every hop and every final response is `https`. No request downgrades, and `www`
never reaches the origin, which is what keeps the apex-only certificate from
producing a 526.

It was **Flexible** until 31 Aug 2026. That caused three faults at once:

- All 19 directory-style URLs answered `301` with a plaintext `http://`
  `Location`, so every no-slash inbound link took two hops through cleartext.
- Cloudflare-to-origin traffic was unencrypted.
- GitHub Pages could not provision a certificate at all.

### Switching sequence

Cannot be done in one step. In this order:

1. Un-proxy the DNS records (grey cloud).
2. Remove the custom domain in GitHub Pages, then re-add it.
3. Wait for the certificate to be issued.
4. Tick **Enforce HTTPS** in GitHub Pages.
5. Set SSL/TLS mode to **Full (Strict)** in Cloudflare.
6. Re-proxy the DNS records (orange cloud).

Setting Full (Strict) before a valid origin certificate exists returns **525 on
every request**.

### Rejected: dropping to Flexible to cover an outage

When the GitHub Pages certificate has to be re-provisioned, for example during a
repository transfer, the site is down until it arrives. **Do not set SSL/TLS to
Flexible to keep the site up during that window.** It was proposed once, on
10 Sep 2026, and rejected.

Flexible means Cloudflare terminates TLS at the edge and talks to the origin
over plaintext `http`. That is exactly the configuration that caused the
**31 Aug 2026** fault recorded at the top of this section:

- all 19 directory-style URLs answered `301` with a plaintext `http://`
  `Location`, so every no-slash inbound link took two hops through cleartext
- Cloudflare-to-origin traffic was unencrypted
- GitHub Pages could not provision a certificate at all, which is the very
  thing the workaround is meant to be waiting for

The secondary argument for it, that edge cache would carry the site through, is
also weak: this is a low-traffic site, so cache coverage across paths is thin
and most requests would miss and reach a broken origin.

**Take the outage instead.** Transfer at a low-traffic hour, leave SSL/TLS at
Full (Strict) throughout, and accept that the site is down until the certificate
is issued. Expect 10 to 30 minutes; assume an hour, because that is what it took
on 31 Aug 2026.

### GitHub Pages `[verified 10 Sep 2026]`

Read from the authenticated GitHub Pages API, so this is the setting itself and
not an inference from behaviour:

```
status                  built
cname                   saffronofkashmir.com
https_enforced          true
custom_404              true
build_type              legacy
public                  true
source                  branch main, path /
protected_domain_state  null

certificate.state       approved
certificate.domains     ["saffronofkashmir.com"]   <- apex only, www NOT covered
certificate.expires_at  2026-11-30
certificate.description The certificate has been approved.
```

The certificate expiring on **2026-11-30** is the one dated item here. Pages
renews automatically, but if HTTPS breaks near that date, check it first.

---

## 2. DNS

Read from `GET /zones/{id}/dns_records` on 10 Sep 2026. Sixteen records. This
is the zone file itself, not an inference from what resolvers return, so proxy
status and the underlying record types are visible.

TTL `1` means Auto.

```
TYPE   NAME                             PROXIED  TTL   CONTENT
A      saffronofkashmir.com             yes      1     185.199.111.153
A      saffronofkashmir.com             yes      1     185.199.110.153
A      saffronofkashmir.com             yes      1     185.199.109.153
A      saffronofkashmir.com             yes      1     185.199.108.153
CNAME  www.saffronofkashmir.com         yes      1     saffronofkashmir.com

MX     saffronofkashmir.com             no       1     10 mx.zoho.com
MX     saffronofkashmir.com             no       1     20 mx2.zoho.com
MX     saffronofkashmir.com             no       1     50 mx3.zoho.com

TXT    saffronofkashmir.com             no       3600  v=spf1 include:zohomail.com a mx include:_spf.mlsend.com ~all
TXT    saffronofkashmir.com             no       3600  google-site-verification=ELCeRYXypP2AtFZgYaTpY8ZA1i41R5h3-Kn47b1NfDc
TXT    saffronofkashmir.com             no       3600  mailerlite-domain-verification=78bf4e328f0450c638f23076f003758785b41281
TXT    saffronofkashmir.com             no       1     pinterest-site-verification=f564b77ec5247c8587c303d86481fe48
TXT    saffronofkashmir.com             no       1     zoho-verification=zb20301374.zmverify.zoho.com

TXT    zmail._domainkey                 no       1     v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GN...
CNAME  litesrv._domainkey               no       3600  litesrv._domainkey.mlsend.com
TXT    _dmarc                           no       1     v=DMARC1; p=none; rua=mailto:...@dmarc-reports.cloudflare.net
```

**The four apex `A` records point at GitHub Pages** (`185.199.108-111.153`) and
are proxied, which is why a public resolver returns Cloudflare addresses instead.
Both earlier readings were right about different things: the zone holds the
Pages IPs, the world sees Cloudflare's.

**`www` is a `CNAME` to the apex, proxied.** Previously recorded as
`[unconfirmed: record type]`, then recorded as impossible to determine from
outside. Both were true at the time; the API settles it.

### Correction: the MailerLite DKIM does exist

On 10 Sep 2026 this file was edited to say no MailerLite DKIM record could be
found, after probing ten `TXT` selectors. **That was wrong**, and the mistake was
in the probe, not the zone.

MailerLite publishes DKIM as a **`CNAME`**, at selector `litesrv._domainkey`,
pointing to `litesrv._domainkey.mlsend.com`. A `TXT` query at that name returns
nothing, and none of the ten selectors tried was `litesrv`. Mail from MailerLite
is signed. The earlier entry is withdrawn.

The lesson worth keeping: a negative result from an enumerated probe is evidence
about the probe as much as about the target. It should have been marked as "not
found at the selectors tried" rather than "does not exist", and it is the kind
of claim that should wait for the authoritative source.

### Mail posture

SPF, DKIM for both senders, and DMARC are all present. **DMARC is `p=none`**,
which monitors and enforces nothing; reports go to Cloudflare's DMARC
Management. Raising it to `quarantine` is a decision for whoever owns
deliverability, not a defect.

Cloudflare cannot proxy `MX`, and proxying mail-related records breaks delivery
and domain authentication. Every mail record above is correctly DNS-only.

---

## 3. Redirect rules

Order matters, and the order below is the order the API returns, which is the
order Cloudflare evaluates them in.

### The rules, verbatim `[verified 10 Sep 2026]`

Ruleset `003a507ba942450b81c509d3ec573cc0`, phase `http_request_dynamic_redirect`,
last updated 2026-09-02. **Seven rules. All seven are enabled.**

```
1. www-to-apex
   when  http.host eq "www.saffronofkashmir.com"
   then  301  concat("https://saffronofkashmir.com", http.request.uri)
   preserve_query_string  false

2. blog-mongra-grade-retired
   when  http.request.uri.path in {"/blog/mongra-grade/" "/blog/mongra-grade"}
   then  301  https://saffronofkashmir.com/blog/grade-names/
   preserve_query_string  true

3. blog-five-fakes-retired
   when  http.request.uri.path in {"/blog/five-fakes/" "/blog/five-fakes"}
   then  301  https://saffronofkashmir.com/blog/purity-tests/
   preserve_query_string  true

4. html-to-extensionless-noquery
   when  http.request.uri.path in {"/products.html" "/recipes.html" "/blogs.html"
                                   "/terms.html" "/shipping-policy.html"
                                   "/returns-policy.html" "/privacy-policy.html"}
         and http.request.uri.query eq ""
   then  301  concat("https://saffronofkashmir.com",
                     substring(http.request.uri.path, 0, -5))
   preserve_query_string  false

5. html-to-extensionless
   when  (same seven paths) and http.request.uri.query ne ""
   then  301  concat("https://saffronofkashmir.com",
                     substring(http.request.uri.path, 0, -5),
                     "?", http.request.uri.query)
   preserve_query_string  false

6. trailing-slash-to-canonical
   when  http.request.uri.path in {"/products/" "/recipes/" "/blogs/" "/terms/"
                                   "/shipping-policy/" "/returns-policy/"
                                   "/privacy-policy/"}
   then  301  concat("https://saffronofkashmir.com",
                     substring(http.request.uri.path, 0, -1))
   preserve_query_string  true

7. index-html-to-root
   when  http.request.uri.path in {"/index.html" "/index"}
   then  301  https://saffronofkashmir.com/
   preserve_query_string  true
```

Three things this confirms that were previously inferred from behaviour:

**Both `.html` rules enumerate seven paths.** Neither is a wildcard. `index.html`
is handled separately by rule 7, which brings the total to eight. That is why
`zzz-not-real.html` returns 404 rather than redirecting, and it is the reason a
new file-backed page must either be added to these lists or built
directory-backed instead. See the consequence note further down.

**`trailing-slash-to-canonical` enumerates the same seven paths.** It is not
general either, which is why `/blog/<slug>/` keeps its trailing slash rather
than having it stripped.

**The retirement rules sit at positions 2 and 3, above
`trailing-slash-to-canonical` at 6.** That ordering requirement is explained
below and is satisfied.


Rule names and the order itself are `[unconfirmed]`. The status codes, targets,
query-string behaviour and the two corrected expressions below are `[verified]`
by observation on 2 Sep 2026.

| # | rule | observed behaviour |
|---|---|---|
| 1 | retirement: `/blog/mongra-grade` | `301` to `/blog/grade-names/`, query preserved |
| 2 | retirement: `/blog/five-fakes` | `301` to `/blog/purity-tests/`, query preserved |
| 3 | `www-to-apex` | `301` to apex, path and query preserved |
| 4 | `trailing-slash-to-canonical` | `301` strips the trailing slash, query preserved |
| 5 | `index-html-to-root` | `301` `/index.html` to `/`, query preserved |
| 6 | `html-to-extensionless`, query present | `301` strips `.html`, query preserved |
| 7 | `html-to-extensionless`, no query | `301` strips `.html` |

All seven preserve the query string. `[verified 2 Sep 2026]`

Retirement rule expressions, as applied:

```
(http.request.uri.path eq "/blog/mongra-grade/" or
 http.request.uri.path eq "/blog/mongra-grade")
   -> 301 https://saffronofkashmir.com/blog/grade-names/

(http.request.uri.path eq "/blog/five-fakes/" or
 http.request.uri.path eq "/blog/five-fakes")
   -> 301 https://saffronofkashmir.com/blog/purity-tests/
```

### Why the order matters

**Retirement rules must sit above `trailing-slash-to-canonical`.** A no-slash
request to a retired path would otherwise be normalised to the slash form, which
no longer exists, and answer `404` instead of redirecting. Both path shapes are
matched in each retirement expression so the rule fires whichever arrives.

### Why `www-to-apex` exists

`www.saffronofkashmir.com` is a `CNAME` to the apex, and the GitHub certificate
covers the apex only. Under Full (Strict) a request to `www` that reached the
origin would return **526**. The redirect runs at the edge before any origin
fetch, so the certificate never comes into play.

### Query string handling

All seven rules preserve the query string. `[verified 2 Sep 2026]`

**Preserve query string has no effect when the target is a fully-specified
dynamic expression.** The checkbox was ticked on both failing rules and changed
nothing. The query has to be in the expression itself.

`www-to-apex` targets:

```
concat("https://saffronofkashmir.com", http.request.uri)
```

`http.request.uri` is path and query together, and it omits the `?` when there
is no query, so a query-less request does not pick up a bare separator. This is
what `trailing-slash-to-canonical` was already doing, which is why that rule
never had the fault.

`html-to-extensionless` is **two rules**, split on whether a query exists:

```
query present   when  http.request.uri.query ne ""
  concat("https://saffronofkashmir.com", substring(http.request.uri.path, 0, -5),
         "?", http.request.uri.query)

no query        when  http.request.uri.query eq ""
  concat("https://saffronofkashmir.com", substring(http.request.uri.path, 0, -5))
```

Split rather than one rule using `regex_replace`, because **`regex_replace`
requires a Business plan and is not available on this zone**. The split also
avoids appending a bare `?` to a query-less request, which a single
unconditional `concat` would do.

`-5` strips `.html`.

**The condition is an enumerated list of paths, not a wildcard over top-level
`.html`.** `[verified 5 Sep 2026]` Observed behaviour:

```
index.html            301 -> /                     zzz-not-real.html    404, no redirect
products.html         301 -> /products             purity-checker.html  404, no redirect
recipes.html          301 -> /recipes
blogs.html            301 -> /blogs
privacy-policy.html   301 -> /privacy-policy
terms.html            301 -> /terms
shipping-policy.html  301 -> /shipping-policy
returns-policy.html   301 -> /returns-policy
```

The eight existing pages redirect. An arbitrary top-level `.html` path does not,
so it is not a general rule. A `.html` path under a subdirectory does not match
either and still returns 404.

**Consequence, and it is the reason this is written down.** GitHub Pages serves
an extensionless request from the matching `.html` file, so a new file-backed
page is reachable at BOTH addresses the moment it ships. Until both
`html-to-extensionless` rules are edited to include it, the new page serves
`200` at its `.html` address as well as its clean one. That is a duplicate
address, which is the defect the rule exists to remove.

Two ways to avoid it:

- Add the new path to both rules, the query variant and the no-query variant,
  before or with the deploy. Two dashboard edits, easy to forget.
- **Build the page directory-backed instead**, as `<name>/index.html` served at
  `/<name>/`. GitHub Pages serves the slash form and `301`s the no-slash form to
  it with no Cloudflare rule at all, which is how every `/blog/<slug>/` and
  `/products/<slug>/` page already works. Prefer this.

### Regression tests

Run all eight after any change to these rules. The first four must show the
query, the next two must show no trailing `?`, the last two must stay 404.

```
curl -sSI "https://www.saffronofkashmir.com/?a=1"               | grep -i location
curl -sSI "https://www.saffronofkashmir.com/products/?a=1"      | grep -i location
curl -sSI "https://saffronofkashmir.com/products.html?a=1"      | grep -i location
curl -sSI "https://saffronofkashmir.com/terms.html?a=1&b=2%20x" | grep -i location
curl -sSI "https://www.saffronofkashmir.com/"                   | grep -i location
curl -sSI "https://saffronofkashmir.com/products.html"          | grep -i location
curl -sS -o /dev/null -w "%{http_code}\n" "https://saffronofkashmir.com/blog/gi-635.html"
curl -sS -o /dev/null -w "%{http_code}\n" "https://saffronofkashmir.com/products/royal-mongra-2g.html"
```

### Full behavioural capture `[verified 10 Sep 2026]`

Every observable redirect, recorded before the organisation transfer so the
same table can be re-run afterwards and compared.

```
http://saffronofkashmir.com/                    301  https://saffronofkashmir.com/
http://www.saffronofkashmir.com/                301  https://saffronofkashmir.com/
https://www.saffronofkashmir.com/               301  https://saffronofkashmir.com/
https://www.saffronofkashmir.com/products/?a=1  301  https://saffronofkashmir.com/products/?a=1
https://saffronofkashmir.com/                   200
https://saffronofkashmir.com/404.html           200

index.html            301  /
products.html         301  /products
recipes.html          301  /recipes
blogs.html            301  /blogs
terms.html            301  /terms
privacy-policy.html   301  /privacy-policy
shipping-policy.html  301  /shipping-policy
returns-policy.html   301  /returns-policy
terms.html?a=1&b=2%20x  301  /terms?a=1&b=2%20x
zzz-not-real.html     404       <- proves the rule is a list, not a wildcard

/products/            301  /products          <- file-backed, slash removed
/products             200
/blog/grade-names     301  /blog/grade-names/ <- directory-backed, slash added
/blog/grade-names/    200

/blog/mongra-grade      301  /blog/grade-names/
/blog/five-fakes        301  /blog/purity-tests/
/blog/mongra-grade/?x=1 301  /blog/grade-names/?x=1
```

The two slash behaviours are opposite and both correct. A file-backed page has
its trailing slash removed by `trailing-slash-to-canonical`. A directory-backed
page has one added by GitHub Pages itself, before any Cloudflare rule is
involved. See the enumeration note above for why that distinction decides how a
new page must be built.

---

## 4. Rules that no longer exist `[verified 10 Sep 2026]`

**Correction.** This file previously said five wildcard rules, for `index`,
`products`, `recipes`, `blogs` and `privacy`, were **Disabled, not deleted**,
and instructed that they be left disabled.

**They do not exist.** The dynamic-redirect ruleset holds seven rules and all
seven are enabled. There are no disabled rules in it, and
`GET /zones/{id}/pagerules` returns zero, so they are not sitting as legacy Page
Rules either. They were deleted at some point, not disabled.

Nothing depends on them. The reasons they were replaced still stand and are kept
here because they explain why the current rules are shaped as they are:

- They matched on the full URI including hostname, rather than on path alone.
- The `index` rule matched `http://` only, so it never fired on real traffic
  once HTTPS was enforced.
- Between them they left four `.html` paths uncovered.

The instruction "leave them disabled" is withdrawn, because there is nothing to
leave.

---

## 5. Caching `[verified 10 Sep 2026]`

Two rules in the `http_request_cache_settings` phase. Neither was recorded here
before. The `http_request_firewall_custom` ruleset exists and is **empty**.

```
1. short cache for site assets   ENABLED
   when  (http.request.uri.path contains "/assets/js/")
      or (http.request.uri.path contains "/assets/css/")
   then  cache: true, edge_ttl 120s, browser_ttl 120s, both override_origin
```

That one works and is why `main.js` and `style.css` carry a two-minute TTL.

### The admin no-cache rule has never matched anything

```
2. admin no-cache   ENABLED
   when  (http.request.uri.path contains " \"/admin\"")
      or (http.request.uri.path contains "\"/admin.html\"")
      or (http.request.uri.path contains "\"/assets/admin/\"")
   then  cache: false
```

**The match strings contain literal double-quote characters**, and the first also
has a leading space. A URL path never contains a `"`, so none of the three
conditions can ever be true. The rule is Enabled, has been for months, and has
never fired. Someone pasted quoted values into a field that already quotes them.

Confirmed against live responses:

```
/assets/admin/templates.js   cf-cache-status: MISS      cache-control: max-age=14400
/assets/admin/admin.js       cf-cache-status: MISS      cache-control: max-age=14400
/admin.html                  cf-cache-status: DYNAMIC   cache-control: max-age=600
/build-id.json               cf-cache-status: DYNAMIC   cache-control: max-age=600
/assets/js/main.js           cf-cache-status: EXPIRED   cache-control: max-age=600
```

`MISS` means Cloudflare considers the file cacheable and simply did not have it.
A working bypass rule would show `BYPASS`. So **both panel scripts are edge
cacheable and carry a four-hour browser `max-age`**, which is the exact
condition behind the 29 Aug 2026 incident where a stale cached `templates.js`
silently reverted 14 files.

**It is not currently causing harm**, because `admin.html` loads both scripts as
`?v=<build id>` and the id changes whenever either file changes, so the URL
changes and neither cache can serve the old copy. The `?v=` is doing the entire
job. This rule is decoration that looks like protection.

`admin.html` and `build-id.json` show `DYNAMIC` because Cloudflare does not cache
HTML or JSON by default, not because the rule worked.

**Fix, when someone is next in the dashboard:** rewrite the expression as
`starts_with(http.request.uri.path, "/admin") or
starts_with(http.request.uri.path, "/assets/admin/")` with no inner quotes.
Recorded rather than done, because the token used for this capture is read-only.

This is the fourth rule found in this project that was Active for months and
matched nothing. The pattern is in `CLAUDE.md` hard rule 8.

---

## 6. Branch protection `[verified 10 Sep 2026]`

Read from the authenticated GitHub API. This is the whole of it; there is no
legacy branch-protection object, which returns `404 Branch not protected`.

```
id            20613646
name          main protection
target        branch
source        zeeshan-shaheen/saffronofkashmir  (Repository)
enforcement   active
created_at    2026-08-10
conditions    ref_name include ["~DEFAULT_BRANCH"], exclude []

rules
  deletion
  non_fast_forward
  required_status_checks
      required_status_checks           [{ context: "verify" }]
      strict_required_status_checks_policy  false
      do_not_enforce_on_create              false

bypass_actors
  { actor_id: 5, actor_type: RepositoryRole, bypass_mode: pull_request }
```

Actor 5 is the `admin` repository role. **`bypass_mode: pull_request` means that
bypass applies only through a pull request, never to a direct push.**

### Why this blocks the admin panel

The panel creates a commit through the Git Data API and moves the ref. That
commit has never run CI, so the required `verify` check has not passed on it and
the push is refused. GitHub's own rule-suite evaluation of the attempt on
10 Sep 2026:

```
3e2b533 -> 9008a5b   refs/heads/main   RESULT=fail
  required_status_checks  FAIL   Required status check "verify" is expected.
  non_fast_forward        pass
  deletion                pass
```

The last successful panel publish was `95887c4` on 29 Aug 2026, before the
bypass was narrowed to `pull_request`.

**This cannot be fixed by making the check pass.** Actions run *after* a ref
moves, so a brand-new commit can never already carry a passing check. An
enforced pre-push status check and a direct push from a browser are mutually
exclusive.

### Why an App cannot be added as a bypass actor here

The intended fix was to let a workflow do the write as `github-actions[bot]`.
That is refused, because the repository is owned by a **user**, not an
organisation:

```
{"actor_id":15368,"actor_type":"Integration","bypass_mode":"always"}
  -> 422  Actor GitHub Actions integration must be part of the ruleset
          source or owner organization

{"actor_id":1,"actor_type":"OrganizationAdmin",...}
  -> 422  ruleset source must be in an organization

{"actor_id":null,"actor_type":"DeployKey",...}
  -> accepted
```

Only `DeployKey` is available on a user-owned repository, and `actor_id: null`
means *any* deploy key bypasses, which is a wider grant than intended. Moving
the repository into an organisation makes the `Integration` actor available and
is the reason the transfer is being done.

**The ruleset was modified and restored on 10 Sep 2026** while establishing the
above. The `DeployKey` probe was a live `PUT` and briefly landed. It was
restored from a backup taken first, and the state above is the restored state,
re-read afterwards. `updated_at` reflects that edit, not a change of policy.

---

## 7. Pricing

**The INR price is not a conversion of the AED price.** India is priced
separately, at roughly half the AED price converted.

`brand.currencies.INR` carries `markup: -50`, and the displayed price is
`aed * rate * (1 + markup / 100)`. AED 65 shows as about INR 846, where a
straight conversion would be about INR 1,691.

**A Merchant Center feed built by converting AED will be wrong for India by a
factor of two.** Country pricing has to come from the INR figure the site
actually shows, not from the base price.

Product JSON-LD carries AED only. That matches what a crawler sees, because the
currency switcher is client-side and Google does not run it. Do not add a second
Offer in INR: nothing on the page binds a currency to a country, so a second
Offer gives Google no basis to choose between them. The supported routes are a
Merchant Center feed with per-country pricing, or country-specific URLs, neither
of which exists yet.

---

## 8. What cannot be done in the repository

**GitHub Pages has no redirect mechanism.** No `_redirects`, no `.htaccess`, no
config file of any kind. Every redirect on this site is a Cloudflare rule
applied by hand in the dashboard.

Retiring a page therefore takes **two actions**, and the order matters:

1. Merge the repo commit that removes the page, and confirm the URL returns
   `404` in production.
2. Only then add the Cloudflare redirect rule.

Adding the rule first means it is live while the page still is, so the redirect
and the page compete and the old URL keeps serving content that is supposed to
be gone.

Deleting the page from `data/site-data.json` is not enough on its own: **the
build writes pages but never removes retired ones.** The generated directory
must be deleted explicitly in the same commit.

---

## What still needs confirming

**Nothing.** Every item that was open is now read from an authenticated source:
the Cloudflare API for the zone, the GitHub API for Pages and the ruleset,
public resolvers and live HTTP for behaviour.

Three things this file previously asserted turned out to be wrong, and each is
corrected in place rather than quietly overwritten:

1. **The MailerLite DKIM record exists.** It is a `CNAME` at
   `litesrv._domainkey`, not a `TXT`. Section 2.
2. **The five disabled wildcard rules do not exist.** They were deleted, not
   disabled, and there is nothing to leave alone. Section 4.
3. **`www` is a `CNAME` to the apex, proxied.** Section 2. Previously
   unconfirmed, then recorded as undeterminable from outside, which was true of
   the method rather than of the record.

One defect was found during the capture and is **not fixed**: the `admin
no-cache` rule matches nothing, section 5. The token used was read-only.

### Keeping it that way

The read-only token used for this capture covers everything above. Every
endpoint answered `200`; none returned `403`. If it is reissued, these are the
calls that need to keep working:

```
GET /zones?name=saffronofkashmir.com
GET /zones/{id}/settings/ssl                     and the other settings
GET /zones/{id}/dns_records
GET /zones/{id}/rulesets
GET /zones/{id}/rulesets/phases/{phase}/entrypoint
GET /zones/{id}/pagerules
```

Correct anything wrong here in place. A reference that is trusted and wrong is
worse than no reference, and this file has now been wrong three times.
