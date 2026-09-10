# HANDOFF — saffronofkashmir.com

This is the **single onboarding document** for anyone (human or LLM) about to make changes to this site.
Read it top to bottom once; after that, use it as a map.

`CLAUDE.md` (in this repo) holds the **hard rules and is authoritative** where the two ever disagree.
This file is the *practical* picture: current architecture, the data model, how to make common changes,
how to verify, the environment gotchas, and what has already been done.

Last updated: 2026-06-15.

---

## 1. What this is

- A **static marketing + catalogue website** for a Kashmiri saffron business (Pampore, est. 2004).
- Live at **https://saffronofkashmir.com**, hosted on **GitHub Pages** behind **Cloudflare**.
- Orders happen over **WhatsApp** (no cart, no checkout, no payments on-site).
- Repo: `github.com/Cyber-Kash/saffronofkashmir`. Default branch: `main`. `CNAME` pins the domain.
  Transferred from `zeeshan-shaheen/saffronofkashmir` on 10 Sep 2026. GitHub redirects
  the old path, but that redirect lapses if anyone claims the old username, so do not
  rely on it in anything written down.

There is **no server and no database.** You cannot run server-side code, store user data, or keep secrets
in any file that ships. Everything the visitor sees is pre-built static HTML.

---

## 2. The one idea you must understand

**All content lives in one JSON file, and every HTML page is generated from it.**

```
data/site-data.json   →   assets/admin/templates.js   →   build.js   →   *.html, sitemap.xml, llms.txt
   (the content)            (pure data→HTML functions)     (writer)        (generated output — do NOT hand-edit)
```

- To change **words/prices/images** → edit `data/site-data.json`, then `node build.js`.
- To change **markup/page structure** → edit `assets/admin/templates.js`, then `node build.js`.
- **Never hand-edit** `index.html`, `products.html`, `recipes.html`, `blogs.html`, `404.html`,
  `privacy-policy.html`, `sitemap.xml`, `llms.txt`, or anything under `products/<slug>/`. They are build output.
- `admin.html` + `assets/admin/admin.js` are a **browser-only** editor that edits the JSON and commits the
  regenerated pages to GitHub via the GitHub API. It runs the same `templates.js` in the browser.

If a handoff note and the live `data/site-data.json` ever disagree, **the JSON wins.**

---

## 3. Repository map (current)

```
saffronofkashmir/
├── data/site-data.json          ← SINGLE SOURCE OF TRUTH (all content)
├── assets/
│   ├── admin/
│   │   ├── templates.js         ← pure render functions (UMD: runs in Node + browser)
│   │   └── admin.js             ← browser-only admin panel logic
│   ├── js/main.js               ← runtime JS for the live site (no libraries)
│   └── css/style.css            ← single stylesheet, no frameworks
├── admin.html                   ← browser-only admin panel (noindex)
├── build.js                     ← `node build.js` regenerates everything
├── robots.txt                   ← disallows /admin.html, /assets/admin/, /data/, /_archive/
├── CLAUDE.md                    ← AUTHORITATIVE rules of engagement
├── HANDOFF.md                   ← this file
│
│  ── generated output (DO NOT hand-edit) ──
├── index.html  products.html  recipes.html  blogs.html  404.html  privacy-policy.html
├── sitemap.xml  llms.txt
├── products/<slug>/index.html   ← one per product (see §7)
│
│  ── images (live in repo root, referenced by filename in the JSON) ──
├── *.webp  (logo-1, logoback-1, covercgpt-1, slider2, slider4-1, 2gm-1, 5gm-1, 10gm-1, …)
├── _archive/                    ← unused original images, kept out of the way (robots-disallowed)
│
└── _* scratch files (verification helpers, not part of the site; safe to ignore/not commit)
```

---

## 4. The data model — `data/site-data.json`

Top-level keys (these are the ACTUAL keys in use; trust the file over any older doc):

