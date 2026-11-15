# End-to-end checks against the live site

This folder holds a Playwright suite that uses the **live** site the way a person would. It
signs two fixed test people in to the App (app.tejido.net) and a third, a visitor, in to the Campaign Site, all through real Qatom, walks the App and
the Campaign Site (tejido.net), talks to the App's assistant, and keeps a screenshot of every
step at phone size (390 px wide) and desktop size (1280 px wide).

It is separate from the four checks. `npm test` never runs it, and it needs things the four
checks must never need: the network, a mailbox, and three real Qatom accounts.

> **Where it stands.** Unpaid runs are green against the live site, and a real work log has
> been filed for a real deposit and found on the public timeline. The milestone claim and the
> confirmation are written and have not run yet. "The story, and what is checked" below shows
> what the suite covers and what it does not.

## What it does

| Spec                     | What it does                                                                                                                                                                                                                                                                                                     | Runs                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `create-campaign`        | **Paid runs only.** Creates the campaign the run files on, through the campaign API, with the two test people invited at their test addresses. Writes one draft campaign to the live database.                                                                                                                   | Once per paid run                            |
| `sign-in`                | Opens each test person's invite, presses Sign in with Qatom, types their email on Qatom's page, reads the emailed code from the inbox, and lands back in the App signed in. Saves that signed-in browser for the other specs.                                                                                    | Once per person per run                      |
| `app-walk`               | Signed in. Home, Add evidence (uploads one small picture for real, then opens it signed out and checks its fingerprint), a file kept from donors, the fix page in whichever state it is in, a reminder's link, and the chat as it opens. Then the confirmer's home and chat.                                     | Phone and desktop                            |
| `app-evidence`           | Signed in. A PDF uploads and opens for anyone; the same file twice is left out; "Copy for your report" copies it; a too-big file and a text file are refused in plain words without being sent.                                                                                                                  | Phone and desktop                            |
| `chat-milestone`         | Signed in. From the reminder page to the chat for one milestone, which the chat names. A link naming a milestone that is not theirs shows nothing of it. Sends nothing, so no model is called.                                                                                                                   | Phone and desktop                            |
| `chat-form`              | Signed in. The report form in the chat: what it offers and what it refuses, on both screens with no model. Then, on the phone on unpaid runs, one form sent: the review card comes back with its values. Files nothing.                                                                                          | Phone and desktop                            |
| `chat-draft`             | Signed in. One conversation with the assistant: says what was done, attaches the picture, asks for the review, and checks the review card and its two buttons appear. Files nothing.                                                                                                                             | Phone only, unpaid runs                      |
| `paid-filing`            | **The paid story: the one place a test moves money.** As the contractor, a work log (0.10) and a milestone reported done (1.00); as the confirmer, its confirmation (1.00). Each through the chat and its review card, each then found on the campaign's public pages.                                           | Paid runs only, on the phone                 |
| `app-signed-out`         | The App with nobody signed in: home, both invitations, an invitation that does not exist, the pages that need a signed-in person saying so, and a reminder's link.                                                                                                                                               | Phone and desktop                            |
| `site-walk`              | Signed out, as a donor. The campaign's overview, a proof page (once the campaign has an entry), the milestones and one milestone's page, and the delivery report.                                                                                                                                                | Phone and desktop                            |
| `site-walk-langs`        | Signed out, as a donor reading in Spanish, French or Portuguese. The campaign's overview, milestones, one milestone and report open, with everything around them in that language. Their own words are in English only today.                                                                                    | Phone and desktop                            |
| `site-pages`             | Signed out. Home, Explore, Give and About in Spanish, English, French and Portuguese; Spanish for a browser that asks for none of them; the language buttons; the home page's links; a missing campaign; where Sign in leads (Qatom).                                                                            | Phone and desktop                            |
| `site-pages-depth`       | Signed out. In the four languages: the "how it works" steps, About's questions and answers, "More ways to help", Explore's search and status buttons, the failed sign-in page. Explore's filters, used. The backend's explainer pages.                                                                           | Phone and desktop                            |
| `site-frame`             | Signed out. The header and its language menu (desktop), the tab bar and the menu (phone) and the footer's links, named in the four languages. Then the language is changed from them and each page is reached from them.                                                                                         | Phone and desktop                            |
| `site-header-signed-out` | Signed out. The Campaign Site's header in the four languages: it offers Sign in and never "Start a campaign", in the bar or in the menu.                                                                                                                                                                         | Phone and desktop                            |
| `campaign-builder`       | Signed out. The builder's first step: what is missing, then on to the second step and back. The campaign API's check. Never creates a campaign.                                                                                                                                                                  | Phone and desktop                            |
| `site-give`              | Signed out, as a donor, without paying. A campaign that is not raising money offers no way to give. One that is leads to its Give page, which lists the amounts on sale or says giving is not available. Pressing an amount arrives at Qatom's checkout page (`checkout.m.todaq.net`); nothing there is pressed. | Phone and desktop; the press on desktop only |
| `site-sign-in`           | The third test person, a visitor, presses Sign in on the Campaign Site, signs in through Qatom with an emailed code, and comes back to the page they left, shown as signed in. Saves that signed-in browser for `site-signed-in`.                                                                                | Once per run, on a phone                     |
| `site-signed-in`         | As that visitor. "Start a campaign" in the header bar or its menu, by width and language. The campaign builder's six steps: what each asks for, what it says when the answer is missing, and Back keeping every answer. Signing out. **Never presses "Create campaign"** unless `E2E_CREATE_CAMPAIGN=true`.      | Phone and desktop                            |

