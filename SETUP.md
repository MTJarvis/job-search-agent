# Setup, start to finish

Budget about 90 minutes for the first pass. Step 4 (Azure) is the fiddly one; everything else is quick. Do the steps in order and test at each stage rather than wiring it all up and running it blind.

---

## Step 1 — Get it on disk and install

```bash
cd ~/projects                       # or wherever you keep things
# copy the job-agent folder here, then:
cd job-agent
npm install
```

That pulls five packages. `better-sqlite3` compiles natively, so if it fails you need Xcode command line tools on a Mac:

```bash
xcode-select --install
```

You also need LibreOffice for PDF conversion and poppler for the page count check:

```bash
# macOS
brew install --cask libreoffice
brew install poppler

# Ubuntu / WSL
sudo apt install libreoffice-writer poppler-utils
```

Verify:

```bash
soffice --version
pdfinfo -v
python3 -c "import openpyxl; print('openpyxl ok')"
```

If `python3` lacks openpyxl: `pip3 install openpyxl`.

---

## Step 2 — Baseline resume as plain text

The tailoring step reads your master CV as text and is forbidden from adding anything not in it. This file is therefore the single most important input in the system. Anything missing here can never appear on a tailored resume.

```bash
# from your master docx
soffice --headless --convert-to txt --outdir config /path/to/MJarvis_CV_2026.docx
mv config/MJarvis_CV_2026.txt config/baseline_cv.txt
```

Then open `config/baseline_cv.txt` and read it. Add anything the docx does not carry but that you want available for tailoring:

- Certifications (AIRS CIR, CDR, CTR, PRC; McCombs AI on the Cloud)
- The personal builds (Candidate Reply Copilot, autonomous inbox agent, VegasVirtual)
- Workforce planning specifics: the ELT partnership, learning tracks, Makati and Guadalajara
- DoD SkillBridge, First Command military hiring, the PDX military program
- Early career: PDX internship program, 80 percent plus intern-to-hire, high school engineering pipeline
- Legal talent depth: three years recruiting attorneys at Litera
- Full tool list: Workday, Greenhouse, iCIMS, LinkedIn Recruiter, SeekOut, Juicebox, Gem, HiredScore, HireQuotient, Sniper AI

Spend real time here. This file is the ceiling on output quality.

---

## Step 3 — API keys

```bash
cp .env.example .env
```

**Anthropic** — console.anthropic.com, API keys, create key. Paste into `ANTHROPIC_API_KEY`.

Cost estimate: scoring runs roughly a cent per posting; a full package (resume plan, audit, cover letter, research, email) runs 30 to 60 cents. A day that surfaces 200 postings and packages 3 lands around $4. Set a monthly limit in the console.

**Hunter.io** — hunter.io, sign up, dashboard, API. Free tier gives 25 verifications a month, which covers this volume. Paste into `HUNTER_API_KEY`.

Leave `SERPAPI_KEY` blank for now. Add it later only if the ATS watchlist is not giving enough coverage.

---

## Step 4 — Azure app registration for Outlook drafts

This is the only tedious part. Do it once.

1. Go to **portal.azure.com**, sign in with your personal Microsoft account (`michael.t.jarvis@outlook.com`).
2. Search **App registrations**, click **New registration**.
3. Name: `Job Agent`.
4. Supported account types: **Personal Microsoft accounts only**.
5. Redirect URI: select **Web**, enter `http://localhost:3000/callback`.
6. **Register**.
7. From the Overview page, copy **Application (client) ID** into `MS_CLIENT_ID` in `.env`. Set `MS_TENANT_ID=consumers`.
8. Left menu, **Certificates & secrets**, **New client secret**, 24 months, **Add**. Copy the **Value** column immediately (it is only shown once) into `MS_CLIENT_SECRET`.
9. Left menu, **API permissions**, **Add a permission**, **Microsoft Graph**, **Delegated permissions**. Add `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`. Click **Add permissions**.

Then get a refresh token:

```bash
node scripts/ms-auth.js
```

It prints a URL. Open it, sign in, approve. It captures the callback and prints a line to add to `.env`:

```
MS_REFRESH_TOKEN=0.AXoA...
```

Test:

```bash
node -e "import('./src/outlook.js').then(async m => {
  const d = await m.createDraft({
    to: process.env.MS_USER,
    subject: 'Job agent test',
    body: 'If you can read this in Drafts, Graph is wired.'
  });
  console.log('draft created:', d.id);
})"
```

Check your Outlook Drafts folder. If it is there, this step is done.

---

## Step 5 — Seed the dedupe store

So the agent never hands you a folder for something you already worked.

```bash
node scripts/seed-tracker.js ~/Downloads/MJarvis_Master_Job_Tracker_2026.xlsx
```

Expect `seeded 122 rows`. Re-run this any time you add rows to the tracker.

---

## Step 6 — Build the company watchlist

This is the highest-leverage step and the one that determines whether the agent is useful or noisy. You are building a list of companies you would actually work for, then finding each one's ATS token.

**Finding a token.** Go to a company's careers page and click any job. The URL tells you both the ATS and the token:

| URL you see | ATS | Token |
|---|---|---|
| `job-boards.greenhouse.io/ramp/jobs/123` | greenhouse | `ramp` |
| `boards.greenhouse.io/anthropic/jobs/456` | greenhouse | `anthropic` |
| `jobs.lever.co/fluidstack/abc-123` | lever | `fluidstack` |
| `jobs.ashbyhq.com/gen-digital/xyz` | ashby | `gen-digital` |
| `xyz.wd1.myworkdayjobs.com/Careers` | workday | see below |

Verify before adding:

```bash
node scripts/check-token.js greenhouse ramp
node scripts/check-token.js all cotality      # try every ATS if unsure
```

