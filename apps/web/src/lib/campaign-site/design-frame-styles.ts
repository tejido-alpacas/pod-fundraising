/**
 * Switches design-frame.css on while a DesignFrame is on the page and off when the last one
 * leaves.
 *
 * A stylesheet the browser has loaded stays loaded when the visitor moves to another page
 * without a full reload. Left on, the design system's base rules (list bullets, margins, the
 * page background) would then restyle the first site's pages. Nothing is removed or fetched
 * again: the stylesheet is only disabled, so coming back shows the page at once.
 */

/** The selector of the rule that marks design-frame.css. */
export const FRAME_STYLES_MARKER = '.tj-frame-styles';

let frames = 0;

function frameSheets(): CSSStyleSheet[] {
	const found: CSSStyleSheet[] = [];
	for (const sheet of document.styleSheets) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			// A stylesheet from another origin (the fonts). Its rules cannot be read, and it is not ours.
			continue;
		}
		for (const rule of rules) {
			if (rule instanceof CSSStyleRule && rule.selectorText === FRAME_STYLES_MARKER) {
				found.push(sheet);
				break;
			}
		}
	}
	return found;
}

function apply(): void {
	for (const sheet of frameSheets()) sheet.disabled = frames === 0;
}

/** Call when a DesignFrame is created in the browser. Returns what to call when it is destroyed. */
export function holdFrameStyles(): () => void {
	frames += 1;
	apply();
	let released = false;
	return () => {
		if (released) return;
		released = true;
		frames -= 1;
		// Moving between two framed pages destroys one frame and creates the next in the same
		// turn. Waiting for the turn to end avoids switching the stylesheet off in between.
		queueMicrotask(apply);
	};
}
