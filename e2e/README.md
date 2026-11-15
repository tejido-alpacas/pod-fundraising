# End-to-end checks against the live site

This folder holds a Playwright suite that uses the **live** site the way a person would. It
signs two fixed test people in to the App (app.tejido.net) through real Qatom, walks the App and
the Campaign Site (tejido.net), talks to the App's assistant, and keeps a screenshot of every
step at phone size (390 px wide) and desktop size (1280 px wide).

It is separate from the four checks. `npm test` never runs it, and it needs things the four
checks must never need: the network, a mailbox, and two real Qatom accounts.

> **Where it stands.** Unpaid runs are green against the live site: both test people sign in
> through real Qatom, and every check below passes. The paid filing has never run. "The story,
> and what is checked" below shows what the suite covers and what it does not.

## What it does

| Spec               | What it does                                                                                                                                                                                                                             | Runs                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `sign-in`          | Opens each test person's invite, presses Sign in with Qatom, types their email on Qatom's page, reads the emailed code from the inbox, and lands back in the App signed in. Saves that signed-in browser for the other specs.            | Once per person per run   |
| `app-walk`         | Signed in. Home, Add evidence (uploads one small generated picture for real, then opens it signed out and checks its fingerprint), the fix page, and the chat as it opens. Then the confirmer's home and chat.                           | Phone and desktop         |
| `chat-draft`       | Signed in. One conversation with the assistant: says what was done, attaches the picture, asks for the review, and checks the review card and its two buttons appear. Files nothing.                                                     | Phone only, unpaid runs   |
| `paid-filing`      | **The one place a test moves money.** Holds the same conversation, presses File this entry, waits for "Submitted", then finds the entry on the campaign's public timeline. Spends a real 0.10 deposit from the test contractor's wallet. | Only with `E2E_PAID=true` |
| `app-signed-out`   | The App with nobody signed in: home, both invitations, an invitation that does not exist, and the pages that need a signed-in person saying so.                                                                                          | Phone and desktop         |
| `site-walk`        | Signed out, as a donor. The test campaign's overview, a proof page (once the campaign has an entry), the milestones and one milestone's page, and the delivery report.                                                                   | Phone and desktop         |
| `site-pages`       | Signed out. Home, Explore, Give and About in Spanish, English, French and Portuguese; Spanish for a browser that asks for none of them; the language buttons; the home page's links; a missing campaign; where Sign in leads (Qatom).    | Phone and desktop         |
| `campaign-builder` | Signed out. The builder's first step: what is missing, then on to the second step and back. The campaign API's check. Never creates a campaign.                                                                                          | Phone and desktop         |

The four signed-out specs type nothing into Qatom, call no model and write nothing, so they
run on every run.

The contractor signs in on the phone-sized screen and the confirmer on the desktop-sized one, so
Qatom's pages are photographed at both sizes with one code each.

## The story, and what is checked

The product's story, step by step, against what this suite checks on the live site. The last
column is the gaps, each with its reason.

