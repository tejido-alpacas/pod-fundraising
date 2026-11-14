# Working with your agent

For the three of us, not for the agents. You do not need to read code to keep your agent on
track. You need to know what to ask for, what a good answer looks like, and when to stop it.

The agents' own rules are in [`CLAUDE.md`](../CLAUDE.md) (`AGENTS.md` is the same file). They
read it at the start of every session.

## Branches, pull requests and checks, in plain words

You do not have to run any of this yourself. Your agent does it. You only need the picture.

- **`main`** is the one shared, official copy of the project. It is what gets deployed and what
  the other two build on. If `main` breaks, all three of us are stuck.
- **A branch** is a private copy where your agent makes its changes. Nothing on a branch affects
  anyone else. Your agent makes a new one for every task.
- **A worktree** is a separate folder on your computer for that branch, so two tasks never trip
  over each other. Your agent sets it up and removes it afterwards.
- **A pull request** (PR) is the proposal to copy a branch's changes into `main`. It is a page on
  GitHub that shows what changed and whether the checks passed. Your agent opens it and gives
  you the link.
- **The checks** (also called CI) are four automatic tests GitHub runs on every pull request. On
  the pull request page each shows a green tick, a red cross, or a yellow dot while it is still
  running.
- **Merging** is pressing the button that copies the changes into `main`. From that moment
  everyone has them.

**The one rule that is ours to keep.** GitHub will let anyone merge at any time; we are not on
a plan that can lock it. So: **never merge unless every check has a green tick.** Not on red,
not on yellow, not "it's a tiny change". Your agent has been told to refuse, too.

What you say to your agent, in order:

1. "I'm on Track B. Make the invite page show the party's name." It makes a branch and builds.
2. "Open a pull request." It sends you a link. Open it and look for the ticks.
3. "Are the checks green?" If not, "Fix what is failing." It should fix the cause, never
   switch the check off.
4. Open the page yourself and see the change work.
5. "Merge it." It merges, then tidies up the branch.

## Asking for something

- **Start by naming your track.** "I'm on Track B, the App." The agent then knows which
  folders are yours.
- **One thing per request.** "Make the invite page show the party's name" is good. "Finish the
  App" is not. Small requests come back working; big ones come back almost working.
- **Say what you want to see, not how to build it.** "When I open the campaign page I should
  see each milestone and who confirmed it."
- **Start a fresh session for a fresh task.** Long sessions drift.

## What a good answer looks like

At the end, your agent should tell you, in plain words:

1. What works now, and where to look.
2. Which files it changed. They should all be in your track's folders.
3. That the four checks passed: typecheck, lint, test, build.
4. What it did not do, and anything it guessed.

If any of those is missing, ask for it: "Which checks did you run, and did they pass?"

## When your agent stops and asks

That is the rules working. It has been told to stop rather than push on when a task needs
something outside your track. What to do:

| It says it needs                              | What to do                                                  |
| --------------------------------------------- | ----------------------------------------------------------- |
| A change to "contracts" or a shared file      | Ask the other two. All three agree, or it does not happen   |
| A file in another track's folder              | Ask that track's owner to make the change                   |
| A new dependency or package                   | Ask the team. Usually the answer is no                      |
| A new configuration value or secret           | Ask the team. Everyone's setup has to change                |
| Something in `infra/` or to do with deploying | Ask whoever looks after the infrastructure                  |
| To delete data or reset the database          | Fine locally if you do not mind losing your test data       |
| Help, because the same fix failed twice       | Read what it tried. Rephrase the request, or ask a teammate |

## Say no to these

Your agent should never suggest them. If it does, say no and tell the team.

- Deploying, or running anything against the live site or live database.
- Pushing straight to `main`, or "force" pushing.
- Merging while a check is red or still running.
- Skipping, deleting or "temporarily disabling" a test or a check to get past an error.
- You pasting a password, key or token into the chat.
- Sending or refunding money to "check that it works".
- A fake or "mock" Qatom.

## Signs it is going wrong

- It has tried to fix the same error three or more times.
- It is changing many files for a small request.
- It is changing files outside your track's folders.
- It says something is done but will not say the checks passed.
- It wants to install things or change settings to get unstuck.

**What to do:** stop it. Tell it: "Stop. Do not change anything else. Tell me what you have
changed so far and what is failing." If the answer does not make sense to you, tell it:
"Discard all your uncommitted changes," and start a new session with a smaller request. Losing
twenty minutes of an agent's work costs less than untangling it later.

## Before you say "merge it"

- There is a pull request, and you have its link.
- Every check on that page has a green tick. Scroll to the bottom of the pull request to see
  them.
- The files changed are in your track's folders, or the team agreed to the ones that are not.
  The pull request's "Files outside my track" section should say "None".
- You opened the page and saw it work yourself.

If a merge does break `main`, tell the team straight away. On the merged pull request's page
there is a "Revert" button that opens a new pull request undoing it; ask your agent to do
that.