It prints the count and a few titles. If you get zero or an error, the token is wrong.

Then add to `config/companies.json`:

```json
{
  "greenhouse": ["ramp", "anthropic", "vanta", "cresta", "engine"],
  "lever": ["fluidstack"],
  "ashby": ["gen-digital", "brighthire"],
  "workday": [
    { "host": "sec.wd3.myworkdayjobs.com", "tenant": "sec", "site": "Samsung_Careers" }
  ]
}
```

Workday needs three parts pulled out of the URL `https://sec.wd3.myworkdayjobs.com/Samsung_Careers`: host is `sec.wd3.myworkdayjobs.com`, tenant is `sec`, site is `Samsung_Careers`.

**Target 150 to 250 companies.** Build the list from: your current pipeline, every company already in the tracker, the AI-native tier (Anthropic, OpenAI, Scale, Ramp, Cresta, Sierra, Harvey), legal and healthcare tech (your two domains), DFW and Austin employers, and PE-backed scaleups. An hour of list-building here beats any amount of broad crawling.

---

## Step 7 — Test in stages

Do not run the full pipeline first. Four escalating runs:

**7a. Discovery and gates only.** No API cost.

```bash
node src/pipeline.js --dry
```

You should see discovery counts and a sample of what cleared the hard gates. Read that sample carefully. If junk is getting through, or something obviously good is being filtered, tune `config/profile.json`:

- Too many junk titles → add patterns to `excludeTitlePatterns`
- Good roles filtered out → loosen `minSeniority`
- Comp filtering too aggressively → check `parseCompBand` against a posting that got wrongly rejected

Iterate here until the sample looks right. It costs nothing.

**7b. Add LLM scoring.** Small cost.

```bash
node src/pipeline.js --score-only
```

Prints each role with a score and a one-line rationale. Sanity-check ten of them against your own judgment. If scores run high across the board, raise `PURSUE_THRESHOLD` in `.env` from 70 to 75 or 80. If the model is being too generous about your gaps, tighten the `notHeld` block in `config/profile.json`.

**7c. Build one folder, no Outlook.**

```bash
node src/pipeline.js --once --limit=1 --no-outlook
```

Open `output/<date>_<company>_<role>/` and inspect everything:

- Read `00_BRIEF.md` first. Does the scope, comp, and location read correctly?
- Open the resume PDF. Is it two pages? Does it look like your other builds? Any invented claims?
- Read the cover letter. Does it sound like you?
- Check `01_CONTACT.md`. Is the hiring manager plausible, and is the evidence real?
- Read `02_EMAIL.md`. Would you actually send it?

This is the moment to tune prompts. If the resume voice is off, edit `PLAN_PROMPT` in `src/tailor.js`. If the email is too eager, edit `EMAIL_PROMPT` in `src/contact.js`. Re-run and compare.

**7d. Full run.**

```bash
node src/pipeline.js --once --limit=3
```

Confirm three folders built and three drafts landed in Outlook.

---

## Step 8 — Schedule it

Once a full run looks right, put it on a timer.

**macOS or Linux, cron:**

```bash
crontab -e
# add:
0 6 * * * cd ~/projects/job-agent && /usr/local/bin/node src/pipeline.js --once >> logs/agent.log 2>&1
```

```bash
mkdir -p logs
which node    # use this absolute path in the crontab line
```

**Or keep the process resident:**

```bash
node src/pipeline.js --schedule
```

Runs at 06:00 America/Chicago. Fine on a machine that stays on; cron survives reboots, which is why it is the better default.

---

## Step 9 — The daily loop

Each morning:

1. Open `output/INDEX_<today>.md`. One table, sorted by fit.
2. For anything above 75, open the folder and read `00_BRIEF.md`.
3. Check the **Before you send** section. Anything marked BLOCKED means the audit caught a possible fabrication; fix it before the document goes anywhere.
4. Verify the email address in `01_CONTACT.md` if it is marked `guess`.
5. Send the Outlook draft.
6. Submit the application at the posting link yourself.
7. Add a row to the tracker, then re-run `seed-tracker.js`.

Expect roughly two to five folders on a normal day from a 200-company watchlist. If you are getting twenty, raise the threshold. If you are getting zero for a week, the watchlist is too small or the gates are too tight.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find package 'docx'` | install did not complete | `npm install` again |
| Greenhouse returns garbled descriptions | base64 decode path | in `src/sources/ats.js`, swap the `atob` line for `Buffer.from(j.content,'base64').toString('utf8')` |
| `token: 400 invalid_grant` | refresh token expired | re-run `node scripts/ms-auth.js` |
| Resume renders three pages | plan too long | tighten `PLAN_PROMPT` to cap bullets per role at five |
| Dash warning in the log | model slipped one through | the renderer strips them; the warning means the guard worked |
| Hiring manager always "not established" | research call is being conservative | this is correct behavior, better than a fabricated name |
| Same role appears twice | different location strings | fingerprint uses the first 20 chars of location; loosen in `src/store.js` |
| Zero postings from a token | wrong token or board moved | `node scripts/check-token.js all <token>` |

---

## Where to extend it next

In rough order of value:

1. **Aggregator source** for coverage past named companies. SerpApi Google Jobs, roughly $50 a month.
2. **Auto-append to the tracker** rather than manual entry, using openpyxl the same way `seed-tracker.js` reads it.
3. **Follow-up timer.** Nothing currently reminds you at day seven on a sent email. A second cron reading `state='packaged'` with a sent flag would close that loop.
4. **Reply detection.** You already have an autonomous inbox agent; wiring it to flag replies from addresses the job agent wrote to would give you a real closed-loop system.
