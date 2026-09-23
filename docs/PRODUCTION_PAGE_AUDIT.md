# Production page audit

Audited 21 Sep 2026 against the repository at `40bcaa1` and the live site.
Every status below is backed by a file path, a rendered page, an API reading or
a browser observation. Nothing is inferred from the README.

This is a static site with no accounts, no checkout and no server, so most of a
generic production checklist does not apply. The audit says so item by item
rather than skipping the items, because "not applicable" is a claim that needs
evidence too.

---

## 1. Project detected

| | verified as | evidence |
|---|---|---|
| Application type | Static marketing and catalogue site for a saffron seller. Orders are placed over WhatsApp; nothing is sold on the site itself | `data/site-data.json` `products[]` carry AED prices and `waText`; every order button is a `wa.me` link (`templates.js` `waUrl`, `main.js` `whatsapp_click`); `policies.privacy`: "We do not collect payment card details. We do not run a checkout." |
| Stack | One JSON data file, pure JavaScript render functions, a Node build script, GitHub Pages behind Cloudflare. No framework, no package manifest, no dependencies | `build.js`, `assets/admin/templates.js` (UMD), `assets/js/main.js` (one IIFE, no libraries); no `package.json`; `docs/infrastructure.md` sections 1 to 7 |
| Authentication | **None for visitors.** The only login is the internal admin panel, which takes a GitHub fine-grained token held in the operator's browser and commits to a `content` branch | `admin.html`, `assets/admin/admin.js` `connect()`, `LS_CFG`; `docs/infrastructure.md` section 7 |
| Payments | **None on site.** No provider, no webhook, no cart | grep for `stripe`, `razorpay`, `paypal`, `checkout`, `cart` across `assets/` and `templates.js`: none. `policies.terms` "How an order is made" describes the WhatsApp flow |
| Subscriptions | None. `products[].sale` is a one-off discount field, not a recurring model | `data/site-data.json` `products[]` |
| User roles | One operator role (the panel). Visitors have no identity | `admin.js`; no user model anywhere |
| Personal data touched | Name, phone and address over WhatsApp (off-site, Meta); email via a Mailchimp form; approximate country from IP via ipapi.co; page analytics via Google Analytics 4 and Meta Pixel; an order-attribution code in `localStorage` | `templates.js:499-514` (GA4 and Pixel emitted unconditionally in `head()`), `main.js:309` (ipapi), `main.js:341-396` (overlay to Mailchimp via JSONP), `main.js:50` (`sok_attr`) |
| Browser storage | `localStorage`: `sok_currency`, `sok_country`, `sok_overlay_done`, `sok_attr`. `sessionStorage`: `sok_overlay_seen`. **Cookies: `_ga`, `_ga_9569ES4LBP`, `_fbp`**, set by the two trackers on first visit. `localStorage` also gains `lastExternalReferrer` and `lastExternalReferrerTime`, set by Meta's script | `main.js` grep for `sok_`; live homepage read in Chromium on 21 Sep 2026 after a 2.5 s settle |
| Third-party scripts on the live page | `googletagmanager.com/gtag/js`, `connect.facebook.net/en_US/fbevents.js` (both from the build), and **`static.cloudflareinsights.com/beacon.min.js`, which the build does not emit**. It is injected at the edge by Cloudflare Web Analytics | live page `document.scripts`; `grep cloudflareinsights` across the repo returns nothing; the read-only Cloudflare token cannot read the RUM setting (`10001 Unable to authenticate request`) |
| Markets | UAE and GCC, India, rest of world. Explicitly **not** the EU or UK | `main.js` country to currency map; `policies.privacy` "Not for EU or UK customers" |
| Tests and CI | `tools/check_*.py` (seven checks) plus parity, run locally and in `.github/workflows/build-check.yml` on every push; a browser harness for the admin gate in `tools/prove_gate.js` | `CLAUDE.md` Verification section; workflow files |

---

## 2. Audit table

Statuses: `EXISTS_AND_ADEQUATE`, `EXISTS_NEEDS_IMPROVEMENT`, `APPLICABLE_MISSING`,
`NOT_APPLICABLE`, `BLOCKED_BY_MISSING_INFORMATION`.

### Legal

