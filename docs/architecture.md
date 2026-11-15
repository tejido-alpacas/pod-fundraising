# Proof-of-Delivery Fundraising: architecture brief

The team's architecture brief, converted from the original artifact so every agent works from
the same description. It says what we are building and why. `README.md` says how the repository
is laid out; `docs/build-plan.md` says who builds what and when.

> **Where this brief and the code differ, the code is right.** The brief was written before
> Qatom's API document was read in full. Corrections found since are collected in
> [Corrections since this brief](#corrections-since-this-brief) at the end. Read that section
> before relying on a detail about transfers, amounts or sign-in.

A fundraiser where the money is only half the story. Every contractor and supplier named on a
campaign has to report back on a schedule, an independent confirmer signs off each milestone, and
each report is stamped as a Qatom purchase, so donors can check that it happened, when, and who
filed it.

## The idea in four sentences

1. A campaign creator must name the **third parties** who will do the work or receive the goods,
   and the **milestones** each one owes.
2. Donors fund the campaign through Qatom, as the site already does today.
3. Once funded, each third party must file a **check-in** on the cadence the creator set: a
   photo, a progress note, a percent complete. They file it through an agent over MCP, by
   "buying" one of the campaign's two Qatom catalog items: a **work log** for routine updates
   (0.10), or a **milestone hit** when a milestone is done (1.00).
4. That purchase is the backwards part. We use the payment rail as a **notary**: the transaction
   is the timestamped, signed receipt that the report was filed, and the platform shows it to
   every donor.

We do not change any Qatom code. Everything below uses features that exist today: catalog items,
managed MCP servers, featured tools, external endpoints and the sales ledger.

## Who is involved

| Actor           | Role                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Creator**     | Sets up the campaign, names third parties, defines milestones and the check-in cadence. Cannot launch without them.               |
| **Donor**       | Funds the campaign through Qatom. Gets every check-in in a timeline, each with a proof they can inspect.                          |
| **Third party** | Contractor, supplier or service provider: whoever does the work. Has a Qatom account and wallet. Logs work and claims milestones. |
| **Confirmer**   | Someone independent of the work, named per milestone, who signs it off. Has a Qatom wallet. Often not the beneficiary.            |
| **Beneficiary** | The pupils, the village, the child. The reason for the campaign. Needs no account and no wallet.                                  |
| **Their agent** | Claude, ChatGPT or any MCP client, connected to our Qatom MCP server and signed in as the third party.                            |

## Who confirms a milestone

The person who benefits and the person who confirms are different roles. Most beneficiaries
cannot hold a wallet, and a child never should. So the creator names a confirmer for each
milestone: someone who did not do the work and can sign in to Qatom.

| Campaign                         | Beneficiary, no wallet | Does the work                   | Plausible confirmer                                                               |
| -------------------------------- | ---------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| School rebuilt after a hurricane | The pupils             | Contractor, suppliers           | Head teacher, school board, or a local building inspector                         |
| A well                           | The village            | Drilling company                | Village water committee, an NGO field officer, or a water-quality tester          |
| A child's future                 | The child              | School, clinic, whoever is paid | The guardian, a caseworker, or the school registrar confirming fees were received |

**Donors see how strong each confirmation is**

- **Confirmed independently**: the named confirmer signed off from their own wallet.
  (`confirmed_independent`)
- **Confirmed by the creator**: no independent confirmer answered within the waiting period, so
  the creator signed off instead. Deposits are returned, and the label says who confirmed.
  (`confirmed_creator`)
- **Reported only**: the third party claims it is done and nobody has confirmed yet. (`claimed`)

**Evidence depends on the campaign.** For a school or a well, photos are the evidence. For a
child, donor-visible evidence is documents only: a fee receipt, an enrolment letter. No photos of
the child. The creator sets this per milestone type, and the check-in endpoint enforces it.

## Stages of a campaign, and what runs in each

The Campaign Site faces creators and donors; the App faces third parties and confirmers.

**1. Fundraising**

- _Campaign Site_ · **Campaign builder**: creator adds third parties, a confirmer per milestone,
  milestones, cadence and evidence rules. Required to launch.
- _Campaign Site_ · **Donations**: donors fund through Qatom. Exists today.
- _App_ · **Invite and wallet link**: each third party and confirmer gets an invite link and signs
  in with Qatom. Their agent wallet (pays the stamps) and primary wallet (receives refunds) are
  tied to the campaign.
- _At goal met_ · **Item provisioning**: create the campaign's two catalog items in Qatom and
  issue reporter codes.

**2. Funded, work under way**

- _Backend_ · **Cadence scheduler**: sends reminders, marks a missed work log overdue and tells
  donors.
- _App_ · **Evidence upload**: photos or documents in, URL and SHA-256 out.
- _Through Qatom_ · **Log work, 0.10**: routine update on the cadence.
- _Through Qatom_ · **Milestone hit, 1.00**: the third party claims a milestone is done. The
  confirmer signs it off through the same item.
- _Backend_ · **Check-in endpoint and reconciler**: save each stamped entry, then match it to the
  ledger and to the registered wallet.
- _Backend_ · **Deposit refund**: on each confirmed milestone, return the stamp fees paid on it.
- _Campaign Site_ · **Donor timeline and proof page**: every log and milestone, with its receipt
  and confirmation strength.

**3. Project completed**

- _Through Qatom_ · **Last milestone confirmed**: the final sign-off, by the confirmer or by the
  creator after the waiting period.
- _Backend_ · **Final refunds**: remaining deposits returned. Nothing is left owed to a third
  party.
- _Campaign Site_ · **Delivered, with a final report**: the campaign closes with every milestone,
  who confirmed it and how strongly.

## Architecture map

Three owners: what we build, what Qatom already does, and what lands on TODA.

**Our platform (we build this)**

- **Campaign builder**: third parties, milestones and cadence become required fields.
- **Evidence upload**: stores each photo, returns a URL and its SHA-256. A check-in can reference
  several. The images never travel through Qatom.
- **Check-in endpoint** (`POST /api/checkins`): receives each stamped check-in from Qatom and
  saves it.
- **Cadence scheduler**: knows what is due from whom. Marks late check-ins and tells donors.
- **Reconciler**: pulls the campaign's ledger from Qatom and attaches the TODA entry to each saved
  check-in. Checks the paying wallet is the one registered for that third party; a mismatch is
  flagged to donors.
- **Fee refund** (`POST /v4/transfer`): on milestone confirmation, returns each reporter's stamp
  fees for that milestone.
- **Donor timeline and proof page**: updates, photos, milestone status, and the receipt behind
  each one.

**Qatom (used as is; one merchant account for the platform)**

- **Catalog**: two new catalog items per campaign, Log work (0.10) and Milestone hit (1.00),
  beside its donation item, all in the platform's one account. Each item has its own twin, its own
  input schema, and our check-in endpoint as its external endpoint.
- **Managed MCP server**: our account's own server. Each featured catalog item appears on it as a
  tool named after that item, so "Library wing log work" and "Library wing milestone hit" become
  the tools `library_wing_log_work` and `library_wing_milestone_hit`. Two tools per campaign.
- **Sign-in and approvals**: the third party signs in by email code. Each purchase needs their
  approval, or falls under the auto-approve limit they set.
- **Paywall and fulfilment** (`/v4/paywall` → `/v4/fulfil`): validates inputs, asks the payer's
  twin to pay, records the sale, then calls our check-in endpoint with the inputs.
- **Sales ledger** (`/v4/commodity/:hash/transactions`): reads the campaign twin's binder back as
  a list of transactions.

**TODA twins (only reached when the price is above zero)**

- **Reporter's wallet twin**: pays the stamp fee. Its address identifies who filed.
- **The two items' twins**: one for Log work and one for Milestone hit, per campaign. Each
  receives its fee, then forwards the request to Qatom fulfilment.
- **Binder entry**: the durable record of each stamp (`twistId`, `timestamp`, `fromAddress`,
  `destinationAddress`, `amount`). One binder holds that campaign's work logs, the other its
  milestone claims and confirmations.
- **Donation item's twin**: donor payments land in the donation item's own binder, so each
  campaign has three ledgers: donations, work logs and milestones.

## From a work log to a confirmed milestone and refund

Read top to bottom. **Bold** steps move money. Deposits leave the reporter's wallet at steps 8 and
18 and return at step 24.

**Due**

1. Our platform → Third party: reminder saying what to file and by when.

**File**

2. Third party → Their agent: photos and a progress note.
3. Their agent → Our platform: upload photos.
4. Our platform → Their agent: URL and SHA-256 per photo (reply).
5. Their agent → Qatom MCP: call the log-work tool.

**Stamp**

6. Qatom MCP → Qatom payment: inputs checked, purchase.
7. Qatom payment → Third party: approve 0.10? (skipped under their auto-approve limit).
8. **Qatom payment → TODA twins: the reporter's wallet pays 0.10.**
9. TODA twins: binder entry on the log-work twin.
10. TODA twins → Qatom payment: forward to fulfilment.

**Record**

11. Qatom payment → Our platform: POST to the external endpoint, declared inputs.
12. Our platform → Qatom payment: accepted, and what is still owed (reply).
13. Qatom payment → Their agent: result and transaction id (reply).

**Verify**

14. Our platform → Qatom payment: read the ledger.
15. Qatom payment → Our platform: twistId, time, paying wallet (reply).
16. Our platform: is the paying wallet the registered one?
17. Our platform → Donors: verified update with its proof.

**Milestone hit**

18. **Their agent → Qatom MCP: call the milestone-hit tool, 1.00** (same path as steps 5 to 13).
19. Our platform → Donors: milestone claimed, awaiting its confirmer.

**Confirm and refund**

20. **Confirmer → Qatom MCP: confirms with the milestone-hit tool, 1.00** (same path).
21. Our platform: milestone confirmed, total the deposits.
22. **Our platform → Qatom payment: transfer deposits back.**
23. **Qatom payment → TODA twins: main wallet pays out.**
24. **TODA twins → Third party: deposits back in the reporter's wallet.**
25. Our platform → Donors: milestone confirmed, and by whom.

## Campaign lifecycle

`draft` → `funding` → `funded` → `reporting` → `delivered`, with `overdue` as a side state of
`reporting`.

| From        | To          | When                                                 |
| ----------- | ----------- | ---------------------------------------------------- |
| `draft`     | `funding`   | Third parties, milestones and cadence are set        |
| `funding`   | `funded`    | Goal met                                             |
| `funded`    | `reporting` | The two catalog items go live, reporter codes issued |
| `reporting` | `overdue`   | A cadence is missed. Donors are told                 |
| `overdue`   | `reporting` | The late check-in is filed                           |
| `reporting` | `delivered` | Every milestone confirmed, deposits returned         |

A milestone is confirmed by a second party, not the one doing the work. The named confirmer (the
head teacher, in the library example) uses the Milestone hit tool with `claim: "confirm"`. Same
tool, same 1.00 stamp, a different wallet. Two independent wallets attesting to the same milestone
is the closest this prototype gets to "it reached the right hands".

Confirmation also triggers the refund. The platform totals the stamp fees paid on that milestone
(the third party's work logs and milestone claim, and the confirmer's own stamp) and sends them
back with Qatom's transfer call, addressed to each filer's **primary** wallet. The stamps were
paid from their **agent** wallet, so the deposit returns to a different wallet than it left.

## What the proof actually proves

| Claim                  | Backed by                                                                                                                                                                             | Strength                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A check-in was filed   | Binder entry on the campaign's twin, readable through Qatom's ledger.                                                                                                                 | Strong. Independent of our database.                                                            |
| When                   | The entry's timestamp.                                                                                                                                                                | Strong.                                                                                         |
| By whom                | The stamp fee itself, paid from the third party's own agent wallet. An entry only counts if the paying address matches the agent wallet stored for the party its reporter code names. | Strong for "the named party's wallet filed this". It does not show who physically did the work. |
| What they said         | We store the inputs and a hash of them, linked to the transaction.                                                                                                                    | Medium. The link between content and transaction is kept by us and by Qatom's records.          |
| The photo is unaltered | The SHA-256 submitted for each photo. Anyone can re-hash the image.                                                                                                                   | Strong for "not swapped later".                                                                 |
| The photo is true      | Nothing technical. An independent confirmer's sign-off helps, and donors are shown whether there was one.                                                                             | Weak. Be upfront about this in the pitch.                                                       |

## The two catalog items

Two catalog items per campaign, not one Qatom account per campaign. Each item has its own
commodity and its own twin, so each campaign has a work-log ledger and a milestone ledger.

- **Log work**, 0.10 USD-TDN. The routine update on the cadence: note, percent complete, photos,
  and whether the work is on track.
- **Milestone hit**, 1.00 USD-TDN. The third party claims a milestone is done, with its evidence.
  The confirmer signs off through the same item.
- **Name** becomes the tool name, e.g. "Library wing log work" → `library_wing_log_work`.
- **Both prices are deposits**, paid from the filer's own Qatom wallet and returned when the
  milestone is confirmed. Filers need a funded wallet, and an auto-approve limit of 1.00 or more
  to file without a prompt.
- **Featured** on, so it shows up as its own tool.
- **Method** POST. **External endpoint** our check-in endpoint.
- **Dispatch parameter**: a secret header our check-in endpoint checks, so only Qatom can post
  check-ins. In this repository it is `X-Tejido-Checkin-Secret`.

Two limits shape the schema. Inputs are for small structured values, not files, so each photo
goes as a URL and hash. And our endpoint receives only the declared inputs and our own headers,
not the payer's identity, so each party gets a private `reporter_code` to include.

**The schemas are defined once, in `packages/contracts/src/items.ts`.** Do not copy them
elsewhere. The JSON Schema to enter in Qatom is generated from them by
`itemInputJsonSchema(item)`. It is the same for every campaign.

| Input              | Log work | Milestone hit | Notes                                              |
| ------------------ | -------- | ------------- | -------------------------------------------------- |
| `reporter_code`    | required | required      | Resolves to one party on one campaign              |
| `milestone_id`     | required | required      | Plain text. Our endpoint checks it is the filer's  |
| `summary`          | required | required      |                                                    |
| `claim`            | —        | required      | `completed`, `delivered`, `funds_spent`, `confirm` |
| `status`           | optional | —             | `on_track`, `delayed`, `blocked`                   |
| `period`           | optional | —             |                                                    |
| `percent_complete` | optional | —             | 0 to 100                                           |
| `quantity`, `unit` | —        | optional      | Needed for a delivery                              |
| `amount_spent`     | —        | optional      | Needed for a funds handover                        |
| `photos`           | optional | optional      | Up to ten of `{ url, sha256, caption? }`           |
| `location`         | optional | optional      |                                                    |

## How two items cover every party and milestone

Anything the reporter could lie about by typing a different value is not a parameter.

| Variation                         | How it is handled                                                                                                                                            | Lives in                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Which third party or confirmer    | Not declared by the filer. The `reporter_code` resolves to one party and its role on our side.                                                               | Platform, keyed by a parameter      |
| Which milestone                   | `milestone_id`, plain text. Our endpoint refuses one the filer's campaign does not have.                                                                     | Parameter                           |
| Type of milestone                 | Set by the creator: construction, goods delivery, funds handover, service. It decides which check-in types are allowed and what evidence each needs.         | Platform                            |
| Routine update or milestone claim | Which tool is called. On Milestone hit, `claim` says what kind. The claim-specific fields are optional in the schema and enforced per claim by our endpoint. | Choice of item, checked by platform |
| Number and cadence of work logs   | Campaign configuration. A work log fills the earliest open slot for that party and milestone, or names one with `period`.                                    | Platform                            |
| Who confirms a milestone          | A `confirm` claim only counts from the confirmer named for that milestone, or from the creator once the waiting period has passed. Anyone else's is refused. | Platform                            |

| Milestone type | Work logs                         | Milestone hit claim             | Evidence on the claim     | Typical confirmer             |
| -------------- | --------------------------------- | ------------------------------- | ------------------------- | ----------------------------- |
| Construction   | on cadence, with percent complete | `completed`                     | photos                    | head teacher, inspector       |
| Goods delivery | optional                          | `delivered`, once per shipment  | photos, quantity and unit | whoever receives the goods    |
| Funds handover | optional                          | `funds_spent`, once per tranche | amount spent, receipt     | the party paid, or a guardian |
| Service        | on cadence                        | `completed`                     | summary, documents        | caseworker, committee         |
| Any            | status `blocked` when work stops  | none                            | summary                   | none needed                   |

**The endpoint answers with what is still owed.** Whatever our check-in endpoint returns comes
back to the agent as the tool's result. Use it: "Accepted, check-in 3 of 8 for Walls, next due 28
Nov" or "Refused: a delivery check-in needs quantity and unit".

**By the time our endpoint sees an entry, its stamp has been paid.** So avoid refusing for
fixable gaps: save it as filed but `incomplete`, say what is missing, and let the reporter add
the missing evidence on the platform without a second stamp. Refuse outright only for a bad
reporter code or a party reporting on someone else's milestone.

**The reminder carries the instructions.** There is no separate lookup tool. The reminder spells
out which of the two tools, the milestone id, the fields required and the deadline.

### Who enforces what

| Layer                 | What it checks                                                                                                                                                                 | When             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| The agent             | Reads the schema from the tool and fills it in. A first pass, not a guarantee.                                                                                                 | Before the call  |
| Qatom MCP server      | Required inputs present, scalar types match, enum values are listed. A misfit is refused and nothing is charged.                                                               | Before the stamp |
| Qatom payment API     | The same three rules. Undeclared inputs are dropped before our endpoint is called.                                                                                             | Before the stamp |
| Our check-in endpoint | Everything a schema cannot say: the reporter code is real, this party may report on this milestone, a delivery has quantity and unit, a confirmation comes from the confirmer. | After the stamp  |

Qatom checks only top-level scalar inputs and enums; it does not look inside arrays or objects. So
our endpoint checks the `photos` list: at most ten entries, every URL points at our own evidence
storage, every hash is 64 hex characters and matches the file we stored at upload.

## Demo script

1. Creator builds "Rebuild the library wing" and is stopped until a contractor, a supplier and a
   confirmer (the head teacher) are added with milestones and a weekly cadence.
2. A donor funds it. Goal met, campaign flips to Reporting.
3. The contractor opens the agent, connected to our Qatom MCP server, and says "file this week's
   check-in" with a site photo. Approves the 0.10 stamp. Later they claim the milestone with the
   second tool for 1.00.
4. The donor's timeline shows the update. Opening its proof shows the transaction id, twistId,
   timestamp and paying wallet, and the photo hash matches.
5. The head teacher confirms the milestone from their own wallet. It shows "confirmed
   independently" and the contractor's stamp fees for it are returned to their wallet.
6. Skip a week for the supplier. The campaign shows Overdue and donors are told.

## If there is time

- **Release funds by milestone.** Hold donations in the campaign wallet and pay each third party
  only after the confirmer signs off.
- **A reviewing agent.** An agent on our side reads each check-in, compares the photo against the
  last one and the stated percent, and flags anything odd for donors.
- **Public verification.** The ledger is readable only by the account owner today, so donors trust
  our proof page. A public verifier would need something from Qatom.

## Still to check on staging

- That a 0.10 work log and a 1.00 milestone hit each settle on the twins and appear in their
  ledgers with a twistId.
- Whether the external endpoint also receives the transaction id. If it does, the reconciler can
  match exactly instead of by address and time.
- That a list input (the `photos` array) reaches our endpoint intact.
- That the account's main wallet holds a float for refunds. Transfers leave from the main wallet,
  while the stamp fees collect on each item's own twin.
- That our account has a managed MCP server and the App's agent can connect to it as a signed-in
  third party.
- How demo third parties get a wallet balance. On staging, Stripe test cards work.
- That Tejido's sign-in client is allowed to request the `twin` scope.
- That one Qatom sign-in at onboarding yields both the wallet claims and a token the App's agent
  can use on the MCP server. If not, onboarding needs two consent steps.
- That the paying address in the ledger is the same string as the agent wallet hostname from the
  claims.

## Corrections since this brief

Found by reading Qatom's API document (`{PAYMENT_API_URL}/v4/openapi.json`) and its OIDC discovery
document while building `packages/qatom`. The code follows these.

- **A transfer needs the digital quantity.** `POST /v4/transfer` requires `type`, a DQ hash, as
  well as `address` and `amount`. The ledger response returns it as `commodity.dq`; refund in the
  same quantity the deposits were paid in.
- **A transfer's address is a twin URL**, `https://<hostname>`, or an email. Not a bare hostname.
  `transfer()` builds the URL from a `PrimaryWalletHostname`.
- **A transfer returns no transaction id.** The answer is `202 {}`. It must never be retried
  automatically; after a timeout its outcome is unknown.
- **Transfer amounts are "in the smallest unit"** of the digital quantity. We store whole numbers
  and assume one unit is 0.001, so 0.10 is `100`. The scale, and the unit of the ledger's
  `amount`, are not stated anywhere and are still to confirm.
- **Qatom's errors have no code.** The body is `{ error, status }`, with `error` a readable
  string.
- **The OIDC issuer is the payment API's bare origin**, not `{PAYMENT_API_URL}/v4/oidc`. The
  discovery document is served under `/v4/oidc`; the client takes the issuer from it.
- **Both items share one endpoint and are told apart by `claim`.** A milestone hit always carries
  it; a work log never does.
- **Every campaign shares the same two catalog items** (the owner's decision, 15 November):
  one Log work and one Milestone hit on Tejido's merchant account, not a pair per campaign as
  this brief says above. The check-in endpoint finds the campaign from the filer's reporter
  code, not from the item. So nothing entered on an item names one campaign: `milestone_id` is
  plain text, not a list of one campaign's milestones, and our endpoint refuses a milestone the
  filer's campaign does not have.
- **Dispatch header names cannot start with `X-Qatom-` or `X-Forwarded-`.**
