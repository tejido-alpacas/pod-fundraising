<!--
  HowProofWorks: the three layers of proof, one line each. The same words wherever it appears.

  <HowProofWorks id="how" />
-->
<script lang="ts">
	import { Icon } from '@tejido/ui';

	let { id }: { id: string } = $props();
</script>

<section class="tj-how" aria-labelledby={id}>
	<h2 class="tj-how__title" {id}>How proof works on Tejido</h2>
	<ol>
		<li>
			<Icon name="receipt-check" />
			<p>
				<strong>Every update is filed with a receipt</strong>
				The receipt shows who filed it and when. It doesn’t prove the work happened.
			</p>
		</li>
		<li>
			<Icon name="image" />
			<p>
				<strong>Evidence is attached</strong>
				Photos and documents carry a file fingerprint, so they can’t be swapped later.
			</p>
		</li>
		<li>
			<Icon name="users" />
			<p>
				<strong>Someone named in advance confirms</strong>
				Each milestone has a confirmer. We show how they relate to the project.
			</p>
		</li>
	</ol>
</section>
