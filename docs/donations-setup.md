# Setting up donations in Qatom

For the person who looks after Tejido's Qatom merchant account. Do this once. After it, every
campaign that is raising money can take donations; nothing is set up per campaign and nothing is
copied into Tejido.

## What you are creating

One catalog item for each amount a donor can give. Campaigns share them: the item says how
much, and Tejido tells Qatom which campaign each donation is for.

We suggest four, to start:

| Name               | Price (USD-TDN) | External endpoint                              |
| ------------------ | --------------- | ---------------------------------------------- |
| Tejido donation 5  | 5               | `https://<the Campaign Site>/api/donations/5`  |
| Tejido donation 10 | 10              | `https://<the Campaign Site>/api/donations/10` |
| Tejido donation 25 | 25              | `https://<the Campaign Site>/api/donations/25` |
| Tejido donation 50 | 50              | `https://<the Campaign Site>/api/donations/50` |

`<the Campaign Site>` is the hostname donors open, the same one as in the site's sign-in
callback (`WEB_OIDC_REDIRECT_URI`). Not the App's.

## For each item

Create it on Tejido's merchant account, the same way as the two filing items.

1. **A twin and a commodity of its own**, priced at the amount. Qatom keeps one price per twin,
   so each donation item needs its own twin.
2. **Price**: a whole number, 1 or more. No decimals: 5, not 5.50.
3. **Method**: POST.
4. **External endpoint**: `https://<the Campaign Site>/api/donations/` followed by the price.
   The number at the end must be the same as the price. Type the number itself; do not use a
   `{...}` placeholder.
5. **Schema** (the item's inputs). One required input, the same on every item. Paste exactly:

   ```json
   {
     "type": "object",
     "properties": {
       "campaign_id": {
         "type": "string",
         "minLength": 1,
         "maxLength": 100,
         "description": "The Tejido campaign this donation is for."
       }
     },
     "required": ["campaign_id"]
   }
   ```

6. **Dispatch parameter**: a sensitive `header` named `X-Tejido-Checkin-Secret`. Its value is the
   same secret the two filing items use (`CHECKIN_SHARED_SECRET`).
7. **Active**: yes. **Featured**: no.

## Why the address and the price must match

Tejido records the amount from the number at the end of the address, and the donor pays the
item's price. If the two differ, Tejido does not offer that amount at all, so a donor can never
pay one amount and have another recorded.

## How to check it worked

1. Open a campaign that is raising money on the Campaign Site (they are listed under "Give
   now") and press **Give to this campaign**.
2. The Give page should show one button for each item you created. If it says "Giving is not
   available right now", Tejido found no donation item: check the hostname, the number at the
   end of the address, the price, and that the item is active.
3. Press an amount. Qatom's checkout page for that amount opens in a new window; the Give
   page stays open in the first one.
4. Pay it. This is a real payment of that amount to Tejido's account.
5. Close Qatom's window, go back to the Give page and press **I have paid: show the
   campaign**. The Funding block should show the amount raised and one more contribution.

## Changing the amounts later

- **Add an amount**: create another item the same way. It appears on the Give page by itself.
- **Remove an amount**: deactivate its item in Qatom. It disappears from the Give page.
- Do not change the price of an existing item without changing the number in its address to
  match, or the amount stops being offered.

## What Tejido keeps about a donation

The campaign, the amount and when Qatom told us. No name, email, wallet or transaction id. To
count a payment only once, Tejido keeps a one-way fingerprint of the transaction id Qatom sends;
the id cannot be read back from it.

## Not yet tried against real Qatom

Everything up to Qatom's checkout page has been tested with Qatom's answers played back, never
with a real payment. The first real donation is the test of: Qatom listing our items with their
address and price, accepting the checkout request, a guest paying, and Qatom calling
`/api/donations/<amount>` afterwards.