The nine signed-out specs type nothing into Qatom, call no model and write nothing, so they
run on every run.

The contractor signs in on the phone-sized screen and the confirmer on the desktop-sized one, so
Qatom's pages are photographed at both sizes with one code each.

The visitor signs in on the phone-sized screen, where the Campaign Site's Sign in and the
person's email are inside the menu. The visitor's sign-in and what follows it are two
Playwright projects of their own (`site-sign-in`, then `site-signed-in`). If that sign-in
fails, only `site-signed-in` is skipped; the App's checks and the signed-out ones still run,
and the other way round.

**On a paid run the two test people sign in from the invitations of the campaign that run
created**, and every signed-in check and the donor's walk use that campaign in place of the
fixed test campaign `e2e-smoke`. It has the same three milestones and the same two people, so
the checks apply unchanged. An unpaid run always uses `e2e-smoke`.

## The story, and what is checked

The product's story, step by step, against what this suite checks on the live site. The last
column is the gaps, each with its reason.

| Step of the story                                                            | Checked on every unpaid run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Not checked, and why                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A creator builds a campaign at `/campaigns/new`                              | Signed out: the builder opens; an empty first step lists what is missing; a filled one moves to the second step. Signed in: all six steps, what each asks for and says when its answer is missing, the review showing every answer, and Back keeping every answer from the last step to the first                                                                                                                                                                                                                               | Pressing "Create campaign" in the builder: it writes a draft to the live database that is never removed. Built, and off: it runs only with `E2E_CREATE_CAMPAIGN=true`, which nothing sets. More than one milestone or person, reordering and removing them; the daily and chosen-days schedules |
| The campaign API (`docs/campaign-api.md`)                                    | `POST /api/campaigns/check`: a complete campaign passes, an empty one is told what is missing, one step can be checked alone, a wrong step is refused. On a paid run, `POST /api/campaigns` creates the run's own campaign and its two invitations open                                                                                                                                                                                                                                                                         | Creating on an unpaid run: it writes to the live database                                                                                                                                                                                                                                       |
| A contractor accepts an invitation and signs in                              | The invite page, Qatom's email and code pages, the emailed code, the offer to add funds skipped, back in the App signed in, both wallets linked                                                                                                                                                                                                                                                                                                                                                                                 | Nothing                                                                                                                                                                                                                                                                                         |
| Reports work in the chat                                                     | One real conversation with the assistant as far as its review card and its two buttons (phone). The report form: what it offers and refuses, and one work log sent from it, shown back on the review card (phone). The chat opened for one milestone, from the reminder page, names it. The fix page in whichever state it is in: nothing to fix, one incomplete report open, or several to choose from                                                                                                                         | The form for a milestone claim or a confirmation is opened, not sent. Completing an incomplete report on the fix page: saving changes the report for good, and the one incomplete report `e2e-smoke` has cannot be completed (see below)                                                        |
| Adds evidence                                                                | A picture uploads from the evidence page and from the chat; the file then opens for anyone, signed out, and its bytes match the fingerprint in its address. A second picture is kept from donors: it is refused with nobody signed in, opens for its uploader and for the project's confirmer, and the public picture stays public                                                                                                                                                                                              | A signed-in person who is neither the uploader nor a confirmer being refused: no test person is in that position                                                                                                                                                                                |
| Adds a PDF, or a file the App does not take                                  | A PDF uploads and opens for anyone, bytes matching the fingerprint; chosen twice, it is left out; "Copy for your report" copies it. A file that is too big or of the wrong kind is refused in the page in plain words, and never sent                                                                                                                                                                                                                                                                                           | A too-big file sent straight to the server: that would push 10 MB at the live site on every run                                                                                                                                                                                                 |
| Files a work log (a real deposit)                                            | Nothing on an unpaid run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | On a paid run: the contractor files a work log on the run's own campaign, it is found on the public timeline by its reference, its proof page opens, and it is not marked incomplete                                                                                                            |
| The contractor reports a milestone done                                      | Nothing on an unpaid run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | On a paid run: filed with a photo, found on the timeline, and the milestone's public page says "Claimed complete". Written, not yet run                                                                                                                                                         |
| The confirmer confirms the milestone                                         | The confirmer signs in, sees the milestones they confirm, and the chat opens for them                                                                                                                                                                                                                                                                                                                                                                                                                                           | On a paid run: filed, found on the timeline, and the milestone's public page says "Confirmed". Written, not yet run                                                                                                                                                                             |
| The reconciler verifies it                                                   | Nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | The reconciler now runs by itself and reads every campaign, so an entry's receipt may read "pending" or verified. No check expects either word, and none waits for a receipt yet: one verified receipt is to be seen live first                                                                 |
| The deposit is refunded                                                      | Nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Nothing is refunded yet. The suite never calls `/api/refunds`; when the backend refunds by itself, the story will wait to see "deposit returned" on the pages                                                                                                                                   |
| A donor gives to a campaign                                                  | A campaign that is not raising money shows no "Give to this campaign", and its Give page says so and offers no amount. A missing campaign's Give page is "not found". When a campaign is raising money: its page's button leads to its Give page, which lists each amount once, smallest first, or says giving is not available. When amounts are on sale: pressing the smallest arrives at Qatom's checkout page. Each of these last two is skipped, saying why, while no campaign is raising money or no donation item exists | Paying a donation, and the campaign's total going up afterwards: nobody has decided who would pay it. `POST /api/donations` is never called by the suite: it needs the secret. The Give page in Spanish, French and Portuguese                                                                  |
| A donor reads the campaign page, a proof page, the milestones and the report | The overview with its three tabs and "Who’s involved"; the milestones list and one milestone's page; the delivery report. The proof page once the campaign has an entry                                                                                                                                                                                                                                                                                                                                                         | An overdue or flagged report: the test campaigns have none                                                                                                                                                                                                                                      |
| A donor reads the campaign's pages in Spanish, French or Portuguese          | The overview, the milestones, one milestone and the report open; each is marked as that language; the header or tab bar and the footer are in it; a main heading is there; no translation's name is shown in place of words                                                                                                                                                                                                                                                                                                     | The pages' own words in that language: they are written in English only, so there is no translation to check. Told to the owner                                                                                                                                                                 |
| Home, Explore, Give and About in four languages                              | Each page's title and main heading in Spanish, English, French and Portuguese; Spanish by default; the language buttons; the choice remembered on the next page                                                                                                                                                                                                                                                                                                                                                                 | The rest of each page: see the next row                                                                                                                                                                                                                                                         |
| The rest of home, Explore, Give and About, in four languages                 | The "how it works" steps; About's six questions, each answer shown when its question is opened; "More ways to help" and its two tiles; Explore's search box, status buttons and count; no translation's name shown in place of words                                                                                                                                                                                                                                                                                            | Each campaign card's wording: it depends on what is listed. Home's four tiles in Spanish, French and Portuguese (their English is checked)                                                                                                                                                      |
| Explore narrows what is listed                                               | Each status button lists only campaigns with that status, and the five lists add up to all of them; words no campaign has list none, and the page says so; a campaign is found by its title; "Clear filters" brings all back                                                                                                                                                                                                                                                                                                    | A status known to have a campaign in it: the checks hold whatever is listed, so while few campaigns are live most statuses list none                                                                                                                                                            |
| The header, its language menu, the phone's tab bar and menu, the footer      | Named in the four languages. Desktop: the header's links, and its language menu opened, closed and used. Phone: the four tabs, the menu's links and its language buttons, used. The footer's links. Changing language keeps the page                                                                                                                                                                                                                                                                                            | Nothing                                                                                                                                                                                                                                                                                         |
| A person signs in on the Campaign Site                                       | Signed out, "Sign in" leads to Qatom's own sign-in page. A third test person then signs in there with an emailed code, comes back to the page they left, and the header shows their email and Sign out. Sign out ends the session in that browser: Sign in is back, and it stays so after a reload                                                                                                                                                                                                                              | Whether a copy of the session cookie taken before signing out still works. By the code it does until it expires (a week): the site keeps no list of sessions                                                                                                                                    |
| A signed-in person is offered "Start a campaign" in the header               | In the bar at 1280 px in Spanish, English and Portuguese; in the menu at 390 px in all four languages and at every width in French (1280 and 1920 px); it moves from the menu to the bar between 1199 and 1200 px; it leads to the builder. Signed out, it is nowhere in the header in any language                                                                                                                                                                                                                             | Widths between 390 and 1199 px other than 1199                                                                                                                                                                                                                                                  |
| A sign-in on the Campaign Site that does not finish (`/auth/problem`)        | The page's title, heading, explanation and its "Try again" link in the four languages, opened directly                                                                                                                                                                                                                                                                                                                                                                                                                          | Arriving there from a sign-in that really failed, and pressing "Try again": both start a sign-in at Qatom                                                                                                                                                                                       |
| A reminder's link (`/reminder`)                                              | Signed out: it says a report is due, names neither the project nor the person, and its sign-in comes back to it. Signed in as the contractor: it says what is due and leads to the chat; a link about someone else's milestone says so                                                                                                                                                                                                                                                                                          | The reminder message itself (the scheduler sends none yet), and the confirmer's reminder with something to confirm                                                                                                                                                                              |
| The backend's explainer pages (`/backend/...`)                               | All five open and say which part of the backend they describe, what it does, and that nothing is built there yet                                                                                                                                                                                                                                                                                                                                                                                                                | Nothing. The addresses under `/api/` that do the work are never called: see the next row                                                                                                                                                                                                        |
| The scheduler's, the refunds' and the reconciler's own addresses             | Nothing, on purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | They act on live data or money when called. The suite never calls them, not even to see them refuse                                                                                                                                                                                             |