| Step of the story                                                            | Checked on every unpaid run                                                                                                                                                                                                                                                                                                        | Not checked, and why                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A creator builds a campaign at `/campaigns/new`                              | The builder opens; an empty first step lists what is missing; a filled one moves to the second step; Back keeps the answers                                                                                                                                                                                                        | Steps 3 to 6 and "Create campaign": creating writes a campaign to the live database on every run. Proposed to the owner, not built                                                                                             |
| The campaign API (`docs/campaign-api.md`)                                    | `POST /api/campaigns/check`: a complete campaign passes, an empty one is told what is missing, one step can be checked alone, a wrong step is refused                                                                                                                                                                              | `POST /api/campaigns`: it creates. Proposed with the row above                                                                                                                                                                 |
| A contractor accepts an invitation and signs in                              | The invite page, Qatom's email and code pages, the emailed code, the offer to add funds skipped, back in the App signed in, both wallets linked                                                                                                                                                                                    | Nothing                                                                                                                                                                                                                        |
| Reports work in the chat                                                     | One real conversation with the assistant as far as its review card and its two buttons (phone). The fix page in whichever state it is in: nothing to fix, one incomplete report open, or several to choose from                                                                                                                    | The report form inside the chat ("Fill in the form"). Completing an incomplete report on the fix page: saving changes the report for good, and the one incomplete report the test campaign has cannot be completed (see below) |
| Adds evidence                                                                | A picture uploads from the evidence page and from the chat; the file then opens for anyone, signed out, and its bytes match the fingerprint in its address. A second picture is kept from donors: it is refused with nobody signed in, opens for its uploader and for the project's confirmer, and the public picture stays public | A signed-in person who is neither the uploader nor a confirmer being refused (there is no third test person), a PDF, a file that is too big                                                                                    |
| Files (a real deposit)                                                       | Nothing on an unpaid run                                                                                                                                                                                                                                                                                                           | `paid-filing` does this, only when a person starts a paid run. See "Before the first paid run"                                                                                                                                 |
| The entry shows on the campaign's timeline with its receipt                  | The timeline is there and says "No updates yet" or lists entries, each with "View proof"                                                                                                                                                                                                                                           | An entry of our own: there is none until the first paid run. `paid-filing` then looks for its entry by its reference                                                                                                           |
| The reconciler verifies it                                                   | Nothing                                                                                                                                                                                                                                                                                                                            | The test campaign has no catalog items of its own, so the reconciler skips it and its entries stay at "Receipt pending". Checking this needs a test campaign with items                                                        |
| The confirmer signs in and confirms the milestone                            | The confirmer signs in, sees the milestones they confirm, and the chat opens for them                                                                                                                                                                                                                                              | Confirming: it is a paid filing (1.00), after the contractor claims the milestone (another 1.00). Proposed, not built                                                                                                          |
| The deposit is refunded                                                      | Nothing                                                                                                                                                                                                                                                                                                                            | It moves money from Tejido's merchant account, after a confirmation. Proposed, not built                                                                                                                                       |
| A donor reads the campaign page, a proof page, the milestones and the report | The overview with its three tabs and "Who’s involved"; the milestones list and one milestone's page; the delivery report. The proof page once the campaign has an entry                                                                                                                                                            | The proof page until the first paid run (skipped, saying so). An overdue or flagged report: the test campaign has none                                                                                                         |
| Home, Explore, Give and About in four languages                              | Each page's title and main heading in Spanish, English, French and Portuguese; Spanish by default; the language buttons; the choice remembered on the next page                                                                                                                                                                    | The rest of each page's wording                                                                                                                                                                                                |
| A donor signs in on the Campaign Site                                        | "Sign in" leads to Qatom's own sign-in page, from the page the donor was on                                                                                                                                                                                                                                                        | Signing in and out: it needs a third test person and a third code per run. Proposed, not built                                                                                                                                 |
| A reminder's link (`/reminder`)                                              | Signed out: it says a report is due, names neither the project nor the person, and its sign-in comes back to it. Signed in as the contractor: it says what is due and leads to the chat; a link about someone else's milestone says so                                                                                             | The reminder message itself (the scheduler sends none yet), and the confirmer's reminder with something to confirm: it needs a claimed milestone                                                                               |
| The scheduler's, the refunds' and the reconciler's own addresses             | Nothing, on purpose                                                                                                                                                                                                                                                                                                                | They act on live data or money when called. The suite never calls them, not even to see them refuse                                                                                                                            |

Signing out of the App is offered on the home page and is deliberately not pressed: it also
ends the assistant's access to Qatom for that person, for every later check.

**The test campaign's one incomplete report.** The first paid filing (run 31) put a photo on a
work log for "Test milestone 1: work". That milestone is a service, which takes documents only,
so Tejido saved the report as incomplete. The fix page can only add files, never take one away,
so that report stays incomplete for good, and the contractor's fix page will always show it.
The suite now files on "Test milestone 3: a build", which takes photos, and a paid filing that
lands incomplete fails saying so.

## What it costs

- **Every run:** one conversation with the model behind the App's assistant (three or four
  replies), two small pictures in the evidence store, one of them kept from donors (the same bytes each
  time, so each is stored once), and two sign-in emails.
- **A paid run, as well:** one filing deposit of 0.10 from the test contractor's Qatom agent
  wallet. The deposit is not refunded, because the test milestone is never confirmed. Each paid
  run also leaves one more test entry on the test campaign's public page.

Runs after a deploy are never paid. Only a person starting a run by hand, and ticking "paid",
spends a deposit.

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
5. **In Qatom, as the contractor:** add funds to the contractor's **agent** wallet (a few
   units cover dozens of paid runs) and set its auto-approve limit to at least 0.10, so a filing
   is paid without a person approving it. To sign in as the contractor yourself you need its
   emailed code; ask whoever runs the inbox how to read one message.
