# Managed agents and MCP Apps for the App's assistant

Research only. No code, setting or secret was changed, and nothing was called that costs money
or files a report. Written 15 November 2026. Every fact names its source: a file in this
repository, a file in Qatom's MCP server repository (`TODAQmicro/mcp`, which the owner let this
session read, at commit `5143e38` of 15 November 2026), or a page read that day. Statements that
could not be checked are marked **unverified** and listed again at the end.

## Summary

**A. Should the assistant become a managed agent? Not now. Try it after the hackathon, for one
reason only.**

- Today's assistant is already close to one. Anthropic already runs the tool calls for us; our
  server only relays text. Moving would not make the assistant smarter or cheaper.
- The one thing we would gain matters: **a real stop before money moves.** Today the rule "file
  only after the person says yes" is an instruction to the model and nothing else in our App
  enforces it. A managed agent can be set so every Qatom tool call pauses until our page sends
  an explicit allow. The review card would then show what is truly about to be filed, not the
  model's description of it.
- Each person's own Qatom sign-in is supported: one "vault" per person holds their token,
  Anthropic refreshes it, and the model never sees it. Two catches. Our sign-in client's secret
  would have to be stored at Anthropic, and only one side may refresh a Qatom token, so we
  would have to stop refreshing it ourselves. Whether Anthropic copes with Qatom's single-use
  refresh tokens is **unverified** and is what the experiment must settle.
- Cost is the same tokens plus about 8 US cents per hour of active running. It fits a
  Cloudflare Worker. It needs a new database table and two new settings.

**B. Can the filing tools carry MCP Apps? Yes, but on Qatom's server, and Qatom has to add it.**

- MCP Apps is a stable standard (26 January 2026). Claude on web, desktop and phones, ChatGPT,
  VS Code and others draw them.
- Qatom's MCP server already ships two MCP Apps (the checkout card and the account view). A
  campaign's two filing tools carry none: featured catalog items are registered as plain tools.
  Adding a card to them is a change in Qatom's code, not ours.
- Of our three pieces: the **review card** and the **guided form** can be MCP Apps. The **photo
  step** mostly cannot: Claude's phone apps give an MCP App no camera, and our upload endpoint
  only accepts a signed-in browser on our own site. In Claude, a person would be sent to our
  upload page by a link, as the assistant already asks today.
- A contractor can already connect Tejido's Qatom tools to Claude as themselves, and the
  deposit still comes from their own agent wallet. They lose our assistant's rules and must
  type their private filing code themselves.
- Our chat page could become an MCP Apps host. It is the most work of anything here and is not
  worth it until Qatom's cards exist.

**C. Together, in order.**

1. Now, no build: nothing. Keep the chat as it is for the demo.
2. Next (about three days, Track B plus one table): the hard stop before filing, by managed
   agent, after a one-day experiment on staging.
3. Then, a request to Qatom: a "review before you pay" card on every featured tool. That puts
   our review step into Claude and ChatGPT for free.
4. Last, only if contractors really file from Claude: guided form and upload as MCP Apps.

**What to do next:** decide whether a person on the team may run the staging experiment in
section A.6 (it uses the model, so it costs a few cents; it can be run so that no deposit
moves), and whether to raise section B.7's request with Qatom.

---

## A. Anthropic's Managed Agents

### A.1 What we do today

- `apps/app/src/lib/server/agent.ts` sends one request to the Messages API with the "MCP
  connector" turned on. The request carries the address of Tejido's Qatom MCP server and the
  signed-in person's access token (`authorization_token`). Anthropic's servers connect to Qatom
  and run every tool call inside that one request. Our loop only relays text and resumes a
  paused turn.
- The server keeps no conversation. The page sends the whole conversation each time
  (`apps/app/src/routes/api/chat/+server.ts`, top comment).
- The person's tokens are sealed per party in our database and refreshed by us
  (`apps/app/src/lib/server/person-tokens.ts`). The access token leaves our server once per
  reply, inside the request body to Anthropic.