Signing out of the App is offered on the home page and is deliberately not pressed: it also
ends the assistant's access to Qatom for that person, for every later check.

**`e2e-smoke`'s one incomplete report.** The first paid filing (run 31) put a photo on a
work log for "Test milestone 1: work". That milestone is a service, which takes documents only,
so Tejido saved the report as incomplete. The fix page can only add files, never take one away,
so that report stays incomplete for good, and the contractor's fix page will always show it.
The suite now files on "Test milestone 3: a build", which takes photos, and a paid filing that
lands incomplete fails saying so.

## What it costs

- **Every run that signs in:** two conversations with the model behind the App's assistant
  (the draft, three or four replies; the report form, one or two), three small files in the
  evidence store (a picture, a picture kept from donors and a PDF of about 500 bytes; the same
  bytes each time, so each is stored once), and three sign-in emails.
- **Every run, once the donation items exist and a campaign is raising money:** one checkout
  made at Qatom and never paid, on the desktop screen only. Nothing is charged and nothing is
  recorded on Tejido; what Qatom keeps of an unpaid checkout is Qatom's to say.
- **A paid run, as well:**
  - 2.10 in deposits: 1.10 from the test contractor's Qatom agent wallet (a work log, 0.10, and
    a milestone claim, 1.00) and 1.00 from the test confirmer's (the confirmation). Nothing is
    refunded yet, so the two agent wallets run down and a person tops them up.
  - one draft campaign in the live database, with its two people, three milestones and three
    entries, titled "Automatic test, run N (not a real fundraiser)". It is on no public list
    and nothing can remove it yet.
  - one more small picture in the evidence store: the picture kept from donors is made
    different for each campaign's contractor, because who may open such a file is recorded for
    whoever uploaded those bytes first.
