# ChatMessage

The parts of the field app conversation: the person, the assistant, its working state, tool results and errors.

- **Person:** right-aligned, `accent-subtle`. **Assistant:** left-aligned on `surface`, labelled "Tejido assistant" with the weave mark. It has no persona or avatar face.
- **Working:** three pulsing dots plus words ("Checking your milestones…").
- **Tool result:** a line stating what the system did, in exact verbs: drafted, uploaded, submitted, recorded, confirmed. Tone follows the state.
- **Error:** critical bubble saying what didn't happen and what's still safe ("nothing was filed. Your draft is saved on this phone.") with **Try again**.
- The assistant never claims to verify physical work. When it presents an entry, it names who will confirm it.