6. **For paid runs only: create the test campaign's two catalog items** in Qatom, as the main
   `README.md` describes ("Setting up the two catalog items in Qatom"), by hand: the automatic
   creation refuses a draft campaign. Then fill their ids in by printing and loading the SQL
   again:

   ```bash
   npm run --silent db:seed:e2e:sql -- --inbox-domain e2e.m.todaq.net --log-work-commodity-id <id> --milestone-hit-commodity-id <id> > e2e-fixture.sql
   ```

   This changes the two ids and nothing else.

## Before the first paid run

The paid filing has never run. Only a person starts it. Before ticking "paid":

1. **Funds and a limit on the contractor's agent wallet.** In Qatom, as the test contractor:
   funds in the **agent** wallet, not the primary one, and an auto-approve limit of at least
   0.10. Qatom's limit is empty by default, and then every payment waits for the person to
   approve it: the spec stops with "THE FILING IS WAITING FOR AN APPROVAL IN QATOM".
2. **No catalog items are made for the test campaign.** The assistant files with the Qatom
   tools whose names end in `log_work` and `milestone_hit` (the example campaign's), and Tejido
   finds the test campaign from the contractor's reporter code. Because the test campaign has
   no item ids, the reconciler skips it: its entries stay at "Receipt pending", and the spec
   does not wait for a verified receipt. Steps 5 and 6 of the setup above describe the other
   way (items of its own), which is not being used.
3. **A green unpaid run just before.** The paid spec holds the same conversation as
   `chat-draft`; if that is failing, do not spend a deposit finding out.
4. **One paid run, started by hand on `main`, left to finish.** Never a second while one is
   running, or after one ended in any way but "nothing was filed" or a pass.

What a good paid run shows: `paid-filing` passes on the phone; the screenshots
`review-before-filing`, `filing-submitted`, `filing-reply`, `timeline-entry` and
`proof-of-the-entry`; one new entry on `tejido.net/campaigns/e2e-smoke`; and 0.10 less in the
contractor's agent wallet. From then on the `site-walk` proof page check runs instead of being
skipped.

If it fails, the failure says which of these happened. **Read the assistant's last message in
the failure first**: it is the only account of what Qatom or Tejido answered, and it can say
more than the heading does. For example, "THE DEPOSIT MAY HAVE BEEN PAID" is the cautious
heading whenever the filing was sent and no entry appeared, even when the assistant goes on to
say the filing was turned down before any payment was taken.

| The failure says                                  | What it means                                                                                                         | Safe to run paid again?                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| "NOTHING WAS FILED"                               | The assistant did not use a filing tool. No deposit was paid.                                                         | Yes, once the cause is dealt with                                          |
| "THE FILING IS WAITING FOR AN APPROVAL IN QATOM"  | A payment is waiting for the contractor's approval. Not paid, but approving it later would pay it and file the entry. | After raising the auto-approve limit. Leave the waiting payment unapproved |
| "THE DEPOSIT MAY HAVE BEEN PAID"                  | The filing was sent, and the entry is not on the public timeline.                                                     | Not until a person has looked at the public page and the wallet            |
| "IT IS NOT KNOWN WHETHER THE FILING WENT THROUGH" | The page lost touch mid-filing.                                                                                       | Not until a person has looked                                              |

## What donors see

The test campaign is a **draft**, and the Campaign Site's home page leaves drafts out, so it is
not listed. It is not hidden: anyone who has the address `tejido.net/campaigns/e2e-smoke` can
open it. Its title, summary and party names all say it is an automated test, and it has no
donation item, so its funding reads "not known" and nobody can give to it through Tejido.

## How to run it

**On GitHub (the normal way).** It runs by itself after each successful release of `main`. To
run it by hand: Actions → End-to-end → Run workflow. Leave the branch on `main` (the inbox role
trusts no other branch). Tick "paid" only when you mean to spend a deposit.

**On your own computer.** You need AWS credentials that may read the queue, and Chromium
(`npx playwright install chromium`, once). Set these, then run `npm run e2e`:

| Variable                  | Value                                                             |
| ------------------------- | ----------------------------------------------------------------- |
| `E2E_INBOX_QUEUE_URL`     | As above                                                          |
| `E2E_INBOX_DOMAIN`        | `e2e.m.todaq.net`                                                 |
| `E2E_INBOX_REGION`        | `ca-central-1`                                                    |
| `E2E_QATOM_HOST`          | `pay.m.todaq.net`: the only host an email or a code is typed into |
| `E2E_CAMPAIGN_ID`         | `e2e-smoke`                                                       |
| `E2E_CONTRACTOR_PARTY_ID` | `e2e-contractor`                                                  |
| `E2E_CONFIRMER_PARTY_ID`  | `e2e-confirmer`                                                   |
| `E2E_PAID`                | Leave unset. Exactly `true` spends a deposit                      |
| `E2E_SKIP_SIGN_IN`        | Leave unset. Exactly `true` asks Qatom for no code: see below     |

`E2E_APP_URL` and `E2E_SITE_URL` default to the live site. Any other address is refused unless
`E2E_ALLOW_OTHER_HOSTS=true`, and a paid run is refused anywhere but the live site. If a value
is missing the suite stops before opening a page and names it.

`npm run e2e:list` lists the tests without running anything, and needs nothing set.

**A run that does not sign in.** With `E2E_SKIP_SIGN_IN=true` the suite asks Qatom for no
sign-in code. The sign-in and every check that needs a signed-in person are skipped, each
saying why, and the signed-out checks (the Campaign Site as a donor) run as usual. It is for
when runs come closer together than Qatom's limit on codes allows. A paid run refuses it.

**Do not run it in a loop.** Qatom sends at most 5 sign-in codes per address and 10 per network
address in 15 minutes, in production too. Each run asks for one code per person. Three runs in a
quarter of an hour are fine; six are not.

## How to read a run

Open the run on GitHub and download the artifact at the bottom of its page. It holds:

- `screenshots/sign-in/`, `screenshots/phone/`, `screenshots/desktop/`: one picture per step,
  named `<spec>--<number>-<step>.png`, in the order they were taken.
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
another deposit. `chat-draft` is retried once, because the model's answers vary. If `sign-in`
fails, every other spec is skipped.

## What is never printed or photographed

No token, cookie, queue message or `.env`. Each test person's signed-in browser state (their
session cookie) is kept in `e2e/.auth/`, which git ignores and the workflow does not upload. No
trace or video is recorded, because either would contain cookies. A used one-time code may
appear in a screenshot of Qatom's own page; it is worthless once used.