- **Only with `E2E_CREATE_CAMPAIGN=true`, which nothing sets:** one more draft campaign, made
  through the builder's last button, with two people and one milestone, all named as a test.

**Which runs are paid.** By the owner's decision of 15 November 2026 the paid story runs by
itself after a release, never started by hand, under the cap set in
`.github/workflows/e2e.yml` (see CLAUDE.md, "Never move money to test something"). Only that
workflow sets `E2E_PAID`.

## What a person sets up once, in this order

1. **Apply the Qatom infrastructure change that creates the inbox.** It receives mail for one
   domain (`e2e.m.todaq.net`), puts each message on a queue, and creates a role that this
   repository's `main` branch may assume to read that queue.
2. **Set three repository variables** from that change's outputs, under Settings → Secrets and
   variables → Actions → **Variables** (not Secrets; none of these is secret):

   | Variable              | What it is                                 |
   | --------------------- | ------------------------------------------ |
   | `E2E_INBOX_QUEUE_URL` | The address of the queue the mail lands on |
   | `E2E_INBOX_DOMAIN`    | The mail domain: `e2e.m.todaq.net`         |
   | `E2E_AWS_ROLE_ARN`    | The role the workflow assumes to read it   |

   Until all three are set, the workflow ends at its first step with a notice and a green tick.

