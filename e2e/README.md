# End-to-end checks against the live site

This folder holds a Playwright suite that uses the **live** site the way a person would. It
signs two fixed test people in to the App (app.tejido.net) through real Qatom, walks the App and
the Campaign Site (tejido.net), talks to the App's assistant, and keeps a screenshot of every
step at phone size (390 px wide) and desktop size (1280 px wide).

It is separate from the four checks. `npm test` never runs it, and it needs things the four
checks must never need: the network, a mailbox, and two real Qatom accounts.

> **Only the first steps have run against the live site.** The workflow's sign-in to AWS, the
> invitation page, Qatom's email and code pages, and reading the code from the inbox all work.
> Everything after the code is still unchecked. Read "What still needs a look" before trusting a
> failure.

## What it does

| Spec          | What it does                                                                                                                                                                                                                             | Runs                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `sign-in`     | Opens each test person's invite, presses Sign in with Qatom, types their email on Qatom's page, reads the emailed code from the inbox, and lands back in the App signed in. Saves that signed-in browser for the other specs.            | Once per person per run   |
| `app-walk`    | Home, Add evidence (uploads one small generated picture for real), the fix page, and the chat as it opens. Then the confirmer's home.                                                                                                    | Phone and desktop         |
| `site-walk`   | The test campaign's overview, a proof page (once the campaign has an entry), the milestones, and the delivery report. Signed out, as a donor.                                                                                            | Phone and desktop         |
| `chat-draft`  | One conversation with the assistant: says what was done, attaches the picture, asks for the review, and checks the review card and its two buttons appear. Files nothing.                                                                | Phone only, unpaid runs   |
| `paid-filing` | **The one place a test moves money.** Holds the same conversation, presses File this entry, waits for "Submitted", then finds the entry on the campaign's public timeline. Spends a real 0.10 deposit from the test contractor's wallet. | Only with `E2E_PAID=true` |

The contractor signs in on the phone-sized screen and the confirmer on the desktop-sized one, so
Qatom's pages are photographed at both sizes with one code each.

## What it costs

- **Every run:** one conversation with the model behind the App's assistant (three or four
  replies), one small picture in the evidence store (the same bytes each time, so it is stored
  once), and two sign-in emails.
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

| The message says                                        | What happened                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "No sign-in code arrived at …"                          | Qatom's email did not reach the queue in two minutes. Check the inbox infrastructure, and Qatom's limit above. No second code was asked for.               |
| "Qatom did not send a code: …"                          | Qatom refused, usually its limit. Wait 15 minutes.                                                                                                         |
| "Waited 90 seconds for Qatom to send the browser back…" | Qatom showed a step the suite does not know. The lines at the end of the failure name the page's step, headings and buttons; `…-qatom-stuck.png` shows it. |
| "The App did not sign … in: …"                          | The App refused the sign-in. The message is the App's own title, such as a wrong email (the fixture's address and the inbox domain do not match).          |
| "The assistant did not show its review card."           | The model did not produce the review after one nudge. Look at the chat screenshots; run again before assuming something is broken.                         |
| "IT IS NOT KNOWN WHETHER THE FILING WENT THROUGH"       | A paid run lost touch mid-filing. **Do not run paid again** until you have looked at the test campaign's page and the contractor's wallet.                 |
| "The assistant replied without filing"                  | Nothing was sent. Usually the wallet is empty or the auto-approve limit is too low; the screenshot shows what the assistant asked for.                     |

`sign-in` and `paid-filing` are never retried: a retry would ask for another code or pay
another deposit. `chat-draft` is retried once, because the model's answers vary. If `sign-in`
fails, every other spec is skipped.

## What is never printed or photographed

No token, cookie, queue message or `.env`. Each test person's signed-in browser state (their
session cookie) is kept in `e2e/.auth/`, which git ignores and the workflow does not upload. No
trace or video is recorded, because either would contain cookies. A used one-time code may
appear in a screenshot of Qatom's own page; it is worthless once used.

## What still needs a look

The email step, the code step and the inbox have worked against the live site. The rest has not
run. In order of likelihood:

1. **Qatom's pages after the code.** Because the App's sign-in names a Qatom MCP server, Qatom
   offers to add funds by card after the code ("Add funds to your wallet"), unless the client's
   row in Qatom says `"show_chargeup": false`. The suite presses "Skip for now" and nothing
   else there. The ids of the other steps that can follow (`#passkey-skip-btn`,
   `#confirm-authorization-btn`, `#proceed-without-wallet`, `#account-select-continue`,
   `#finish-sign-in-retry`) were read from Qatom's sign-in page, not checked by a run. If Qatom
   shows a page the suite does not know (a separate consent page, say), it stops with
   `qatom-stuck` and the log names the page's step, headings and buttons: add its button to
   `ONWARD` in `lib/sign-in.ts`.
2. **A first-time account.** The very first sign-in of each person also creates their Qatom
   account, which Qatom says can take a few seconds longer; the wait is 90 seconds.
3. **The assistant's behaviour.** The review card is drawn only when the model follows its
   layout exactly. The suite asks plainly and nudges once.
4. **Finding the filed entry.** The paid spec looks for its own reference (`ref-…`) in the
   public timeline's text. It asks the assistant to use the note word for word; if the model
   rewrites it, the entry is filed but the spec fails at the last step, saying so.

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
| `specs/*.spec.ts`      | The five specs above. Only `npm run e2e` runs them                      |
