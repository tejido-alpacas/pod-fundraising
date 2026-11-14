/**
 * The rules of a check-in that a schema cannot express. Track C owns them.
 *
 * The rules themselves are in packages/db/src/checkin-rules.ts, unchanged. They moved there so
 * the App's "fix an incomplete entry" page can apply the very same rules when evidence is
 * added later: the two apps never import from each other, and both import @tejido/db. This
 * file passes them on, so everything in the Campaign Site imports them as before.
 */
export {
	decideCheckin,
	describeAccepted,
	type AcceptedFacts,
	type CheckinDecision,
	type CheckinFacts,
	type CheckinRefusal
} from '@tejido/db';
