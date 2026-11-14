# StatusMatrix

The full trust vocabulary on one sheet: every state in all five layers, with its label, shape, tone and the sentence that explains it.

- Use it as the reference when you add a state. A new state needs all five parts (label, shape, tone, sentence, screen-reader layer name). It's shown in light, the primary theme, and must keep its meaning in the secondary dark theme too (see `ScreenDarkMode` and the contrast audit).
- The vocabulary lives in `svelte/states.ts` (`STATES`). Components read from it and never invent their own labels.
