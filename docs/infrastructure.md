# Infrastructure

Configuration that exists only in the Cloudflare and GitHub Pages dashboards and
nowhere in this repository.

**Verification status.** Every line is marked.

`[verified]` was read from an authenticated GitHub API, from public DNS, or
observed directly over HTTP. Most of this file was re-checked on 10 Sep 2026 in
preparation for moving the repository into an organisation, so that anything the
move broke would be visible against a recorded baseline.

`[unconfirmed]` could not be read. There is no Cloudflare API credential in the
working environment, and the Cloudflare dashboard needs an interactive login
that is not available here either. Four things are only in that dashboard and
remain unread; they are listed at the end. Everything else that was
`[unconfirmed]` on 1 Sep has now been resolved.

Treat `[unconfirmed]` as a starting point and check the dashboard before relying
on it.

---

## 1. SSL/TLS

**Mode: Full (Strict).** `[unconfirmed]` The setting itself is only in the
Cloudflare dashboard. Behaviour consistent with it is `[verified 10 Sep 2026]`:

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

Read from public resolvers on 10 Sep 2026. This is what the world actually
sees, which for everything except proxy-hidden record types is stronger evidence
than the dashboard.

**Nameservers `[verified]`**

```
saffronofkashmir.com  NS  donald.ns.cloudflare.com    TTL 86400
                      NS  rosemary.ns.cloudflare.com  TTL 86400
```

**Proxied (orange cloud) `[verified]`**

```
saffronofkashmir.com      A  104.21.92.83    TTL 300
                          A  172.67.190.136  TTL 300
www.saffronofkashmir.com  A  104.21.92.83    TTL 300
                          A  172.67.190.136  TTL 300
```

Both resolve to Cloudflare address space, not to the GitHub Pages IPs
(`185.199.108-111.153`), which is what proves they are proxied.

**`www` record type is still `[unconfirmed]`.** A `CNAME` query for `www`
returns no answer while an `A` query returns the proxy addresses. That is
exactly what a proxied `CNAME` looks like from outside, because Cloudflare
answers `A` directly and never exposes the underlying record. It is also what a
proxied `A` record looks like. The two cannot be told apart without the
dashboard.

**DNS only (grey cloud), and must stay that way `[verified]`**

```
MX     10 mx.zoho.com          TTL 300
       20 mx2.zoho.com         TTL 300
       50 mx3.zoho.com         TTL 300

TXT    v=spf1 include:zohomail.com a mx include:_spf.mlsend.com ~all
       zoho-verification=zb20301374.zmverify.zoho.com
       mailerlite-domain-verification=78bf4e328f0450c638f23076f003758785b41281
       google-site-verification=ELCeRYXypP2AtFZgYaTpY8ZA1i41R5h3-Kn47b1NfDc
       pinterest-site-verification=f564b77ec5247c8587c303d86481fe48
                                    all TTL 300

zmail._domainkey  TXT  v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GN...
_dmarc            TXT  v=DMARC1; p=none; rua=mailto:c6eb6422fd0b414cabca6e66a09f7124@dmarc-reports.cloudflare.net
```

**Correction to an earlier claim.** This file previously said DKIM existed for
Zoho *and for MailerLite*. Zoho's is confirmed, at selector `zmail._domainkey`.
**No MailerLite DKIM record was found**, at any of ten common selectors
(`ml`, `mailerlite`, `mlsend`, `default`, `s1`, `s2`, `selector1`, `google`,
`zoho`, `zmail`). MailerLite is verified through the apex `TXT` record instead,
which is present. Either the DKIM was never added or it uses a selector not
tried; check the MailerLite dashboard before assuming mail from it is signed.

DMARC is present and set to `p=none`, reporting to Cloudflare's DMARC
Management. `p=none` monitors and enforces nothing.

Cloudflare cannot proxy `MX`, and proxying mail-related records breaks delivery
and domain authentication.

---

## 3. Redirect rules

Order matters. Listed in the order they must run.

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

## 4. Disabled rules

Five wildcard rules, for `index`, `products`, `recipes`, `blogs` and `privacy`,
are **Disabled, not deleted**. `[unconfirmed: all of it]`

They are superseded by `html-to-extensionless` and `index-html-to-root`. Reasons
they were replaced:

- They matched on the full URI including hostname, rather than on path alone.
- The `index` rule matched `http://` only, so it never fired on real traffic
  once HTTPS was enforced.
- Between them they left four `.html` paths uncovered.

Leave them disabled. Do not re-enable without re-checking those three points.

---

## 5. Branch protection `[verified 10 Sep 2026]`

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

## 6. Pricing

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

## 7. What cannot be done in the repository

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

Four things, all of them only in the Cloudflare dashboard, which needs an
interactive login. Everything else that was open on 1 Sep 2026 has been read and
recorded above.

1. **SSL/TLS mode is literally set to Full (Strict).** Behaviour is consistent
   with it and is recorded in section 1, but behaviour cannot distinguish Full
   (Strict) from Full.
2. **The exact expression, action, target and status code of each active rule.**
   What each rule *does* is fully recorded in section 3 from observation. What
   each rule *says* is not.
3. **The order the rules appear in.** Order is load-bearing: the two retirement
   rules must sit above `trailing-slash-to-canonical` or a no-slash request to a
   retired path is normalised to a URL that no longer exists and answers 404.
   The observed behaviour is consistent with the correct order, which is
   evidence but not proof.
4. **The five disabled rules**: that they exist, their names, their expressions,
   and that they are Disabled rather than deleted.

**One thing this file was wrong about, now corrected:** it claimed a MailerLite
DKIM record exists. None was found. See section 2.

**One thing that cannot be resolved from outside at all:** whether `www` is a
`CNAME` or an `A` record. Cloudflare's proxy hides the difference. Section 2
explains why.

Correct anything wrong here in place. A reference that is trusted and wrong is
worse than no reference.