| Key | What it holds |
|---|---|
| `meta` | `schemaVersion`, `lastPublished` (ISO; the admin sets this on publish) |
| `brand` | identity, contact, analytics IDs, **`currencies`** map (see below) |
| `seo` | per-page SEO: keys `home`, `products`, `recipes`, `blog`; each has `title`, `description`, `ogTitle`, `ogDescription` |
| `hero` | homepage hero (`eyebrow`, `title`, `lead`, `primaryCta`, `points[]`, `image`, `imageAlt`) |
| `whyUs` | `eyebrow`, `heading`, `cards[]` ({icon,title,text}) |
| `homeProducts` | headings for the homepage featured strip |
| `products` | **array** — see field list below |
| `howItWorks`, `story`, `testimonials`, `contact`, `footer` | homepage sections |
| `faq` | `eyebrow`, `heading`, `items[]` of **`{ q, a }`** (answer supports mini-markdown) |
| `productsPage` | catalogue page copy: `h1`, `sub`, `filters[]`, `compare`, `identify`, `delivery` |
| `recipesPage` | recipes page copy (`h1`, `sub`, `golden`) |
| `recipes` | **array** — see field list below |
| `blogPage` | blog page copy: `h1`, `sub`, `categories[]`, `sidebar` |
| `posts` | **array** — see field list below |
| `notFound` | 404 copy |
| `overlay` | first-visit discount popup (Mailchimp); `enabled` toggles it entirely |

### `brand.currencies`
Map keyed by code (`AED` base, plus `USD`, `INR`, `SAR`, `QAR`, `OMR`). Each: `{ name, symbol, rate, decimals, markup }`.
Prices are stored in **AED**; `main.js` converts client-side: `converted = aed * rate * (1 + markup/100)`.

### A `products[]` item
```
id, baseName, size, grams (or null), unitLabel, price (AED),
altContext, descBody, image, homeDesc, pageDesc,
category ("saffron" | "gift"), featured (bool),
status ("available" | "out_of_stock" | "coming_soon"),
sale (null | { price, label, until }),
specs[] ({label,value}), compare (null | {servings,bestFor}), valueBlurb (optional)
```
`templates.js` `productView(p)` derives the rest: `name = baseName+" "+size`, `schemaName`, `imageAlt`,
`waText`, `perGram = round(price/grams)`. **Display name and slug come from `baseName`+`size`, not `id`.**

### A `recipes[]` item
```
id, name, schemaName, cardDesc, schemaDesc, image, imageAlt,
timeLabel, totalISO (e.g. "PT15M"), cuisineLabel, cuisine, servesLabel, yield,
recipeCategory (e.g. "Beverage" | "Main Course"), ingredients[], steps[], tip
```

### A `posts[]` (blog) item
```
id, categoryKey, dateISO, dateDisplay, title, excerpt, body (mini-markdown),
image (optional), imageAlt (optional)
```
Blog `body` mini-markdown: blank line = new paragraph; a line starting `## ` becomes an `<h3>`.
If `image` is set it shows on the card AND populates the Article `image` schema; if absent, neither appears.

Inline mini-markdown (used in faq answers, recipe steps, etc.): `[label](url)`, `**bold**`, `*em*`,
and `wa:Message text` → a WhatsApp link with that prefilled message.

---

## 5. `templates.js` — render functions (pure data→HTML strings, no DOM/fetch)

| Function | Output |
|---|---|
| `renderIndex` | `index.html` (Organization + WebSite + FAQPage JSON-LD) |
| `renderProducts` | `products.html` — the **catalogue**: cards link to detail pages; JSON-LD is `BreadcrumbList` + `ItemList` |
| `renderProductDetail(data, p)` | **one product page** at `products/<slug>/index.html`; single `Product` + `BreadcrumbList` JSON-LD |
| `renderRecipes` | `recipes.html` (Recipe JSON-LD per recipe) |
| `renderBlogs` | `blogs.html` (BlogPosting JSON-LD per post; image when present) |
| `render404`, `renderPrivacyPolicy` | those pages |
| `renderSitemap`, `renderLlms` | `sitemap.xml`, `llms.txt` |
| `renderAll(data)` | returns `{ filename: html, … }` for **every** output file, including the per-product pages. Both `build.js` and the admin publish loop iterate this. |

