<!--
  FieldError: what is wrong with one field and what to do, under the field.

  <FieldError id="project-title-err" message={errors['project.title']} />
-->
<script lang="ts">
	import { Icon } from '@tejido/ui';

	let { id, message = undefined }: { id: string; message?: string | undefined } = $props();
</script>

{#if message}
	<p class="tj-error" {id}><Icon name="alert-circle" />{message}</p>
{/if}
