/** The element id of a field, from its name in the draft: `people.k1.email` is `people-k1-email`. */
export function fieldId(name: string): string {
	return name.replaceAll('.', '-').replaceAll('_', 'all');
}
