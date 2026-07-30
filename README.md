# CCP Search Ledger

The ATS/CRM, running on your own domain instead of inside Claude.

## What changed and why

Two things worked in the Claude artifact only because Claude supplied them:

| Artifact behaviour | Replacement here |
|---|---|
| `window.storage` for saving records | Supabase Postgres, via `src/storage.js` |
| Anthropic API calls with no key | Netlify function holding your key, via `src/anthropic-shim.js` |

Both are shims with the same shape as the originals, so **`src/ccp-ats.jsx` is byte-for-byte the artifact file.** When you want to change the app, edit that one file.

---

## Setup, about 30 minutes

### 1. Supabase (database and sign-in)

1. Create a free project at supabase.com.
2. SQL Editor, paste `supabase-schema.sql`, run it.
3. Authentication > Providers > Email: turn on **Email**, turn **off** "Allow new users to sign up".
4. Authentication > Users > Invite: add yourself and your recruiter.
5. Project Settings > API: copy the **Project URL** and the **anon public** key.

### 2. Anthropic key

1. console.anthropic.com > API Keys > Create key.
2. Set a monthly spend limit while you are there. CV parsing is cheap, but cap it anyway.

### 3. Local run

```bash
npm install
cp .env.example .env
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

CV parsing will not work locally until you run `netlify dev` instead of `npm run dev`,
because it needs the function. Install the CLI with `npm i -g netlify-cli`.

### 4. Deploy

1. Push this folder to a private GitHub repo.
2. netlify.com > Add new site > Import from Git. Build settings come from `netlify.toml`.
3. Site settings > Environment variables, add all five:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | your project URL |
| `VITE_SUPABASE_ANON_KEY` | your anon key |
| `SUPABASE_URL` | same project URL |
| `SUPABASE_ANON_KEY` | same anon key |
| `ANTHROPIC_API_KEY` | your Anthropic key |

4. Deploy. Then Domain management > add `ats.careercapitalpartners.com`.

---

## Running costs

| Service | Cost |
|---|---|
| Netlify | Free tier covers this |
| Supabase | Free to 500MB, then $25/mo |
| Anthropic | Roughly 2 to 4 cents per CV parsed |

Two people and a few hundred candidates sits inside the free tiers apart from CV parsing.

---

## Things to know

- **The `anon` key is meant to be public.** Row level security is what protects the data, which is why step 1.3 matters. If you leave open sign-up on, anyone with the URL can create an account and read your pipeline.
- **The Anthropic key must never go in a `VITE_` variable.** Vite inlines those into the JavaScript bundle that ships to the browser.
- **CV files live in the database as base64.** Fine at this scale. If you pass a few thousand candidates, move them to Supabase Storage and keep only the file path in the record.
- **No backups by default.** Supabase free tier has none. Run the CSV export monthly, or upgrade to Pro for daily point-in-time recovery.

---

## Migrating what is already in the artifact

The artifact and this app do not share a database. To carry records over:

1. In the artifact, Candidates tab, clear all filters, click **CSV**.
2. In the new app, Candidates tab, **Paste a list** for the names, then re-drop the CVs.

Faster for anything more than about 30 records: open the artifact's browser console,
run `await window.storage.get('ccp-ats-core-v1', true)`, copy the value, and insert it
into `ccp_kv` under the same key in Supabase. Resume text and CV files are stored under
`ccp-resume:` and `ccp-cv-file:` keys and would need the same treatment one by one.
