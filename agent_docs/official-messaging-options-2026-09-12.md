# Official messaging API options — 12 September 2026

Recommendation: use Meta's official WhatsApp Cloud API directly for the lowest provider surcharge, with official Instagram/Messenger channels. For a shared inbox backend, evaluate self-hosted Chatwoot against building native channel adapters. This is an architectural recommendation, not an activated integration or a verified claim that the existing deployment is ready.

| Option | Cost model | Trade-off |
| --- | --- | --- |
| Meta APIs directly | WhatsApp charges depend on destination/category; no additional Twilio message fee | More work for app review, onboarding, tenant tokens, webhooks, retries and message state |
| Chatwoot self-hosted with official channels | Meta usage plus server/operations costs and any selected Chatwoot edition costs | Existing inbox/channel implementation; must isolate each customer account and verify required edition features |
| Twilio WhatsApp | Published USD 0.005 per inbound or outbound message, plus Meta charges | Managed provider integration with an added volume cost |

At 10,000 total inbound plus outbound messages, Twilio's published per-message component alone is USD 50. This arithmetic excludes Meta fees, taxes, hosting and optional services; it is not a total quotation. [Twilio pricing](https://www.twilio.com/en-us/whatsapp/pricing?locale=en).

Meta's public pricing page describes charging by delivered message, recipient market and category. Confirm the current rate card in the business account before setting SENVIA customer prices; do not promise that service messages remain free indefinitely. Exact Portugal rates and reported October 2026 changes were not verified in accessible primary documentation during this review. [WhatsApp pricing](https://whatsappbusiness.com/products/platform-pricing/).

Chatwoot's own channel documentation includes WhatsApp Cloud and Instagram media support and limitations. Its user guide lists Facebook and Instagram among supported channels. Confirm app approval, professional-account/page requirements, login flow and channel support in a trial installation before selecting it. The Meta developer pages returned HTTP 429 during this review; their current permissions and pricing details were not independently validated. [Channel capabilities](https://developers.chatwoot.com/self-hosted/supported-features), [Chatwoot user guide](https://www.chatwoot.com/hc/user-guide/en).

Implementation proposal:

1. Inventory the actual deployed Chatwoot/Evolution setup. Repository database documentation mentions them, but the current checkout does not contain the referenced WhatsApp connection functions; documentation alone is insufficient proof of a working integration.
2. Prototype one test organization with official WhatsApp Cloud, Instagram and Facebook channels. Do not use a personal WhatsApp session/QR transport as evidence of an official API integration.
3. Verify webhook signatures, tenant mapping using provider account/channel IDs, per-organization token storage, retry idempotency, media limits, delivery/read states, consent/template windows and reconnection behavior.
4. Estimate cost from actual monthly inbound/outbound/category volumes, customer markets and operational support, then agree customer limits. Keep billing independent from the core EUR 49 plan until these costs are measured.

No Meta accounts, messages, channel connections or production services were changed.
