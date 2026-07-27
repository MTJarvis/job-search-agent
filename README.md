# Job Search Agent

Daily pipeline: discover new reqs, score them against your criteria, tailor the resume, research the hiring manager, draft the outreach email into Outlook, and queue the application for one-tap approval.

Built to run as a scheduled job (cron, GitHub Actions, or a Cloudflare Worker with a Cron Trigger).

---

## Architecture

```
  ┌──────────────┐
  │  1. DISCOVER │  ATS APIs + aggregator + RSS  →  raw postings
  └──────┬───────┘
         │
  ┌──────▼───────┐
  │  2. DEDUPE   │  hash against tracker + agent.db
  └──────┬───────┘
         │
  ┌──────▼───────┐
  │  3. SCORE    │  hard gates, then LLM fit scoring
  └──────┬───────┘  (kills ~99% of volume here)
         │
  ┌──────▼───────┐
  │  4. TAILOR   │  baseline CV + JD → tailored docx/pdf
  └──────┬───────┘
         │
  ┌──────▼───────┐
  │  5. CONTACT  │  find the hiring manager, verify email
  └──────┬───────┘
         │
  ┌──────▼───────┐
  │  6. DRAFT    │  outreach email → Outlook Drafts (Graph API)
  └──────┬───────┘
         │
  ┌──────▼───────┐
  │  7. PACKAGE  │  one folder per role, ready to review
  └──────────────┘
```

## What you get per role

```
output/2026-07-26_Acme-Corp_Director-of-Talent-Acquisition/
  00_BRIEF.md                          title, scope, comp, location, fit read, gaps
  01_CONTACT.md                        hiring manager, email, verification status
  02_EMAIL.md                          the outreach draft (also saved to Outlook)
  03_POSTING.txt                       raw JD, archived
  MJarvis_CV_2026_AcmeCorp.docx/.pdf
  MJarvis_CoverLetter_AcmeCorp_2026.docx/.pdf
output/INDEX_2026-07-26.md             one table across every folder that day
```

Each stage writes to SQLite so a failure in stage 5 does not cost you stages 1 through 4.

---

## Two design decisions worth arguing about

### Do not scrape LinkedIn, Indeed, or Glassdoor directly

Not a legal lecture, an engineering one. All three prohibit scraping in their terms, and LinkedIn in particular runs aggressive detection. Running a daily scraper from your own authenticated session risks the account you use professionally every day. That is a bad trade for a data source you can get cleanly.

The better source is the ATS layer underneath the job boards. Greenhouse, Lever, Ashby, and Workday all expose public, documented, unauthenticated job board APIs. That is where the postings originate, so it is fresher than the boards, structurally clean JSON, and free. `src/sources/ats.js` reads all four.

For coverage beyond companies you can name, use a paid aggregator with a real API rather than scraping: SerpApi's Google Jobs endpoint, Coresignal, or Bright Data. Costs are in the tens of dollars a month. `src/sources/aggregator.js` has a SerpApi adapter.

BuiltIn and several boards publish RSS. `src/sources/rss.js` handles those.

Net effect: you get better data, no account risk, and no cat-and-mouse maintenance.

### The pipeline stops before submit

It packages everything and hands you a folder. You review, then apply yourself. Three reasons, all practical:

1. **Attestation.** Most applications include a checkbox certifying the information is true and complete. That is you certifying, not a script.
2. **Screening questions.** Comp expectations, work authorization, EEO, "why this company," sometimes essay fields. An agent guessing at those produces answers that read like an agent guessing at those.
3. **Fabrication risk.** An LLM tailoring a resume against a JD will occasionally invent a tool, a certification, or a domain. You are a TA leader applying to TA leaders. A hallucinated bullet caught by a peer in your own market costs more than the time the automation saves.

Reviewing a packaged folder takes a couple of minutes: read `00_BRIEF.md`, skim the resume, check the address in `01_CONTACT.md`, send the Outlook draft, submit at the posting link.

---

## Setup

```bash
npm install
cp .env.example .env                                    # fill in keys
cp config/profile.example.json config/profile.json      # fill in your criteria
cp config/companies.example.json config/companies.json  # fill in your watchlist
node src/pipeline.js --once      # single run
node src/pipeline.js --schedule  # daily at 06:00 local
```

### Required credentials

| Key | Purpose | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | scoring, tailoring, email drafting | |
| `MS_CLIENT_ID` / `MS_TENANT_ID` / `MS_CLIENT_SECRET` | Outlook drafts | Azure app registration, `Mail.ReadWrite` delegated scope |
| `HUNTER_API_KEY` | email verification | free tier covers this volume |
| `SERPAPI_KEY` | Google Jobs coverage | optional |

### Company watchlist

Copy `config/companies.example.json` to `config/companies.json` and seed it with the companies you would actually work for, keyed by ATS and board token:

```json
{ "greenhouse": ["acme"], "lever": ["northwind"], "ashby": ["contoso"] }
```

Finding a token: a job URL like `job-boards.greenhouse.io/acme/jobs/123` gives you `acme`.

---

## Files

| Path | Does |
|---|---|
| `config/profile.example.json` | template for your criteria: floor, level, location, gates. Copy to `config/profile.json`, which is gitignored. |
| `config/companies.example.json` | template for the ATS watchlist. Copy to `config/companies.json`, which is gitignored. |
| `src/sources/ats.js` | Greenhouse, Lever, Ashby, Workday readers |
| `src/sources/rss.js` | RSS feeds (BuiltIn and similar) |
| `src/sources/aggregator.js` | SerpApi Google Jobs adapter |
| `src/score.js` | hard gates then LLM fit scoring |
| `src/tailor.js` | JD to resume plan, fabrication audit, cover letter |
| `src/render.js` | plan to docx and pdf, dash check, page count |
| `src/folder.js` | per-role folder, brief, contact sheet, email, index |
| `src/contact.js` | hiring manager research and email verification |
| `src/outlook.js` | Microsoft Graph draft creation |
| `src/store.js` | SQLite: dedupe, state, queue |
| `src/pipeline.js` | orchestration |
