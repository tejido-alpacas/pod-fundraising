<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const CADENCE = { weekly: 'every week', fortnightly: 'every two weeks' } as const;

	const day = (date: string) =>
		new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});

	const milestones = $derived(data.viewer === 'party' ? data.milestones : []);
	/** What this person has to do themselves, soonest first. */
	const toDo = $derived(
		milestones.filter((milestone) => milestone.step === 'claim' || milestone.step === 'confirm')
	);
	const rest = $derived(
		milestones.filter((milestone) => milestone.step === 'waiting' || milestone.step === 'done')
	);
</script>

<svelte:head><title>Tejido</title></svelte:head>

{#if data.viewer === 'signed_out'}
	<article>
		<h1>Show donors the work is being done</h1>
		<p class="lede">
			Tejido is where the people named on a funded campaign report on their work. Contractors and
			suppliers log what they have done and say when a milestone is finished, and an independent
			confirmer signs it off.
		</p>

		<section class="card">
			<h2>Have an invitation?</h2>
			<p>
				Open the link in the invitation you were sent. It shows your campaign and signs you in to
				it. Use that link each time you sign in, so we know which campaign you are on.
			</p>
		</section>

		<section class="card">
			<h2>Already have a Qatom account?</h2>
			<p>
				You can sign in with it here. To file reports you also need an invitation to a campaign.
			</p>
			<p class="actions"><a class="button" href="/auth/sign-in">Sign in with Qatom</a></p>
		</section>
	</article>
{:else if data.viewer === 'no_party'}
	<article>
		<h1>You are not on a campaign yet</h1>
		<p class="lede">
			You are signed in as {data.email}, but this sign-in is not connected to a campaign, so there
			is nothing for you to report on.
		</p>
		<section class="card">
			<h2>What to do</h2>
			<p>
				Open the link in the invitation you were sent and sign in from that page. That connects you
				to your campaign. If you have no invitation, ask the person running the campaign to send you
				one, to the email address you use with Qatom.
			</p>
		</section>
	</article>
{:else}
	{@const { party, campaign } = data}
	<article>
		<p class="eyebrow">Your campaign</p>
		<h1>{campaign.title}</h1>
		<p class="lede">
			You are signed in as {party.name}{#if party.title}&nbsp;({party.title}){/if}.
			{#if party.role === 'confirmer'}
				You sign a milestone off once you have seen it is done.
			{:else}
				You log your work {CADENCE[campaign.cadence]} and say when a milestone is done.
			{/if}
		</p>

		{#if !party.walletsLinked}
			<section class="card warn">
				<h2>Finish connecting your Qatom wallets</h2>
				<p>
					Your wallets are not connected to this campaign yet, so you cannot file a report. Sign in
					once more to connect them. No money moves when you sign in.
				</p>
				<p class="actions">
					<a class="button" href="/auth/sign-in?party={party.id}">Sign in with Qatom</a>
				</p>
			</section>
		{/if}

		{#if data.incompleteReports > 0}
			<section class="card warn">
				<h2>
					{data.incompleteReports === 1
						? 'One of your reports is incomplete'
						: `${data.incompleteReports} of your reports are incomplete`}
				</h2>
				<p>Something was missing when it arrived. You can add it now, without paying again.</p>
				<p class="actions"><a class="button" href="/fix">Add what is missing</a></p>
			</section>
		{/if}

		<section class="card">
			<h2>Due next</h2>
			{#if toDo.length === 0}
				<p>
					No milestone is waiting on you right now.
					{#if party.role === 'third_party'}
						Your regular work log is still due {CADENCE[campaign.cadence]}.
					{/if}
				</p>
			{:else}
				<ul class="due">
					{#each toDo as milestone (milestone.id)}
						<li>
							<strong>{milestone.title}</strong>
							{#if milestone.step === 'confirm'}
								<span>This has been reported as done. It is waiting for you to confirm it.</span>
							{:else if milestone.overdue}
								<span class="late">Was due {day(milestone.dueDate)}. Report on it now.</span>
							{:else}
								<span>Due {day(milestone.dueDate)}. Report when it is done.</span>
							{/if}
						</li>
					{/each}
				</ul>
				{#if party.role === 'third_party'}
					<p class="small">A work log is also due {CADENCE[campaign.cadence]} until then.</p>
				{/if}
			{/if}
			<p class="actions">
				<a class="button" href="/chat">File a report</a>
				<a class="button quiet" href="/upload">Upload photos and documents</a>
			</p>
			<p class="small">
				Filing a report is a conversation: you say what was done, check the report, and it is filed
				only when you say yes.
			</p>
		</section>

		{#if rest.length > 0}
			<section class="card">
				<h2>Your other milestones</h2>
				<ul class="due">
					{#each rest as milestone (milestone.id)}
						<li>
							<strong>{milestone.title}</strong>
							<span>
								{#if milestone.step === 'done'}
									Confirmed. Finished.
								{:else if milestone.part === 'owes'}
									You reported this as done. It is waiting to be confirmed.
								{:else}
									Not reported as done yet. Due {day(milestone.dueDate)}. You confirm it after it
									is.
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<p class="small">Signed in with the Qatom account {data.email}.</p>
	</article>
{/if}

<style>
	article {
		max-width: 44rem;
	}
	.lede {
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.25rem 1.25rem 1rem;
		margin: 1.25rem 0;
	}
	.card.warn {
		border-left: 4px solid var(--warn);
	}
	.card h2 {
		margin-top: 1rem;
		margin-bottom: 0.4rem;
	}
	.card p {
		margin: 0.4rem 0;
	}
	.due {
		list-style: none;
		padding: 0;
		margin: 0.75rem 0;
		display: grid;
		gap: 0.75rem;
	}
	.due span {
		display: block;
		font-size: 0.95rem;
		color: var(--muted);
	}
	.due .late {
		color: var(--warn);
		font-weight: 600;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 1rem 0 0.6rem;
	}
	.button {
		display: inline-flex;
		align-items: center;
		background: var(--a);
		color: var(--surface);
		font-weight: 600;
		text-decoration: none;
		padding: 0 1.1rem;
		border: 1px solid var(--a);
		border-radius: 6px;
	}
	.button.quiet {
		background: var(--surface);
		color: var(--ink);
		border-color: var(--line);
	}
	.small {
		font-size: 0.9rem;
		color: var(--muted);
		overflow-wrap: anywhere;
	}
</style>