3. **Load the test campaign into the live database.** Print it as SQL. Keep `--silent`: without
   it npm writes two lines of its own at the top of the file, and the database refuses the file
   with `near ">": syntax error`.

   ```bash
   npm run --silent db:seed:e2e:sql -- --inbox-domain e2e.m.todaq.net > e2e-fixture.sql
   ```

   Then load it, from the repository root, with your Cloudflare token and account id in the
   shell as for a deploy. A person runs these, never an agent. The first command writes a copy
   of the Campaign Site's Wrangler settings with the live database's id in place of the
   placeholder, as `infra/deploy.sh` does; `npx wrangler d1 list` shows the id of `tejido`. The
   copy is ignored by git.

   ```bash
   sed "s/00000000-0000-0000-0000-000000000000/<the id of tejido>/" apps/web/wrangler.jsonc > apps/web/wrangler.deploy.jsonc
   ```

   ```bash
   npx wrangler d1 execute tejido --remote --yes --file e2e-fixture.sql --config apps/web/wrangler.deploy.jsonc
   ```

   ```bash
   rm e2e-fixture.sql
   ```

   The file holds two new reporter codes, which are private: that is why it is deleted, and it
   must never be committed. If the load fails, nothing is changed and it is safe to run again.
   Loading it twice is safe too; nothing already there is changed.

   It creates the campaign `e2e-smoke`, titled "Automated test campaign (not a real
   fundraiser)", the parties `e2e-contractor` and `e2e-confirmer` (invited at
   `e2e-contractor@…` and `e2e-confirmer@…` on the inbox domain), and three open milestones.

4. **Run the suite once, unpaid** (Actions → End-to-end → Run workflow, on `main`). This first
   sign-in of each test person is what creates their Qatom accounts and wallets and links them
   to the two parties.
5. **In Qatom, as each of the two test people:** add funds to their **agent** wallet and set
   its auto-approve limit to at least 1.00, so a filing is paid without a person approving it.
   A paid run takes 1.10 from the contractor's and 1.00 from the confirmer's. To sign in as
   either yourself you need their emailed code; ask whoever runs the inbox how to read one
   message.

No catalog items are made for the test campaigns: every campaign files through the same two
shared items on Tejido's Qatom account.

## The paid story

Three filings, in order, each through the App's chat and its review card as a real person
files, each on the campaign that run created:

1. the contractor files a work log on "Test milestone 3: a build" (0.10);
2. the contractor reports that milestone done, with a photo (1.00);
3. the confirmer confirms it (1.00).

After each, the entry is found on the campaign's public timeline by a reference the suite puts
in its note, its proof page is opened, and it must not be marked incomplete. After the claim
the milestone's public page must say "Claimed complete"; after the confirmation, "Confirmed".
The steps stop at the first that does not pass. No step is ever retried.

The milestone is named on purpose: the first test milestone is a service, which takes
documents only, and a photo on it makes the report incomplete.

**What it needs, kept up by a person:** funds in both test people's **agent** wallets (not
their primary ones) and an auto-approve limit of at least 1.00 on each. Qatom's limit is empty
by default, and then every payment waits for an approval nobody gives.