Helpers worth knowing: `esc`, `waUrl`, `inlineMd`, `plainMd`, `productView`, `productPriceHtml`
(emits `data-price="<aed>"` for the currency switcher), `statusBadge`, `statusAvailability`.

### The path-prefix (`base`) system — important for nested pages
Root pages live at `/x.html`; product pages live two levels deep at `/products/<slug>/index.html`.
The shared chrome (`head`, `header`, `footer`, `breadcrumbs`, `renderOverlayHtml`) accepts an optional
**`base`** prefix and applies it to every *relative* asset/link (CSS, logo, favicon, nav, main.js, overlay).

- Root pages pass **no base** → it defaults to `''` → output is byte-identical to before this system existed.
- Product pages pass **`base = '../../'`** so `assets/css/style.css` etc. resolve from the subfolder.
- `head()` also accepts per-page overrides via the `page` object: `page.seo` (a `{title,description,ogTitle,ogDescription}`
  object instead of a `data.seo` key), `page.url` (canonical/og:url), `page.ogImage`, `page.base`.

There is **no `<base>` HTML tag** (it would break in-page `#anchor` links); the prefix is applied per-attribute.

### Slug / URL helpers
```
slugify(s)        → lowercase, drop apostrophes, non-alphanumerics → single hyphen
productSlug(p)    → slugify(baseName) + "-" + slugify(size without spaces)   e.g. "royal-mongra-2g"
productPath(p)    → "products/<slug>/"        (relative to site root)
productUrl(b, p)  → "https://…/products/<slug>/"   (absolute, trailing slash)
```

---

## 6. `main.js` runtime modules (one IIFE, no libraries)

1. Mobile nav toggle · 2. Back-to-top · 3. Filter bars (products/blog categories) ·
4. WhatsApp click tracking (`gtag('event','whatsapp_click')`) ·
5. **Currency switcher** (geo-detect via ipapi.co on first visit; `localStorage` key `sok_currency`; converts all `[data-price]`) ·
6. **First-visit overlay** (Mailchimp JSONP; `sessionStorage` `sok_overlay_seen`, `localStorage` `sok_overlay_done`) ·
7. Recipe print button.

Country→currency map lives in `main.js` (AE→AED, IN→INR, US→USD, SA→SAR, QA→QAR, OM→OMR, KW/BH→AED, else→USD).

---

## 7. Product pages (per-URL) — how they work

- Every product in `products[]` gets its own page: `products/<slug>/index.html`, served at `/products/<slug>/`.
  Current slugs: `royal-mongra-2g`, `collectors-tin-5g`, `heritage-reserve-10g`,
  `saffron-honey-500ml`, `saffron-oil-15ml`, `kashmiri-kahwa-blend-100g`.
- The page has: breadcrumb (Home › Products › Name), one `<h1>`, image, price (currency-aware), full
  description, specs, WhatsApp order button, related-product links, self-canonical, product-image OG/Twitter,
  and a single `Product` + `Offer` + `BreadcrumbList` JSON-LD. This is the **rich-result-eligible** page.
- `products.html` is the catalogue/listing; its JSON-LD is an `ItemList` pointing at the detail pages
  (listing pages should NOT carry multiple `Product` blocks).
- Slugs are **derived from `baseName`+`size`**. Renaming a product changes its URL and leaves the old
  `products/<old-slug>/` file as an orphan (the build does not delete stale files). If you need rename-proof
  URLs, add an explicit `slug` field per product (see Open follow-ups).

---

## 8. Making common changes — playbook

**Change wording / a price / swap an image filename**
→ edit `data/site-data.json` → `node build.js` → review diff. (Images: drop the file in repo root, set its filename in the JSON.)