## What still needs a look

1. **Qatom's pages after the code.** Because the App's sign-in names a Qatom MCP server, Qatom
   offers to add funds by card after the code ("Add funds to your wallet"), unless the client's
   row in Qatom says `"show_chargeup": false`. The suite presses "Skip for now" and nothing
   else there, and that works. The other steps that can follow (`#passkey-skip-btn`,
   `#confirm-authorization-btn`, `#proceed-without-wallet`, `#account-select-continue`,
   `#finish-sign-in-retry`) were read from Qatom's sign-in page and have not been met by a
   run. If Qatom shows a page the suite does not know, it stops with `qatom-stuck` and the log
   names the page's step, headings and buttons: add its button to `ONWARD` in
   `lib/sign-in.ts`.
2. **The assistant's behaviour.** The review card is drawn only when the model follows its
   layout exactly. The suite asks plainly and nudges once. It has passed on every run so far.
3. **The paid filing.** It has never run. Finding the filed entry depends on the assistant
   using the note word for word: the spec looks for its own reference (`ref-…`) in the public
   timeline's text. If the model rewrites the note, the entry is filed but the spec fails at
   the last step, saying so.

## Where things are

| File                   | What it is                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| `playwright.config.ts` | The three projects: `sign-in`, then `phone` and `desktop`               |
| `lib/config.ts`        | The configuration, parsed once. The only place that reads environment   |
| `lib/safety.ts`        | The refusals: other hosts, and typing a code anywhere but Qatom         |
| `lib/inbox-message.ts` | Reading one queue message and finding the code in the email's body      |
| `lib/inbox.ts`         | Waiting on the queue: whose message it is, what is removed or put back  |
| `lib/sign-in.ts`       | Driving Qatom's sign-in pages                                           |
| `lib/chat.ts`          | Driving the App's chat as far as the review card                        |
| `lib/harness.ts`       | `waypoint`: the named screenshots. Describes the page when a test fails |
| `lib/seen-page.ts`     | Reading from a live page what the failure lines say                     |
| `lib/stuck-page.ts`    | Wording those lines, and taking out what must not be in a log           |
| `lib/*.test.ts`        | Unit tests, part of `npm test`. They never reach the network            |
| `specs/*.spec.ts`      | The eight specs above. Only `npm run e2e` runs them                     |