**What it does not do:** it names no tool to the assistant, it never calls `transfer` or
`/api/refunds`, it holds no secret, and it waits for neither a verified receipt nor a refund:
an entry's receipt may read "pending" or verified, and no check expects either.

If a step fails, the failure says which of these happened. **Read the assistant's last message
in the failure first**: it is the only account of what Qatom or Tejido answered, and it can say
more than the heading does. For example, "THE DEPOSIT MAY HAVE BEEN PAID" is the cautious
heading whenever the filing was sent and no entry appeared, even when the assistant goes on to
say the filing was turned down before any payment was taken.

| The run says                                                        | What it means                                                                                                                                                                           | What to do                                                         |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A yellow notice, "TOP UP NEEDED" (the step is skipped, not failed)  | The assistant did not file and speaks of the wallet's funds. Nothing was paid. This leans on the assistant's wording: neither the suite nor the App's pages can read a wallet's balance | Add funds to that person's agent wallet                            |
| "... WAS FILED AND ITS DEPOSIT PAID, BUT THE APP DID NOT SAY SO"    | The entry is on the public timeline, so the deposit was paid, but the App's chat drew no "Submitted" line for it. A fault in the App: it knows a filing only by its tool's name         | Do not file again. Fix the App                                     |
| "NOTHING WAS FILED, as far as the App and the public timeline show" | The chat drew no filing and the entry is not on the timeline. No deposit shows as paid                                                                                                  | Read the assistant's last message for why                          |
| "THE FILING IS WAITING FOR AN APPROVAL IN QATOM"                    | A payment is waiting for the person's approval. Not paid, but approving it later would pay it and file the entry.                                                                       | Raise the auto-approve limit. Leave the waiting payment unapproved |
| "THE DEPOSIT MAY HAVE BEEN PAID"                                    | The filing was sent and the entry is not on the public timeline.                                                                                                                        | Look at the run's campaign page and the wallet                     |
| "IT IS NOT KNOWN WHETHER THE FILING WENT THROUGH"                   | The page lost touch mid-filing, or the wait itself failed.                                                                                                                              | Look at the run's campaign page and the wallet                     |
| "... saved it as INCOMPLETE"                                        | Filed and paid, but something the milestone needs is missing or not allowed. The public page's own words are quoted.                                                                    | Read what the page says is missing                                 |

The address of the run's own campaign is printed in the log by `create-campaign`.

## What donors see

The test campaign is a **draft**, and the Campaign Site's home page leaves drafts out, so it is
not listed. It is not hidden: anyone who has the address `tejido.net/campaigns/e2e-smoke` can
open it. Its title, summary and party names all say it is an automated test, and it has no
donation item, so its funding reads "not known" and nobody can give to it through Tejido.

## How to run it

**On GitHub (the normal way).** It runs by itself after each successful release of `main`. To
run it by hand: Actions → End-to-end → Run workflow. Leave the branch on `main` (the inbox role
trusts no other branch). Whether a run tells the paid story is decided by the workflow's cap, not by a person.

**On your own computer.** You need AWS credentials that may read the queue, and Chromium
(`npx playwright install chromium`, once). Set these, then run `npm run e2e`:

| Variable                  | Value                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `E2E_INBOX_QUEUE_URL`     | As above                                                                                                       |
| `E2E_INBOX_DOMAIN`        | `e2e.m.todaq.net`                                                                                              |
| `E2E_INBOX_REGION`        | `ca-central-1`                                                                                                 |
| `E2E_QATOM_HOST`          | `pay.m.todaq.net`: the only host an email or a code is typed into                                              |
| `E2E_CAMPAIGN_ID`         | `e2e-smoke`                                                                                                    |
| `E2E_CONTRACTOR_PARTY_ID` | `e2e-contractor`                                                                                               |
| `E2E_CONFIRMER_PARTY_ID`  | `e2e-confirmer`                                                                                                |
| `E2E_PAID`                | Leave unset. Exactly `true` tells the paid story: only the workflow sets it                                    |
| `E2E_SKIP_SIGN_IN`        | Leave unset. Exactly `true` asks Qatom for no code: see below                                                  |
| `E2E_CREATE_CAMPAIGN`     | Leave unset. Exactly `true` creates a draft campaign: see below                                                |
| `E2E_RUN_LABEL`           | Optional. What a paid run is called in the title of the campaign it creates; the workflow gives its run number |