**Add a product**
→ add an object to `products[]` (copy an existing one, change fields). `node build.js` creates its
`products/<slug>/index.html`, adds it to the catalogue, the homepage strip (if `featured:true`), and the sitemap. No template edit needed.

**Add a blog post (with image)**
→ add to `posts[]` with `image` + `imageAlt`. Drop the image in repo root. `node build.js`. The image shows on the card and in the Article schema.

**Add a recipe** → add to `recipes[]` (include `recipeCategory`, `totalISO`, etc.).

**Toggle the discount overlay** → `overlay.enabled` true/false (mirrors the admin; safe to do directly with human OK).

**Change currency rates / markup** → `brand.currencies.<CODE>.rate` / `.markup` / `.decimals`.

**Add a brand-new page type** → add a `renderXxx(data)` to `templates.js`, add it to `renderAll`’s return
object and to the public-API `return {…}` at the bottom; `build.js` picks it up. Keep it pure (no DOM/fetch).

**Add a new editable field that must appear on the site AND be admin-editable**
→ you MUST edit BOTH `templates.js` (so it renders) and `admin.js` (so it can be edited). A field added only
to `admin.js` saves into the JSON but is invisible on the site — the single most common mistake here.

---

## 9. Build & verification workflow

```bash
# from repo root
node --check assets/admin/templates.js   # syntax
node --check assets/admin/admin.js
node --check build.js
node build.js                            # regenerate all output
```

Then verify (scratch scripts already exist in repo root; they are not part of the site):
- **JSON-LD valid:** `python _check_jsonld.py` (extend the file list to cover product pages if needed).
- **Parity (visible text):** `python _parity_check.py` — flags changes in the visible text of pages vs a baseline.
  NOTE the `_parity_baseline/` is **stale** (predates recent copy changes), so it currently reports expected
  diffs on `index.html`/`products.html`. Regenerate baselines if you want a clean run. The reliable check is
  `git diff --ignore-cr-at-eol HEAD -- <file>`.
- **Link resolution on nested pages:** resolve every relative `href`/`src` against the page’s folder and confirm
  the target exists. (A 180-link check passed clean when product pages were introduced.)

Each page must keep: exactly one `<h1>`, parseable JSON-LD, correct `canonical` + `og:` tags. `admin.html`
stays `noindex`. `robots.txt` keeps its `Disallow` lines.

---

## 10. Environment gotchas (Windows + OneDrive) — these will bite you

- **The repo lives in a OneDrive-synced folder.** Node’s `fs.writeFileSync` can fail with `UNKNOWN`/`EPERM`
  when **overwriting** existing binary files (image optimization). Workaround: write outputs to a **temp dir
  outside the repo**, then `cp` them in via Bash.
- **No image tooling is installed** (`cwebp`, ImageMagick, `sharp` all absent; the `convert` on PATH is the
  Windows disk tool, not ImageMagick). To process images, `npm install sharp` into a **temp dir outside the
  repo**, use it via its absolute path, then delete the temp dir. Don’t add `node_modules` to the repo.
- **`gh` (GitHub CLI) is installed but not on PATH:** `C:\Program Files\GitHub CLI\gh.exe`. Prefix PATH or call it directly.
- **CRLF churn:** `build.js` writes LF; git normalizes to CRLF, so generated HTML often shows as modified even
  when content is identical. **Stage only the files you intentionally changed**; leave CRLF-only churn unstaged.
  Use `git diff --ignore-cr-at-eol` to see real changes.
- **Console encoding:** the Windows console is cp1252 and throws on printing characters like `→` (`→`).
  That’s an output-printing issue, not a content problem.
- **Two `CLAUDE.md` files exist** (one in the parent `SOK/` folder, one in this repo). The repo one ships with the code.

---

## 11. Git workflow (mandatory)

- Work on a branch `feature/<short-name>`. **Never commit to `main` directly; never merge/push to `main`
  without explicit human approval.** One feature = one clean commit (or a small, clear set).