- **The "yes" is not enforced by code in the App.** The instructions tell the model to show a
  review and wait (`agent.ts`, "Their say-so comes first"). The review card's button "files
  nothing by itself: it sends the person's yes into the conversation"
  (`apps/app/src/routes/chat/ReviewCard.svelte`). The MCP connector has no approval step of its
  own: Anthropic's page says the only per-tool controls are on/off and deferred loading, and
  suggests switching write tools off "when you want a human confirmation step"
  (https://platform.claude.com/docs/en/agents-and-tools/mcp-connector.md, read 15 Nov 2026).
- There is a second gate, on Qatom's side, that does not depend on the model: Qatom's MCP
  server asks the person to approve each purchase in their Qatom app or at a link, unless it is
  within the auto-approve limit they set (`TODAQmicro/mcp`, `src/approvals.ts` and
  `src/managed/tools.ts`). Our build plan tells filers to set that limit to 1.00 or more "so
  filing does not prompt" (`docs/build-plan.md`). With that advice followed, Qatom's gate does
  not ask, and the model's obedience is the only thing between a conversation and a deposit.

### A.2 What Managed Agents is, and how it differs

Sources: the `claude-api` skill's Managed Agents reference (cached 3 Nov 2026) and Anthropic's
pages under https://platform.claude.com/docs/en/managed-agents/ read 15 Nov 2026. It is in beta
(header `managed-agents-2026-04-01`).

| Question                    | Today (Messages API + MCP connector)                                     | Managed Agents                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the loop runs         | Anthropic runs the tool calls inside each request; we start each request | Anthropic runs the whole loop in a "session" that lives on their side                                                                              |
| State                       | None on any server; the page holds the conversation                      | The session keeps the full history until we delete it                                                                                              |
| Setup                       | Everything in each request                                               | An "agent" (model, instructions, tools) created once, an "environment" created once, then a session per conversation                               |
| MCP servers                 | Address and token in each request                                        | Address on the agent; the token in a per-person "vault" attached when the session is created                                                       |
| Approval before a tool runs | None                                                                     | Per tool: always allow, **always ask**, or let Anthropic judge. MCP tools default to always ask                                                    |
| Streaming                   | One response stream per request                                          | A long-lived event stream per session (`GET /v1/sessions/{id}/events/stream`); it needs our API key, so our server relays it to the browser as now |
| A dropped connection        | The reply is lost; we tell the person "ask whether it went through"      | The session carries on; we reconnect and read the history                                                                                          |
| Sandbox                     | None                                                                     | Every session gets a container whether we want one or not (`environment_id` is required)                                                           |

- **Cost.** Model tokens at the normal rates, plus $0.08 per session-hour, counted to the
  millisecond and only while the session is running. Waiting for the person, including waiting
  for a yes, is free. No separate container charge
  (https://platform.claude.com/docs/en/about-claude/pricing.md). For a chat that runs a few
  seconds per reply this is well under a cent per conversation.
- **Limits.** 300 create requests and 1,200 read requests per minute per organisation; 20
  credentials per vault; 20 MCP servers per agent. The container's saved state is kept 30 days.
  A session waiting for an approval waits indefinitely. Not available under zero data
  retention. No documented cap on concurrent sessions or number of vaults (**unverified**).
- **Per-person instructions.** Our instructions are rebuilt for every reply from the database
  (who the person is, their milestones). A session can replace the agent's instructions with
  its own (`agent_with_overrides`, skill reference "Override agent configuration for a
  session"), so this still works, but the facts are fixed when the session starts. A milestone
  that changes state mid-conversation would need a message telling the agent so.
- **Start-up time.** Not documented. **Unverified**; the experiment should measure it.
- **Model fallback.** Today's request asks for an automatic fallback model when the first one
  declines. Whether a session supports the same is **unverified**.

### A.3 The hard part: each person's own Qatom sign-in

**It can be done.** How, exactly:

1. One vault per party. Anthropic's page says a vault is "the collection of credentials
   associated with an end user" (https://platform.claude.com/docs/en/managed-agents/vaults.md).
2. In it, one `mcp_oauth` credential for the address of Tejido's Qatom MCP server, holding the
   person's access token, its expiry and a refresh block: Qatom's token endpoint, our sign-in
   client's id, the refresh token, the `resource` (the API reference lists it as an optional
   "OAuth resource indicator", which our sign-in needs: see `mcpResource` in
   `person-tokens.ts`), and how to authenticate to the token endpoint.
3. The session is created with that one vault's id. Anthropic's proxy adds the token to each
   call to Qatom after the request has left the model and the container. "Credentials are never
   placed in the sandbox", and the token is never in the conversation, so the model cannot read
   or repeat it. Secret fields are write-only: the API never returns them.
4. Anthropic refreshes the token before it expires, using the refresh block.

The catches:

- **Our sign-in client's secret goes to Anthropic.** Our client is confidential
  (`OIDC_CLIENT_SECRET`), so the refresh block must carry that secret
  (`client_secret_basic` or `client_secret_post`), once per credential. Today it never leaves
  our Worker. This is a decision for the owner, not a technical blocker.
- **Only one side may refresh.** Qatom honours a refresh token once (`person-tokens.ts`,
  comment on `usablePersonToken`). Once a person's tokens are in a vault, our own refresh must
  stop, or the two will invalidate each other and the person will be signed out of the chat.
- **Rotation is unverified.** Nothing Anthropic publishes says that a new refresh token
  returned by the token endpoint is stored in place of the old one. If it is not, the chat
  works until the first refresh and then fails. A failed refresh is reported by a webhook
  (`vault_credential.refresh_failed`).
- **Never shared between people** rests on our code attaching the right vault to the right
  person's session, exactly as it rests today on reading the right database row. One new
  exposure: vaults belong to the Anthropic workspace, and anyone with a developer role there
  can attach any vault to a session. Access to that workspace becomes as sensitive as access to
  our database.
- A vault can only be attached when a session is created, not later.

If the owner does not want the client secret at Anthropic, there is a second route that keeps
every token on our side: declare the two filing tools as "custom tools", which pause the
session and hand the call to our server, and have our server call Qatom's MCP server itself as
the person. That means writing an MCP client in the Worker, which we do not have today.

### A.4 The yes before filing

Three ways, strongest first.

1. **Tool permission set to always ask** (the default for MCP tools). When the model calls a
   Qatom tool, the session stops with "requires action" and gives us the tool's name and its
   exact inputs. Our page draws the review card from those inputs. "File this entry" sends
   `user.tool_confirmation` with allow; "Change something" sends deny with a message. Nothing
   reaches Qatom until allow is sent, whatever the model was told or tricked into. Read-only
   wallet questions can be set to always allow so they do not interrupt.
2. **Qatom's own approval** stays underneath, unchanged: the person's Qatom app or link, or
   their auto-approve limit.
3. **Our own gate with custom tools** (the second route in A.3): the same pause, but our server
   makes the call.

Do not use the third permission setting, "auto", for these tools. Anthropic's own page says it
"is not a human checkpoint".

One thing changes for the better: the review card would no longer be parsed from the model's
prose (`chatReview` in `apps/app/src/lib/chat.ts`). It would show the real call. The reporter
code is in those inputs and must be left out of what the page is sent.

### A.5 What we keep, delete and add

- **Keep:** the instructions' wording, the report form and its checks, the upload, the chat
  page, the line-by-line event format between our server and the page, the sealed sign-in at
  onboarding.
- **Delete or shrink:** the stream parser and the pause-and-resume loop in `agent.ts`; the
  review marker and its parser; sending the whole conversation from the page; our own token
  refresh for the chat.
- **Add:** a table mapping each party to a vault id and a session id (in `packages/db`, Track
  C, with a migration); two settings for the agent id and the environment id (in
  `packages/config`, a shared file); code that creates or updates a vault credential at
  sign-in and archives it at sign-out. No new secret, unless we take the refresh-failure
  webhook, which has a signing secret.
- **Cloudflare Worker:** it fits. Everything is `fetch` and a relayed stream, as now. The
  session outliving the Worker's request is an improvement.
- **If Anthropic is slow or down:** the same as today, since today's chat already depends on
  it. Filing through the App's chat stops; filing from another agent connected to Qatom still
  works. Two new failure points: session creation, and Anthropic's refresh of the person's
  token.

### A.6 Recommendation and the smallest experiment

**Move later.** Do not move during the hackathon: it touches the database, the shared
configuration and the sign-in, for no visible change in the demo. Move afterwards if the
experiment passes, because a stop that code enforces is worth more to this product than
anything else on this page. If the experiment fails on token refresh, build the same stop with
custom tools instead.

The experiment, about a day, on staging, run by a person (it uses the model, so it costs a few
cents, and this research was not allowed to run it):

1. Create one agent with only the Qatom MCP tools (no shell, no web), one environment with
   networking limited to MCP servers, and one vault holding a staging test party's tokens.
2. Ask a wallet question. This shows the connection works as that person with a token bound to
   the MCP server.
3. Ask it to file a work log. Check that the session pauses and shows the exact inputs. **Send
   deny.** No deposit moves. Check the model reports that nothing was filed.
4. Wait past the access token's expiry and ask again. This is the rotation test.
5. Note the time from sending a message to the first words of the reply.

---

## B. MCP Apps

### B.1 What it is today

Sources: the specification at
https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx,
the npm registry entry for `@modelcontextprotocol/ext-apps`, and Claude's connector
documentation under https://claude.com/docs/connectors/building/mcp-apps, all read 15 Nov 2026.

- **Status.** An official extension to MCP (SEP-1865, id `io.modelcontextprotocol/ui`), stable
  since 26 January 2026. The SDK is `@modelcontextprotocol/ext-apps`; the current release is
  2.0.4 (27 October 2026).
- **How a tool declares an interface.** The tool's description carries
  `_meta.ui.resourceUri`, pointing at a `ui://` resource on the same server. That resource is
  one HTML document of type `text/html;profile=mcp-app`. The resource can list the outside
  addresses it needs (`csp.connectDomains` and others) and ask for `camera`, `microphone`,
  `geolocation` or `clipboardWrite`. A tool can be marked visible to the model, to the app, or
  both.
- **How the host draws it.** In a locked-down frame on a separate origin, with no access to the
  host's page, cookies or storage. By default the frame can reach no network address at all.
- **How it talks back.** By messages to the host: it receives the tool's inputs and result; it
  can ask the host to call a tool on its own server (`tools/call`), put a message into the
  conversation (`ui/message`), update what the model knows (`ui/update-model-context`), or open
  a link (`ui/open-link`, which Claude confirms with the person first).
- **Which hosts.** The community support table ticks Claude on the web, Claude Desktop,
  ChatGPT, VS Code Copilot, Microsoft 365 Copilot, Goose, Cursor and others. Claude's help page
  says interactive connectors work for all users on Claude, Claude Desktop and Claude for iOS
  and Android
  (https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude).
  Claude Code shows the tool's text only. Details for hosts other than Claude are
  **unverified**: their own documentation could not be reached from this session.

### B.2 Whose server would carry them

Qatom's MCP server already uses MCP Apps. From `TODAQmicro/mcp`:

- It depends on `@modelcontextprotocol/ext-apps` (`^1.7.5`, an older major than today's 2.0.4)
  and registers a checkout card and an account view as `ui://` resources, with a second copy
  in ChatGPT's own format so one card works in both (`src/ui-compat.ts`,
  `src/checkout-ui.ts`, `src/managed/index.ts`).
- **A featured catalog item gets no interface.** It is registered with the plain
  `server.registerTool`, and its only `_meta` is the catalog item's id
  (`src/managed/tools.ts`, `syncCatalogTools`). The tool's name, description and inputs come
  from the catalog item; nothing in the item can name a card.
- Qatom's rule for its in-chat views is that they are self-contained and fetch nothing
  (`CLAUDE.md` in that repository, "In-chat views").

So there are three ways to get a card onto our two tools.

| Option                                                            | What changes                                                                                                                                                                         | For whom                                                   | Verdict                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **1. Qatom draws one generic card for every featured tool**       | Qatom's MCP server: register featured tools with a card that shows the item, its price and the inputs about to be sent. No change to payment, the dashboard or Tejido                | Every Qatom merchant gets it. We control none of its words | Smallest. Ask for this                                                        |
| **2. Qatom lets a merchant supply its own card per catalog item** | Qatom's payment API, dashboard and MCP server: a new field on the catalog item, carried to the server, and a security review, because a merchant's HTML would run under Qatom's name | Tejido gets its own form and review card on Qatom's server | Large, and it reverses Qatom's "self-contained, fetch nothing" rule. Not soon |
| **3. Tejido runs its own MCP server in front**                    | A new deployed service of ours with its own sign-in. To file, it would have to call Qatom as the person                                                                              | Us                                                         | See below. Not recommended                                                    |

Why not option 3. The stamp is a Qatom purchase by the person's own wallet. A Tejido server in
front would hold a token issued for itself, not for Qatom's server, and would need to exchange
it for one Qatom accepts. Qatom's payment API does token exchange for Qatom's own MCP server
(`TODAQmicro/mcp` `CLAUDE.md`, "Payment auth"); whether it would for a client of ours is
**unverified** and would be a Qatom change. Passing the person's token straight through is
what the MCP rules forbid. It would also break two of our own rules: `docs/architecture.md`
says "We do not change any Qatom code" and uses Qatom's server as it is, and `CLAUDE.md` says
all Qatom calls go through `packages/qatom`. A lighter form exists, a Tejido server that only
draws the form and the review and never files, with the person connecting both servers; the
card's button would put "Yes, file this entry" into the conversation and the model would call
Qatom's tool. It works in principle but leaves the yes resting on the model again.

### B.3 A point that shapes all three pieces

An MCP App is drawn when its tool is called. A card attached to the filing tool itself appears
as the filing happens, not before it. A review **before** filing therefore needs either a
separate free tool whose card is the review, or the host's own approval prompt. Claude shows
its own approval prompt for a connector's tool before running it, with the inputs, unless the
person has chosen "always allow" (support article above). And Qatom's own approval comes after
that.

Claude's help page also says purchases inside in-chat views are not supported. Whether that
covers a card's button that calls a paid tool is **unverified**. The safe design, and the one
our own review card already uses, is that the button sends the person's yes into the
conversation and does not file by itself.

### B.4 Our three pieces

| Piece                 | As an MCP App?                                                                                                               | What it cannot do in a host                                                                                                                                                                                                                                                                                                                           | In Claude                                                                                                                                                       | In our App                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Review card**       | Yes. It only displays inputs and a deposit line                                                                              | It cannot be the gate. The gate is the host's approval and Qatom's                                                                                                                                                                                                                                                                                    | Claude's own approval prompt, then (with option 1) Qatom's card with the inputs                                                                                 | Our card, as now; with section A, drawn from the real call |
| **Guided form**       | Yes. Fields, checks and a send button work in the frame; the result goes back with `ui/update-model-context` or `ui/message` | It cannot read our database. Milestones and rules must arrive in the tool's inputs or result. Our checks (`report-form.ts`) would have to be repeated inside the card                                                                                                                                                                                 | Only with option 2 or 3. Otherwise the model asks question by question                                                                                          | Our form, as now                                           |
| **Photo and SHA-256** | Mostly no                                                                                                                    | Camera: none on Claude's phone apps ("Apps on mobile have no camera, microphone, or location access"), optional elsewhere. Choosing a file from the device: **unverified**. Upload: our endpoint wants our own session cookie and refuses posts from another origin (`apps/app/src/routes/api/evidence/+server.ts`), and a card in Claude has neither | A link to our upload page, opened by the host; the person signs in there, uploads, and pastes back the address and fingerprint. This works today with no change | Camera and file buttons in the page, as now                |

To make upload work from inside a card we would have to build a second way into the evidence
endpoint: a short-lived upload ticket handed out by a tool, and permission for the host's card
origin (for Claude, a `claudemcpcontent.com` address) to post to us. That is a change to how
evidence is authorised and should be decided by the team, not slipped in. The fingerprint is
computed by our server from the bytes it stored (`apps/app/src/lib/server/evidence.ts`), and
that should stay so: a fingerprint computed in someone else's frame proves less.

Contractors use phones in the field (`docs/design-system/README.md`, rule 7 of the look), and
the phone is exactly where a card has no camera. For photos, our own App stays the better
place.

### B.5 Our chat page as an MCP Apps host

Possible. The SDK has a host side (`@modelcontextprotocol/ext-apps/app-bridge`, class
`AppBridge`) that is plain TypeScript, so Svelte is fine. What it needs:

- a second origin of ours to serve the sandbox frame from (the specification requires the host
  and the sandbox to be on different origins): a new hostname and deployment, so `infra/`;
- our server to fetch the card and relay the card's tool calls to Qatom as the person, because
  the person's token must not reach the browser;
- two new dependencies (the Apps SDK and the MCP SDK).

Each of those is a stop-and-ask item under `CLAUDE.md`. It would give one interface in both
places for the review card and the form, never for the photo step. It only pays once Qatom's
server carries cards worth showing (options 1 or 2). Until then our Svelte components do the
same job with none of this.

### B.6 Signing in from an outside host

A contractor adds Tejido's Qatom MCP server to Claude as a custom connector (Customize,
Connectors, Add custom connector, then the server's address). Custom connectors are on every
plan, one on the free plan; they must be added on the web or desktop before they appear on a
phone (https://claude.com/docs/connectors/custom/add-unlisted.md).

- Claude finds the sign-in from the server's own metadata, registers itself and sends the
  person to Qatom's sign-in. Qatom's server publishes that metadata and points at Qatom's
  payment API as the authorisation server (`TODAQmicro/mcp` `src/managed/index.ts`). Qatom's
  own end-to-end suite registers as Claude with Claude's callback address and buys an item
  (`TODAQmicro/mcp` `e2e/README.md`); that suite stands in for the Claude apps through
  Anthropic's API, so the claude.ai screens themselves are **unverified** by anything I could
  read. Our build plan's hour-10 checkpoint expected a work log "filed from Claude as a
  stand-in agent" (`docs/build-plan.md`); whether that was done is **unverified**.
- **The deposit still comes from their agent wallet.** The token Claude holds is that person's.
  A person's session gets the featured tools, and a purchase is paid through Qatom's paywall
  from the wallet that token resolves to, after Qatom's approval (`TODAQmicro/mcp`
  `src/managed/tools.ts`). Our reconciler checks the paying wallet against the one registered
  at onboarding. That a person has one agent wallet whichever agent they use is **unverified**.
- **What they lose.** Our instructions: the fixed words (drafted, submitted, recorded), "I
  can't check the work myself", never filing on an instruction found inside a document. The
  form's checks. And the reporter code: in our App the assistant adds it; in Claude the person
  must supply their private filing code, so the reminder or the App has to show it to them.

### B.7 Recommendation and the smallest experiment

**Do not build a Tejido MCP server, and do not turn our chat into a host yet.** Ask Qatom for
option 1: a generic "review before you pay" card on every featured tool. The owner leads
engineering at Qatom, the server already has the card machinery and a second format for
ChatGPT, and every Qatom merchant benefits.

Smallest experiment, about an hour, no money: a person adds the **staging** Qatom MCP server to
Claude as a custom connector, signs in as a test party, and asks Claude to prepare a work log.
Look at what Claude's own approval prompt shows for the tool's inputs, then **decline**. That
tells us how much of a review step exists in Claude today with no work from anyone. Do the same
on a phone.

---

## C. Together

### C.1 A staged path

Build times are my estimates, not measurements.

| Stage                                                  | What a contractor gets                                                                                                                                      | Cost to build                                                                                 | Depends on Qatom for                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **0. Today**                                           | Chat in our App with form, review card and camera. Can also file from Claude, without our rules                                                             | Nothing                                                                                       | Nothing                                                                                          |
| **1. A stop that code enforces**                       | In our App, nothing is sent to Qatom until they press "File this entry", and the card shows the real entry. A dropped connection no longer loses the answer | 1 day experiment, then about 3 days in Track B, a table (Track C) and two settings (shared)   | Nothing to change. Needs Qatom's refresh tokens to work with Anthropic's vault                   |
| **2. Qatom's review card on featured tools**           | In Claude and ChatGPT, a Qatom-drawn card showing what is about to be filed and the deposit                                                                 | None for us. For Qatom, a change in one repository, a few days with tests                     | Qatom building it                                                                                |
| **3. Form and upload as MCP Apps; our chat as a host** | The same guided form in Claude and in our App                                                                                                               | Weeks: Qatom option 2 or a Tejido server, an upload ticket, a second origin, new dependencies | A per-item card field across payment, dashboard and MCP server, or token exchange for our client |

Stages 1 and 2 are independent and can go in either order. Stage 3 should wait for evidence
that contractors file from Claude at all.

### C.2 Risks to the trust model

The rules are in `docs/design-system/README.md` ("The rules that matter most") and the
assistant's instructions in `agent.ts`.

- **A filing only after an explicit yes.** The weakest point today (A.1), and the build plan's
  advice to raise the auto-approve limit removes Qatom's own stop. Stage 1 fixes it inside our
  App. Outside our App it rests on the host's prompt, which a person can set to "always allow",
  and on Qatom's approval. Never build a card whose button calls the paid tool directly, and
  never use the "auto" permission for filing tools.
- **The three layers never merged.** A card drawn by Qatom (stage 2) is a payment receipt in
  Qatom's words and look. It shows that a filing was paid for. It must not be read as "the
  milestone is confirmed". In our own page it would sit next to our status badges, so if we
  ever host it, it goes in the "recorded" layer only. A generic card cannot say "I can't check
  the work myself"; ours does.
- **Nothing claimed that was not recorded.** Our instructions tie each word to a fact (a tool
  answered, the answer said accepted). In Claude, another model with other instructions may say
  "filed" early or "verified" loosely. A managed-agent session helps inside our App: the tool's
  real result is in the session history, so the page can show "Recorded" from the result and
  not from the model's sentence.
- **Who filed.** Unchanged in every stage, as long as the call is made with the person's own
  token and paid from their own agent wallet. A Tejido server in front (B.2, option 3) is the
  one design here that puts this at risk, which is the main reason to avoid it.
- **The two Qatom identities.** Nothing here uses the merchant account. A vault holds only a
  person's token. Storing `OIDC_CLIENT_SECRET` in a vault keeps it on the person side, but it
  is a secret of ours held by a third party, and `CLAUDE.md` makes any change to where a secret
  lives a decision for a person.
- **Evidence.** An upload path for cards would be a second door into evidence storage. The
  check-in endpoint's rule that every photo address points at our own storage and matches the
  stored hash must hold whichever door was used.

---

## Sources

In this repository:

- `apps/app/src/lib/server/agent.ts`, `apps/app/src/routes/api/chat/+server.ts`,
  `apps/app/src/lib/chat.ts`, `apps/app/src/lib/chat-upload.ts`,
  `apps/app/src/routes/chat/ReviewCard.svelte`, `apps/app/src/routes/chat/+page.svelte`,
  `apps/app/src/routes/chat/ReportForm.svelte`
- `apps/app/src/lib/server/person-tokens.ts`, `packages/qatom/src/person/index.ts`
- `apps/app/src/routes/api/evidence/+server.ts`, `apps/app/src/lib/server/evidence.ts`
- `docs/architecture.md`, `docs/build-plan.md`, `docs/design-system/README.md`, `CLAUDE.md`,
  `.env.example` (names only)

In `TODAQmicro/mcp` at commit `5143e38` (15 Nov 2026): `CLAUDE.md`, `package.json`,
`src/managed/tools.ts`, `src/managed/index.ts`, `src/managed/types.ts`, `src/approvals.ts`,
`src/ui-compat.ts`, `e2e/README.md`.

Read on the web on 15 Nov 2026:

- Managed Agents: https://platform.claude.com/docs/en/managed-agents/overview.md and its
  sibling pages `sessions`, `events-and-streaming`, `permission-policies`, `vaults`,
  `mcp-connector`, `environments`, `quickstart`, `reference`;
  https://platform.claude.com/docs/en/api/beta/vaults/credentials/create.md;
  https://platform.claude.com/docs/en/api/beta/sessions/create.md and `update.md`;
  https://platform.claude.com/docs/en/about-claude/pricing.md;
  https://platform.claude.com/docs/en/api/rate-limits.md
- Messages API MCP connector: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector.md
- The `claude-api` skill's Managed Agents reference files, cached 3 Nov 2026
- MCP Apps specification (stable, 2026-01-26):
  https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx
- MCP Apps overview and client table:
  https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/extensions/apps/overview.mdx
  and `docs/extensions/client-matrix.mdx` in the same repository
- https://registry.npmjs.org/@modelcontextprotocol/ext-apps
- https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- https://apps.extensions.modelcontextprotocol.io/api/classes/app-bridge.AppBridge.html and
  https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/examples/basic-host/README.md
- Claude's connector documentation: https://claude.com/docs/connectors/building/mcp-apps (pages
  `design-guidelines`, `embedded-sites`, `getting-started`, `troubleshooting`,
  `external-links`, `download-files`, `app-tools`, `quickstart`),
  https://claude.com/docs/connectors/building/authentication.md,
  https://claude.com/docs/connectors/custom/add-unlisted.md,
  https://claude.com/docs/connectors/getting-started.md
- https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude and
  https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp

## What I could not verify

1. Whether Anthropic's vault stores a rotated refresh token. Qatom's are single-use, so this
   decides whether section A works at all without custom tools.
2. Whether Qatom's token endpoint accepts a refresh made by Anthropic's servers with our client
   id, secret and `resource`. Nothing suggests it would not; it was not tried.
3. How long a managed-agent session takes to start and to give its first words.
4. Whether a managed-agent session supports the automatic fallback model our request uses now.
5. Any cap on concurrent sessions or on the number of vaults.
6. Whether a card in Claude can open the device's file chooser or camera through an ordinary
   file button. Claude's page says phone cards have no camera; nothing I read covers a file
   button.
7. Whether a tool call started by a card's button in Claude asks the person first, and whether
   "purchases inside in-chat views are not supported" covers a paid tool call.
8. How ChatGPT, VS Code, Goose and Cursor behave beyond being ticked in the support table.
   Their documentation, and modelcontextprotocol.io itself, could not be reached from this
   session; the MCP pages were read from their source on GitHub.
9. That adding Tejido's Qatom server to the Claude apps works end to end. Qatom's test suite
   covers it through Anthropic's API, not the apps' own screens. Whether the team's hour-10
   checkpoint did it is not recorded in this repository.
10. That a person has a single agent wallet whichever agent they connect from.
11. Whether Qatom's payment API would exchange a token for a client of Tejido's (needed only by
    the option this report advises against).
12. Nothing here was run against Anthropic or Qatom. Every statement about how the two would
    behave together is from reading, not from a test.