| Category | Page or state | Status | Evidence | Applicability reason | Required action |
|---|---|---|---|---|---|
| Legal | Privacy Policy | **EXISTS_NEEDS_IMPROVEMENT** | `policies.privacy`, 11 sections, live at `/privacy-policy`. It names every processor the code uses (GA4, Meta Pixel, Mailchimp, ipapi.co, GitHub Pages, Cloudflare) and lists the `sok_*` storage keys. **Three factual gaps against the live site:** (1) the "What we store in your browser" section opens *"Not cookies, but browser storage that does the same job"*, while first visit sets `_ga`, `_ga_9569ES4LBP` and `_fbp`; (2) Meta's `lastExternalReferrer` and `lastExternalReferrerTime` keys are not listed; (3) Cloudflare Web Analytics loads on every page and is not named as a processor, only "hosting and delivery" | Personal data is collected and shared with third parties | Correct the three facts. `policies` is a locked path (`tools/locked.json`), so this goes through a developer pull request, which is the intended route |
| Legal | Terms of Service | EXISTS_AND_ADEQUATE | `policies.terms`, 13 sections: Seller details, Grievance Officer, What we sell, Where we sell, How an order is made, Prices and currency, The product, No health claims, Intellectual property, Liability, Governing law, Changes. Live at `/terms` | Public service with transactions | None |
| Legal | Cookie Policy | **EXISTS_NEEDS_IMPROVEMENT** | Handled inside the privacy policy's browser-storage section rather than as a separate page. Same factual gap as above. A single-section inventory does not warrant its own page on a site with three cookies | Site sets cookies (verified in a browser) | Fix within the privacy policy; name the three cookies and who sets them |
| Legal | Cookie Preferences | **BLOCKED_BY_MISSING_INFORMATION** | GA4 and Meta Pixel are emitted unconditionally in `head()` (`templates.js:499-514`). No consent mechanism exists (grep for `consent` finds only the Mailchimp form's tick box). The privacy policy states the site is *"not written to the GDPR"* and does not serve the EU or UK. The markets that remain, UAE and India, have their own data-protection regimes | Non-essential tracking is present | **Owner decision needed.** Whether to gate GA4 and the Pixel behind consent under UAE PDPL or India DPDP is a legal and commercial call: gating changes what analytics collects. Not implemented on a guess |
| Legal | Refund Policy | EXISTS_AND_ADEQUATE | `policies.returns` section "The one exception" (full refund on a failed independent lab test) plus `data.guarantee` on the homepage FAQ. Both locked | Purchases are refundable | None |
| Legal | Cancellation Policy | EXISTS_AND_ADEQUATE | `policies.returns` section "Cancellations" | Orders can be cancelled | None |
| Legal | Shipping Policy | EXISTS_AND_ADEQUATE | `policies.shipping`, 7 sections incl. customs and lost-in-transit. Live at `/shipping-policy` | Physical goods shipped | None |
| Legal | Return / Exchange Policy | EXISTS_AND_ADEQUATE | `policies.returns`, 8 sections: unopened, opened, the one exception, damaged, what is not a defect, cancellations, outside India. Live at `/returns-policy` | Physical goods | None |
| Legal | Disclaimer | EXISTS_AND_ADEQUATE | `policies.terms` "No health claims" and "Liability"; the `health-claims` post; `storing-saffron` frames its figures as *"guides, not a use-by date"* | Food product with health-claim exposure | None |
| Legal | Accessibility Statement | **APPLICABLE_MISSING** | No such page (`policies` keys are `terms`, `shipping`, `returns`, `privacy`). The implementation already carries: a skip link, `:focus-visible` styles, `prefers-reduced-motion`, `lang="en"`, alt text on every image on the three list pages, `aria-pressed` on filter buttons, `aria-live` regions. **No accessibility audit has been performed** | Public-facing product | Add as `policies.accessibility` so it gets its page, footer link, sitemap and `llms.txt` entry automatically. **Must not claim WCAG conformance.** See the Cloudflare note in section 4 |
| Legal | Data Processing Agreement | NOT_APPLICABLE | No business customers, no API, no processing on anyone's behalf. Bulk and corporate orders (`products[].specs` "Best for") are still consumer-style WhatsApp orders | | |
| Legal | Acceptable Use Policy | NOT_APPLICABLE | No accounts, uploads, messaging, automation or user content on the public site | | |
| Legal | Security Policy | **BLOCKED_BY_MISSING_INFORMATION** | No security contact is designated. `brand.email` exists but using it for vulnerability reports is an owner decision. A real defect was found and fixed on 11 Sep 2026 (`docs/infrastructure.md` section 10), so a channel would have had something to receive | Public product | Owner names a reporting address. Then a `security.txt` and a short page |
| Legal | Responsible Disclosure | **BLOCKED_BY_MISSING_INFORMATION** | Same as above | | Same |
| Legal | Community Guidelines | NOT_APPLICABLE | No comments, reviews, messaging or community. `testimonials.items` are entered by the operator through the panel, not submitted by visitors | | |

### Customer lifecycle

| Category | Page or state | Status | Evidence | Applicability reason | Required action |
|---|---|---|---|---|---|
| Lifecycle | Login | NOT_APPLICABLE | No customer accounts. No auth code, user model, session or protected route on the public site. The admin panel's connect screen is an operator tool, not a customer page | | |
| Lifecycle | Register | NOT_APPLICABLE | As above | | |
| Lifecycle | Email Verification | NOT_APPLICABLE | No accounts. The Mailchimp overlay hands the address to Mailchimp, which runs its own confirmation | | |
| Lifecycle | Forgot Password | NOT_APPLICABLE | No passwords exist anywhere in the product | | |
| Lifecycle | Reset Password | NOT_APPLICABLE | As above | | |
| Lifecycle | Onboarding | NOT_APPLICABLE | Nothing to set up. First-visit behaviour is a currency guess with a manual switcher and an optional discount overlay | | |
| Lifecycle | Account Settings | NOT_APPLICABLE | No accounts | | |
| Lifecycle | Account deletion | NOT_APPLICABLE | No accounts. Data-subject requests are covered by `policies.privacy` "Your rights" and "Who to contact" | | |
| Lifecycle | Billing / Upgrade / Downgrade / Cancel Subscription | NOT_APPLICABLE | No subscription model. Prices are one-off AED figures | | |
| Lifecycle | Payment Success / Failed / Pending | NOT_APPLICABLE | No on-site payment. There is no URL parameter or provider callback to verify | | |
| Lifecycle | Support | EXISTS_AND_ADEQUATE | Homepage `contact` section; footer carries phone, email and two WhatsApp numbers routed by the visitor's country (`main.js` module 7); `policies.terms` "Grievance Officer" | | None |
| Lifecycle | Help Center | EXISTS_AND_ADEQUATE | FAQ (8 items at `/#faq`), 14 published guides, the purity checker on `/blog/purity-tests/` | | None |

### UX and system states

| Category | Page or state | Status | Evidence | Applicability reason | Required action |
|---|---|---|---|---|---|
| UX | 404 | EXISTS_AND_ADEQUATE | `404.html` from `render404`: one `h1`, `noindex`, "Back to Home" and "View Products", full navigation. GitHub Pages serves it for any unknown path. `docs/infrastructure.md` section 3 records the redirect rules that keep old `.html` addresses from 404ing | | None |
| UX | 403 | NOT_APPLICABLE | No authorization layer on public content. The admin panel's refusals are in-panel messages that name the fault (locked fields, `classifyRefFault`) | | |
| UX | 500 | NOT_APPLICABLE | No application server to fail. Origin and edge errors render Cloudflare's own pages; custom error pages are not available on the zone's plan (`Free Website`, read from the API on 10 Sep 2026) | | |
| UX | Maintenance | NOT_APPLICABLE | No maintenance-mode configuration exists to drive one from, and Pages deploys are atomic. A hardcoded page would violate the brief | | |
| UX | Offline | NOT_APPLICABLE | Static HTML, no service worker. The two runtime requests degrade on their own: ipapi.co falls back to a timezone guess (`main.js:318`), the Mailchimp JSONP has an `onerror` path with a message | | |
| UX | Empty State | **APPLICABLE_MISSING** | The filter bars on `/products` and `/blogs` hide non-matching cards (`main.js:37-40`) and show **nothing** when zero match. Today every filter has at least one item, but `heritage` has exactly one post, `pampore-legacy`, which is on the content queue for retire-or-merge. Retiring it blanks the grid with no explanation | Latent, one queued edit away | Add a "nothing in this category" message with a way back to all items |
| UX | No Search Results | NOT_APPLICABLE | There is no search. Category filters are the Empty State row above | | |
| UX | Loading | NOT_APPLICABLE | Prices render in AED at build time; the currency switch is synchronous after one geo fetch with a fallback. No content area waits on a request | | |
| UX | Error State | EXISTS_AND_ADEQUATE | Overlay: Mailchimp error message and connection error (`main.js:399-408`). Admin panel: every publish stage names its fault; proven in a browser on 11 Sep 2026 | | None |
| UX | Success State | EXISTS_AND_ADEQUATE | Overlay `successText` and `.sok-overlay-success`; admin "Done! N file(s) committed" | | None |
| UX | Session Expired | EXISTS_AND_ADEQUATE (operator tool only) | The public site has no sessions. Admin panel: 401 at connect says *"GitHub rejected the token. Check it was copied fully and has not expired"*; 401 at publish gives the `auth` fault, *"Generate a new one and reconnect from the login screen"*. The stored token is overwritten on reconnect rather than cleared on 401, which is acceptable for a single-operator tool | | None now. If the panel gains multiple operators, clear the token on 401 |

---

## 3. Missing owner information

These block the items marked `BLOCKED` above. None has been guessed.

1. **Consent regime.** Should Google Analytics and the Meta Pixel load only after consent, for UAE and Indian visitors? This is a legal reading of UAE PDPL and India DPDP that the code cannot make, and gating changes what analytics collects.
2. **Security reporting address.** Which mailbox receives vulnerability reports, and is `info@saffronofkashmir.com` acceptable for that?
3. **Cloudflare Web Analytics.** Confirm it is intentionally enabled. It is injected at the edge, appears in no file in this repository, and the read-only token cannot read its setting. The privacy correction in this pass names it as a processor because it demonstrably runs; if it is unintentional, disable it in the Cloudflare dashboard under Analytics and remove the line.
4. **Accessibility response.** Whether the statement should promise a response time to accessibility complaints. Left out until told.

---

## 4. Constraints on implementation specific to this repository

- **`policies` is locked.** `tools/locked.json` locks the whole tree, so the admin panel renders it read-only and `check_locked.py` refuses a panel publish that touches it. A developer pull request is the sanctioned route, and that is what this pass uses.
- **A new file-backed page needs a Cloudflare rule.** `docs/infrastructure.md` section 3: the `.html` to extensionless redirect rules enumerate seven paths and are not wildcards. GitHub Pages will serve `/accessibility` on its own, but `/accessibility.html` will keep answering 200 as a duplicate until the owner adds it to rules 4, 5 and 6. The Cloudflare token in use is read-only, so this is reported, not done.
- **Every generated page must keep one `h1`, valid JSON-LD, canonical and `og:` tags** (CLAUDE.md hard rule 2). `renderPolicyPage` already satisfies this for any `policies` key.
- **No em or en dashes in copy.** Checked on every added string.

---

## 5. Legal review warning

The privacy correction in this pass changes three statements of fact to match what the site demonstrably does. It does not change the policy's legal positions (jurisdiction, retention, rights, age). Those were written by the owner and are outside what a code audit can assess. **Professional legal review of all four policies is still advisable**, particularly the "Not for EU or UK customers" position as the sole basis for not offering consent controls, and the retention periods.

---

## 6. Implementation record

Filled in as each item lands. Nothing below is claimed done until it is merged and verified on the live site.

| Item | Pull request | State on 22 Sep 2026 |
|---|---|---|
| This audit | this PR | open |
| Privacy policy: three factual corrections | #60 | open, CLEAN, parity 1 page 7 blocks |
| Accessibility statement page at `/accessibility` | #61 | open, CLEAN, parity 29 pages 1 block each plus 1 page added; needs the Cloudflare rule change in section 4 |
| Filter empty state on `/products` and `/blogs` | #62 | open, CLEAN, proven in Chromium on both pages |

Nothing above is merged. Each was verified with the full suite and, where it
has behaviour, in a real browser, and each carries its own proof in its pull
request. The panel published on its own through the content branch on 22 Sep
2026 (`40bcaa1`, 30 files), which is the first unassisted publish through the
pipeline and is recorded here because it is the thing the whole model exists
for.