`E2E_APP_URL` and `E2E_SITE_URL` default to the live site. Any other address is refused unless
`E2E_ALLOW_OTHER_HOSTS=true`, and a paid run is refused anywhere but the live site. If a value
is missing the suite stops before opening a page and names it.

`npm run e2e:list` lists the tests without running anything, and needs nothing set.

**A run that does not sign in.** With `E2E_SKIP_SIGN_IN=true` the suite asks Qatom for no
sign-in code. The sign-in and every check that needs a signed-in person are skipped, each
saying why, and the signed-out checks (the Campaign Site as a donor) run as usual. It is for
when runs come closer together than Qatom's limit on codes allows. A paid run refuses it.

**A run that creates a campaign from the builder.** With `E2E_CREATE_CAMPAIGN=true`,
`site-signed-in` also presses the builder's last button, "Create campaign", once. That writes
one draft campaign to the database of the site under test: the live one, unless the suite was
pointed elsewhere. The check then looks for the draft on the home page, Explore and Give as a
signed-out visitor (it must be on none), and opens it by its link. Nothing sets this switch.
The draft is never removed, and nothing is photographed of the page that shows its invitation
links. This is separate from the campaign a paid run creates through the campaign API.

**Do not run it in a loop.** Qatom sends at most 5 sign-in codes per address and 10 per network
address in 15 minutes, in production too. Each run asks for one code per person, now three codes, each to its own address; three runs in a
quarter-hour are nine codes from one network address, under Qatom's ten. The workflow lets at
most three runs sign in within each quarter-hour.

## How to read a run

Open the run on GitHub and download the artifact at the bottom of its page. It holds:

- `screenshots/sign-in/`, `screenshots/phone/`, `screenshots/desktop/`: one picture per step,
  named `<spec>--<number>-<step>.png`, in the order they were taken.
- `screenshots/site-sign-in/` and `screenshots/site-signed-in/`: the same for the visitor on the
  Campaign Site. There the step's name starts with `phone-` or `desktop-`.
- `report/index.html`: Playwright's report. Open it in a browser; a failed test shows its
  message, and a picture of the page at the moment it failed.

**The log is enough to read a failure.** Every failed test ends with a few lines saying what the
page was showing when it failed: which site and page it was on, the page's title, its headings,
its buttons, any error or notice the page showed, and its first words. For example:

```
What the page was showing when this failed:
The page was app.tejido.net/upload, titled "Add evidence · Tejido".
Headings: "Add photos and documents".
Buttons: "Take a photo", "Choose files".
Errors and notices: none.
It began: "Add evidence …".
```

Email addresses, sign-in codes and anything long enough to be a token are taken out of those
lines before they are written, and nothing is read from the address but the site, the page and
Qatom's step name.

Common failures, and what they mean:

| The message says                                                                 | What happened                                                                                                                                              |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "No sign-in code arrived at …"                                                   | Qatom's email did not reach the queue in two minutes. Check the inbox infrastructure, and Qatom's limit above. No second code was asked for.               |
| "Qatom did not send a code: …"                                                   | Qatom refused, usually its limit. Wait 15 minutes.                                                                                                         |
| "Waited 90 seconds for Qatom to send the browser back…"                          | Qatom showed a step the suite does not know. The lines at the end of the failure name the page's step, headings and buttons; `…-qatom-stuck.png` shows it. |
| "The App did not sign … in: …"                                                   | The App refused the sign-in. The message is the App's own title, such as a wrong email (the fixture's address and the inbox domain do not match).          |
| "The assistant did not show its review card."                                    | The model did not produce the review after one nudge. Look at the chat screenshots; run again before assuming something is broken.                         |
| "IT IS NOT KNOWN WHETHER THE FILING WENT THROUGH"                                | A paid run lost touch mid-filing. **Do not run paid again** until you have looked at the test campaign's page and the contractor's wallet.                 |
| "NOTHING WAS FILED", "WAITING FOR AN APPROVAL", "THE DEPOSIT MAY HAVE BEEN PAID" | A paid run that did not end with the entry on the timeline. See the table under "Before the first paid run".                                               |