- Generated HTML output IS committed (it’s what GitHub Pages serves). Commit the regenerated pages alongside
  the source change that produced them.
- Open PRs with `gh` (full path, see §10). PRs in this project have been **squash-merged** into `main`.
- Don’t commit secrets (the GitHub token lives only in the owner’s browser), and never put real images in a zip/package.

---

## 12. What has been done (change log)

| PR | Status | Summary |
|---|---|---|
| #1 | merged | Single-source product refactor + initial SEO/copy fixes (pre-existing) |
| #2 | merged | **Structured data + social meta + AEO FAQ.** Product `itemCondition`/`priceValidUntil`; BlogPosting `publisher.logo`/`dateModified`/`mainEntityOfPage`/`inLanguage`; Recipe `inLanguage`/`recipeCategory`; Organization `sameAs`; `og:site_name`/`og:locale`/`twitter:title|description|image`. FAQ answers rewritten with direct lead sentences; 3 new FAQs (delivery outside UAE, origin, price) → 8 total. |
| #3 | merged | **Blog post images.** Optional per-post image on the card + Article `image` schema (gated on the post having an image). New admin fields. |
| #4 | merged | **Image optimization.** Re-encoded/right-sized the 13 served images (~2.5 MB → ~0.7 MB; slider2 1 MB→59 KB, favicon 121→14 KB, logo 162→37 KB; alpha preserved). Moved 11 unused originals (~11.6 MB) to `/_archive`; `robots.txt` disallows it. |
| #5 | **in review** (`feature/product-pages`) | **Per-product URLs** at `/products/<slug>/` (this branch). See §7. Not yet on `main`. |

SEO/AEO/GEO context for these decisions:
- **SEO:** Product rich results want single-product-focused pages (→ PR #5). Article needs `publisher.logo`+image.
- **AEO:** FAQ *rich results were deprecated* (2026) — kept the schema (still valid for Bing/AI), but the real
  value is the concise lead answers winning featured snippets/voice. Don’t expect a SERP FAQ accordion.
- **GEO:** emerging, weak evidence. `llms.txt` exists but Google has said no AI system uses it — keep, expect nothing.
- **Never added:** review/`aggregateRating` schema (no real on-page reviews — Google policy), shipping/return
  policy schema (no confirmed policy). Don’t add these without the real thing.

---

## 13. Open follow-ups (nothing blocking)

- **Merge PR #5** (per-product pages) when ready, then **submit the updated sitemap in Search Console** and run
  the **Rich Results Test** on a product URL.
- **Add real blog post images** (set `posts[].image`/`imageAlt`) — support is built, images just need adding.
- **Rename-proof product URLs:** add an explicit `slug` field per product (fall back to derived) if products
  may be renamed; also requires an admin field.
- **Per-product SEO overrides:** product titles/descriptions are currently derived; add optional override fields if wanted.
- **Admin preview for product pages:** `renderProductDetail` is exported but not wired into the admin preview map.
- **Eyeball optimized images** (logo/favicon/story) on the live site after the PR #4 deploy.

---

## 14. Hard rules (recap — `CLAUDE.md` is authoritative)

1. `templates.js` stays pure UMD: no `document`, `window`, `fetch`, or DOM. It runs in Node and the browser.
2. Every page: one `<h1>`, valid JSON-LD, correct canonical + og tags. `admin.html` stays `noindex`.
3. Publishing stays idempotent / skip-unchanged.
4. Never commit secrets. Never put real images in a zip/package.
5. Writing style: **no em dashes / en dashes** (plain hyphens for ranges), straight punctuation, plain concrete
   voice of a Pampore saffron seller. Exception: curly quotes inside customer testimonials stay as-is.
6. Don’t fabricate facts, prices, reviews, or dates in copy or structured data — it must match the page.
7. Don’t hand-edit generated output; don’t refactor/rename files you weren’t asked to touch.
