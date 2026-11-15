# The campaign API: creating a campaign from the campaign builder

This is for whoever builds the campaign builder's form. It describes the two addresses the
form sends a campaign to: one that checks it, and one that checks it and creates it.

Both take the same request, and both are on the Campaign Site (`apps/web`), next to its pages.

| Address                     | What it does                                                |
| --------------------------- | ----------------------------------------------------------- |
| `POST /api/campaigns/check` | Says what is wrong with the campaign so far. Saves nothing. |
| `POST /api/campaigns`       | Checks everything, then creates the campaign as a draft.    |

Neither one calls Qatom, moves money or sends email.

## Before you start

- **Send JSON.** The request needs the header `Content-Type: application/json`. Anything else
  is refused with `415`.
- **Same site only.** Nobody signs in to use these, so they are for pages served by the
  Campaign Site itself. They send no CORS headers: a page on another website cannot call them
  from a browser. Call them with a relative address, such as `fetch('/api/campaigns', …)`.
- **Keep it small.** A body larger than 200,000 bytes is refused. A real campaign is a few
  thousand.
- **At most 20 campaigns an hour are created, counting everyone.** The 21st is refused with
  `429` until an hour has passed since the oldest of the 20. Checking is not limited.
- **Answers are never cached** (`cache-control: no-store`).
- **No answer contains anything private.** No email address, no filing code and no wallet
  comes back, in a success or in a refusal.

## The request

The body is one JSON object with five parts. **Every value is a string, exactly as the person
typed it.** The server trims and tidies; the form does not need to.

```json
{
  "project": {
    "title": "",
    "summary": "",
    "beneficiary": "",
    "creatorName": "",
    "creatorEmail": ""
  },
  "funding": { "goal": "" },
  "milestones": [
    {
      "key": "",
      "title": "",
      "description": "",
      "kind": "",
      "dueDate": "",
      "ownerKey": "",
      "confirmerKey": ""
    }
  ],
  "people": [
    {
      "key": "",
      "role": "",
      "name": "",
      "title": "",
      "email": "",
      "relationship": "",
      "relationshipReason": ""
    }
  ],
  "schedule": { "cadence": "" }
}
```

"Limit" below is the most characters allowed. Limits and allowed values come from the
contracts (`packages/contracts`) unless the table says the rule is the checker's own.

### `project`: what the campaign is

| Field          | What it is                                       | Required | Limit                    |
| -------------- | ------------------------------------------------ | -------- | ------------------------ |
| `title`        | The project's name. Donors see it.               | Yes      | 200                      |
| `summary`      | A description of the project.                    | No       | 2000                     |
| `beneficiary`  | Who the project is for, in words.                | No       | 300                      |
| `creatorName`  | The person or group organising the project.      | Yes      | 200                      |
| `creatorEmail` | The organiser's email address. Never shown back. | Yes      | Must be an email address |

### `funding`: the goal

