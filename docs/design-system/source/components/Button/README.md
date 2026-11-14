# Button

Actions, in four variants: primary, secondary, quiet and destructive.

- **Primary** (`tj-btn--primary`, `accent`): the one thing the view is for. At most one per view, for example *Contribute*, *File this entry* or *Confirm milestone 3*.
- **Secondary** (`tj-btn--secondary`): real alternatives such as *Ask a question*, *Save draft* or *Retry*.
- **Quiet** (`tj-btn--quiet`): low-emphasis actions such as *Change something*, *Skip* or *This isn't me*.
- **Destructive** (`tj-btn--destructive`, `critical`): actions that lose data, such as *Discard draft* or *Remove file*. Not for declining a milestone, which is a normal choice and uses secondary.
- **Sizes:** default `size-control` (40px) on the public site, `tj-btn--field` (48px) in the field app, and `tj-btn--sm` (32px tall with a 44px hit area) inside cards and banners. `tj-btn--block` for full-width phone actions. `tj-btn--icon` for 44px icon buttons, which need `aria-label`.
- **States:** hover and pressed darken (primary, destructive) or tint (`state-hover`, `state-pressed`). Focus-visible draws the 2px `focus-ring` with a 2px offset. Disabled uses `disabled-*`, never opacity. Loading sets `aria-busy="true"`, shows a spinner and changes the label to the present participle ("Filing…"). There is no success state on the button: success is shown by the result, after acknowledgement.
- **Labels** are verbs in sentence case that name the outcome. Don't use "OK", "Submit" or "Click here".