`sign-in` and `paid-filing` are never retried: a retry would ask for another code or pay
another deposit. `chat-draft` is retried once, because the model's answers vary. If `sign-in` fails, every other spec that needs a signed-in person is skipped. `site-sign-in` is never
retried either; if it fails, only `site-signed-in` is skipped. `create-campaign` is never retried: a
second try would create a second campaign.

## What is never printed or photographed

No token, cookie, queue message or `.env`. Each test person's signed-in browser state (their session cookie), the visitor's on the Campaign
Site included, is kept in `e2e/.auth/`, which git ignores and the workflow does not upload. No
trace or video is recorded, because either would contain cookies. A used one-time code may
appear in a screenshot of Qatom's own page; it is worthless once used.

## What still needs a look

1. **Qatom's pages after the code.** Because the App's sign-in names a Qatom MCP server, Qatom
   offers to add funds by card after the code ("Add funds to your wallet"). The suite presses
   "Skip for now" and nothing else there, and that works. The other steps that can follow
   (`#passkey-skip-btn`, `#confirm-authorization-btn`, `#proceed-without-wallet`,
   `#account-select-continue`, `#finish-sign-in-retry`) were read from Qatom's sign-in page and
   have not been met by a run. If Qatom shows a page the suite does not know, it stops with
   `qatom-stuck` and the log names the page's step, headings and buttons: add its button to
   `ONWARD` in `lib/sign-in.ts`.
2. **The visitor's sign-in on the Campaign Site.** Built against a local copy, where Qatom's
   pages cannot be reached. Nothing is set up for it in the database: the visitor is no party,
   and their Qatom account is made by their first sign-in. What is not known is which pages
   Qatom shows after the code for a sign-in that names no MCP server. An unknown page stops it
   with `qatom-stuck`, and only `site-signed-in` is skipped.
3. **The assistant's behaviour.** The review card is drawn only when the model follows its
   layout exactly. The suite asks plainly and nudges once.
4. **The claim and the confirmation.** Written from the App's code and the check-in rules; no
   run has filed either. Whether the assistant drafts and files them through the same review
   card, and what it asks for, is first seen on the first paid run that reaches them. They stop
   with "NOTHING WAS FILED" and the assistant's words if it does not.
5. **A paid run's sign-in from a new campaign's invitations.** The two test people have only
   ever signed in from `e2e-smoke`'s invitations. The App checks only that the Qatom address
   matches the invited one, so a new campaign's invitation should work the same way.

## Where things are

| File                           | What it is                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `playwright.config.ts`         | The projects: `campaign` (paid runs), then `sign-in`, then `phone` and `desktop`; `site-sign-in`, then `site-signed-in` |
| `lib/config.ts`                | The configuration, parsed once. The only place that reads environment                                                   |
| `lib/safety.ts`                | The refusals: other hosts, and typing a code anywhere but Qatom                                                         |
| `lib/inbox-message.ts`         | Reading one queue message and finding the code in the email's body                                                      |
| `lib/inbox.ts`                 | Waiting on the queue: whose message it is, what is removed or put back                                                  |
| `lib/sign-in.ts`               | Driving Qatom's sign-in pages, for the App and for the Campaign Site                                                    |
| `lib/run-campaign.ts`          | The campaign a paid run creates for itself, and using it in place of `e2e-smoke`                                        |
| `lib/chat.ts`                  | Driving the App's chat as far as the review card                                                                        |
| `lib/filing.ts`                | Pressing "File this entry" and saying what happened. Where a test moves money                                           |
| `lib/image.ts`, `lib/files.ts` | The pictures and the PDF the suite uploads, and the two files the App must refuse                                       |
| `lib/site-header.ts`           | The Campaign Site's header: its words in four languages, its menu                                                       |
| `lib/site-words.ts`            | The Campaign Site's words in its four languages, and what is not words                                                  |
| `lib/harness.ts`               | `waypoint`: the named screenshots. Describes the page when a test fails                                                 |
| `lib/seen-page.ts`             | Reading from a live page what the failure lines say                                                                     |
| `lib/stuck-page.ts`            | Wording those lines, and taking out what must not be in a log                                                           |
| `lib/*.test.ts`                | Unit tests, part of `npm test`. They never reach the network                                                            |
| `specs/*.spec.ts`              | The nineteen specs above. Only `npm run e2e` runs them                                                                  |