| Field  | What it is                                                                          | Required                                         | Allowed                                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goal` | What the campaign is trying to raise, in USD-TDN, as typed: `12,000` or `12000.50`. | No. Empty means "no goal yet"; none is invented. | A number more than zero. Commas and spaces are ignored. At most 12 digits before the decimal point and 3 after (how a typed number is read is the checker's own rule). |

### `milestones`: what will be delivered, in order

A list. The order of the list is the order of the milestones. **At least 1, at most 20** (the
checker's own rule).

| Field          | What it is                                                                         | Required | Limit or allowed values                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`          | Your own short label for this milestone. See "Keys" below.                         | Yes      | 1 to 24 lower-case letters and digits                                                                                                                             |
| `title`        | The milestone's name.                                                              | Yes      | 200                                                                                                                                                               |
| `description`  | What will be delivered.                                                            | No       | 2000                                                                                                                                                              |
| `kind`         | The kind of milestone.                                                             | Yes      | `construction` (something is built), `goods_delivery` (goods are delivered), `funds_handover` (money is handed over), `service` (a service is carried out)        |
| `dueDate`      | The date it is due.                                                                | Yes      | A real calendar date written `2026-12-18`, as a date input gives it. It is not compared with today's date.                                                        |
| `ownerKey`     | Who does the work: the `key` of a person below whose `role` is `third_party`.      | Yes      | A key from `people`                                                                                                                                               |
| `confirmerKey` | Who confirms it was done: the `key` of a person below whose `role` is `confirmer`. | Yes      | A key from `people`. Never the person who does the work on this milestone, and never someone with the same email address as that person (the checker's own rule). |

### `people`: who does the work and who confirms it

A list. **At most 20, with at least one `third_party` and at least one `confirmer`** (the
checker's own rules).

| Field                | What it is                                                                                           | Required                                                                                   | Limit or allowed values                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                | Your own short label for this person. See "Keys" below.                                              | Yes                                                                                        | 1 to 24 lower-case letters and digits                                                                                                                                            |
| `role`               | What they do in the campaign.                                                                        | Yes                                                                                        | `third_party` (a contractor or supplier who does the work) or `confirmer` (someone who confirms a milestone was done). Anything other than `confirmer` is read as `third_party`. |
| `name`               | The person's or organisation's name. Donors see it.                                                  | Yes                                                                                        | 200                                                                                                                                                                              |
| `title`              | What they do on the project: "Roofing contractor", "Head teacher".                                   | No                                                                                         | 200                                                                                                                                                                              |
| `email`              | Their email address. Only a sign-in with this address can accept their invitation. Never shown back. | Yes                                                                                        | Must be an email address                                                                                                                                                         |
| `relationship`       | **Confirmers only.** How they are related to the project. Donors see it.                             | Yes for a confirmer. Ignored for a `third_party`, who is always recorded as `participant`. | `participant` (takes part in the project, or is paid by it), `stakeholder` (benefits from it), `independent` (has no stake in it)                                                |
| `relationshipReason` | **Confirmers only.** Why, in a sentence. Donors see it.                                              | Only when `relationship` is `independent` (the checker's own rule)                         | 300                                                                                                                                                                              |

Two more rules about `independent`, both the checker's own: an independent confirmer cannot
have the organiser's email address, and cannot have the same email address as someone who
does the work.

### `schedule`: how often work is reported

| Field     | What it is                                        | Required | Allowed values                    |
| --------- | ------------------------------------------------- | -------- | --------------------------------- |
| `cadence` | How often the people doing the work report on it. | Yes      | One of the four in the next table |

| `cadence`      | Work is reported                                                              |
| -------------- | ----------------------------------------------------------------------------- |
| `weekly`       | Every week: one work report every 7 days.                                     |
| `fortnightly`  | Every two weeks: one work report every 14 days.                               |
| `daily`        | Every day.                                                                    |
| `days:mon,thu` | On chosen days of the week: here every Monday and Thursday. Any days you like |

Chosen days are written `days:` followed by one to seven of `mon`, `tue`, `wed`, `thu`, `fri`,
`sat` and `sun`, separated by commas with no spaces: `days:fri`, `days:mon,tue`,
`days:mon,tue,thu,sat`. They may be sent in any order and are stored Monday first. At least one
day is needed: `days:` alone is answered with "Choose at least one day of the week.", and a word
that is not one of the seven with "Choose days of the week from mon, tue, wed, thu, fri, sat and
sun."

A work report is due on each chosen day, and covers the days since the chosen day before it. A
day runs from midnight to midnight UTC, like every other date here.

### Keys

A `key` is a label the form makes up, such as `m1` or `p2`. It only ties a milestone to the
people **in the same request**, and names the field in an answer. It is not stored and is not
the campaign's, milestone's or person's real id: the server makes those.

- 1 to 24 characters, lower-case letters `a` to `z` and digits only. No spaces, hyphens or
  capitals.
- **Unique in the whole request**, across milestones and people together. Do not call a
  milestone `a1` and a person `a1`.
- **A milestone or person whose key is missing, wrong or already used is left out without a
  message.** If something you sent seems to have vanished, check its key.

### What the server does with what you send

- Anything it does not recognise is ignored. A missing part, or a value that is not a string,
  is read as empty, and the answer then says so if that field is required.
- Names and titles are trimmed, and runs of spaces become one. Email addresses are trimmed
  and lower-cased.
- A person who is in `people` but on no milestone is still created and still gets an
  invitation link.

## `POST /api/campaigns/check`: check without saving

Send the request above. The answer is always `200` when the request could be read:

```json
{
  "ok": false,
  "fields": {
    "project.title": "Give the project a name.",
    "milestones.m1.dueDate": "Choose the date this is due."
  },
  "notices": []
}
```

- `ok` is `true` when `fields` is empty.
- `fields` is every problem, by field. See "Showing `fields`" below.
- `notices` are warnings. See "Showing `notices`" below.

**One screen at a time.** Add `?step=` to hear about one part only:
`POST /api/campaigns/check?step=project`. The steps are `project`, `funding`, `milestones`,
`people` and `schedule`. `fields` then holds only that step's problems, and `ok` says whether
that step may continue, whatever is still missing elsewhere. Send the whole campaign so far
every time, not just that step's part. `notices` are not limited by the step.

The `people` step includes who does and who confirms each milestone (the `assign.…` fields),
so the `milestones` step passes before anyone has been chosen.

Any other `step` is refused: `400` with `"error": "invalid_step"`. A request that could not
be read is refused as listed under "The other refusals" below.

## `POST /api/campaigns`: check everything, then create

Send the request above.

### A complete example

```json
{
  "project": {
    "title": "Repair the clinic roof",
    "summary": "The storm lifted half the roof off Palm Point clinic.",
    "beneficiary": "The families of Palm Point",
    "creatorName": "Palm Point Health Committee",
    "creatorEmail": "committee@palmpoint.example"
  },
  "funding": { "goal": "8,500.50" },
  "milestones": [
    {
      "key": "m1",
      "title": "Roof replaced",
      "description": "New sheeting on the whole roof.",
      "kind": "construction",
      "dueDate": "2026-12-18",
      "ownerKey": "p1",
      "confirmerKey": "c1"
    },
    {
      "key": "m2",
      "title": "Medicines restocked",
      "description": "",
      "kind": "goods_delivery",
      "dueDate": "2027-01-15",
      "ownerKey": "p2",
      "confirmerKey": "c2"
    }
  ],
  "people": [
    {
      "key": "p1",
      "role": "third_party",
      "name": "Tradewind Roofing",
      "title": "Roofing contractor",
      "email": "jobs@tradewind.example",
      "relationship": "",
      "relationshipReason": ""
    },
    {
      "key": "p2",
      "role": "third_party",
      "name": "Island Pharmacy Supply",
      "title": "Medicine supplier",
      "email": "orders@islandpharm.example",
      "relationship": "",
      "relationshipReason": ""
    },
    {
      "key": "c1",
      "role": "confirmer",
      "name": "Marlon Reid",
      "title": "Parish building inspector",
      "email": "m.reid@parishcouncil.example",
      "relationship": "independent",
      "relationshipReason": "Employed by the parish council. Not paid by the project."
    },
    {
      "key": "c2",
      "role": "confirmer",
      "name": "Joy Baptiste",
      "title": "Clinic nurse in charge",
      "email": "joy@palmpoint.example",
      "relationship": "stakeholder",
      "relationshipReason": ""
    }
  ],
  "schedule": { "cadence": "weekly" }
}
```

### `201`: created

The answer also carries a `Location` header holding the campaign's `path`.

```json
{
  "campaign": {
    "id": "repair-the-clinic-roof-3f9a1c0b7d2e4a6f8b1c",
    "title": "Repair the clinic roof",
    "path": "/campaigns/repair-the-clinic-roof-3f9a1c0b7d2e4a6f8b1c",
    "invitations": [
      {
        "name": "Tradewind Roofing",
        "title": "Roofing contractor",
        "role": "third_party",
        "url": "https://app.tejido.net/invite/pty_0b6f3c1e-8a52-4d0e-9f37-2c1a5e7d9b40"
      },
      {
        "name": "Island Pharmacy Supply",
        "title": "Medicine supplier",
        "role": "third_party",
        "url": "https://app.tejido.net/invite/pty_5d2e9a71-3c46-4b8f-a1d0-7e9c2b4f6a13"
      },
      {
        "name": "Marlon Reid",
        "title": "Parish building inspector",
        "role": "confirmer",
        "url": "https://app.tejido.net/invite/pty_a47c1f08-6e2b-4d95-8c3a-1f0b9d7e5c62"
      },
      {
        "name": "Joy Baptiste",
        "title": "Clinic nurse in charge",
        "role": "confirmer",
        "url": "https://app.tejido.net/invite/pty_e19b6d34-0a7f-4c21-b5e8-3d6a2c8f1b97"
      }
    ]
  },
  "notices": [
    {
      "key": "m2",
      "kind": "no_independent_confirmer",
      "title": "Milestone 2 has no independent confirmer",
      "body": "That’s allowed. Donors will see Joy Baptiste’s confirmation as a stakeholder confirmation."
    }
  ]
}
```

(The ids above are made up. Real ones are random.)

- `campaign.path` is the campaign's own page on the Campaign Site. Add it to the site's
  address to make a link.
- `campaign.invitations` has one entry for each person, in the order they were sent. `url` is
  that person's own invitation link, on the App.

### `400 invalid_campaign`: something needs changing

Nothing was saved. `fields` and `notices` are what `check` answers.

```json
{
  "error": "invalid_campaign",
  "message": "Some answers are missing or need changing. Nothing was saved.",
  "fields": {
    "project.title": "Give the project a name.",
    "funding.goal": "Enter the goal as a number, such as 12,000 or 12000.50.",
    "people.c1.email": "Enter an email address, such as name@example.org.",
    "milestones.m1.dueDate": "Choose the date this is due.",
    "assign.m2.confirmer": "Island Pharmacy Supply does the work on this milestone, so someone else has to confirm it.",
    "schedule.cadence": "Choose how often work is reported."
  },
  "notices": []
}
```

### The other refusals

Every refusal has the same two parts: `error`, a fixed word the form can test for, and
`message`, a plain sentence. Test `error`, not the status number or the sentence.

| Status | `error`                  | When                                                                                                         | What the form should do                                          |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `400`  | `invalid_campaign`       | `POST /api/campaigns` only: the check found problems. Comes with `fields` and `notices`.                     | Show each problem at its field.                                  |
| `400`  | `invalid_body`           | The body is not JSON, is JSON but not an object (a list, a number, `null`), or is larger than 200,000 bytes. | This is a fault in the form, not in what the person typed.       |
| `400`  | `invalid_step`           | `check` only: `step` is not one of the five.                                                                 | A fault in the form.                                             |
| `415`  | `unsupported_media_type` | The `Content-Type` header is not `application/json`.                                                         | A fault in the form.                                             |
| `429`  | `too_many`               | `POST /api/campaigns` only: 20 campaigns were created in the last hour. Nothing was saved.                   | Keep what the person typed and ask them to try again in an hour. |

## Showing `fields`

`fields` is a list of problems. The name on the left says which field; the sentence on the
right is ready to show to the person as it is.

| Name                                                                                                     | Which field it is                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `project.title`, `project.summary`, `project.beneficiary`, `project.creatorName`, `project.creatorEmail` | That field of `project`.                                                  |
| `funding.goal`                                                                                           | The goal.                                                                 |
| `milestones.<key>.title`, `.description`, `.kind`, `.dueDate`                                            | That field of the milestone you sent with that `key`.                     |
| `milestones._`                                                                                           | The milestone list as a whole: there are none, or there are more than 20. |
| `people.<key>.name`, `.title`, `.email`, `.relationship`, `.relationshipReason`                          | That field of the person you sent with that `key`.                        |
| `people._`                                                                                               | The people list as a whole: there are more than 20.                       |
| `people.third_party`                                                                                     | Nobody does the work: show it where a contractor or supplier is added.    |
| `people.confirmer`                                                                                       | Nobody confirms: show it where a confirmer is added.                      |
| `assign.<milestone key>.owner`                                                                           | The "who does the work" choice of that milestone.                         |
| `assign.<milestone key>.confirmer`                                                                       | The "who confirms it" choice of that milestone.                           |
| `schedule.cadence`                                                                                       | How often work is reported.                                               |

`<key>` is always one of the keys from your own request, so the form can find the row by it.

Each field has at most one problem at a time. Fixing one can reveal another, so check again
after a change.

## Showing `notices`

A notice is something donors will see about the campaign, said to the organiser before they
do. **Show notices as warnings. They never stop a campaign being created**, and `ok` can be
`true` with notices present.

Each has `key` (the milestone or person it is about, from your request), `kind`, and a
`title` and `body` ready to show. There are two kinds:

| `kind`                     | About       | What it means                                                                                                                                                       |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no_independent_confirmer` | A milestone | Its confirmer is a participant or a stakeholder, not independent. Allowed; donors will see which.                                                                   |
| `independent_may_benefit`  | A person    | A confirmer marked independent has the organiser's name, or their name appears in "who it is for". The organiser should change it unless they really have no stake. |

## What happens after a campaign is created

- **It is a draft.** It is on no public list. It can be opened only by its link (`path`),
  and the link cannot be guessed: it ends in 20 random characters. Show the link, and tell the
  organiser to keep it.
- **The invitation links are answered once.** They are not shown again anywhere, and there
  is no way to ask for them again. **The form must show every invitation link**, with the
  person's name beside it, and should make them easy to copy.
- **Nobody has been emailed.** The organiser passes each link to its person themselves.
- **Sending the same campaign twice creates two campaigns.** Stop the button being pressed
  twice.

## What is not automatic

Creating a campaign does none of these. Each is a separate step:

- **Opening the campaign for giving.** It stays a draft until someone changes that.
- **The Qatom catalog items.** The items that donations, work logs and milestone claims are
  paid through do not exist yet for a new campaign.
- **Reminders.** `cadence` is recorded, but nothing is sent on that schedule.

## Trying it

With the site running locally (`npm run dev`), from a terminal. `campaign.json` is a file
holding the example request above.

```bash
curl -i -X POST 'http://localhost:5173/api/campaigns/check?step=project' -H 'Content-Type: application/json' --data @campaign.json
```

```bash
curl -i -X POST 'http://localhost:5173/api/campaigns' -H 'Content-Type: application/json' --data @campaign.json
```

The second one really creates a draft campaign in your local database.
