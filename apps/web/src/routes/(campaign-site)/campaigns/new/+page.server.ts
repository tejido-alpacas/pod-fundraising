// The campaign builder at /campaigns/new. Track A owns this file.
//
// The builder is Matthew's (#37, #38): its steps, its checks and how it creates a campaign. It
// first went live at /old/campaigns/new. This address serves the same server actions, so there
// is one builder to keep right: "Continue" checks a step and "Create campaign" checks the whole
// draft and writes it, exactly as there. Nothing here calls Qatom or moves money.
export { actions } from '../../../old/campaigns/new/+page.server.ts';
