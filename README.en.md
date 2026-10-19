# OmniServe

**AI-assisted overseas enquiries and bilingual reply review for architectural-visualization teams.**

Customers ask about a project, share a reference image, and request follow-up. Staff take over the same conversation, revise a bilingual draft, and send the English reply after confirmation.

[中文](README.md) · [English](README.en.md) · [Run locally](#run-locally)

![Complete workflow example: customer enquiry, staff takeover, bilingual draft, staff confirmation and English reply, then customer receipt](docs/images/workflow.gif)

*Actual interface keyframes from a fictional enquiry; the manual review path is shown and waiting time is compressed. AI is disabled by default.*

**Customer enquiry → Staff takeover → Bilingual draft → Confirm and send English → Customer receives the reply**

- **Context follows handoff:** Staff can review the customer’s messages, attachments, and enquiry context when taking over.
- **Sent only after confirmation:** Staff revise the English reply and Chinese review meaning; only an English version confirmed by an authorized staff member can be sent.
- **Follow up across time zones:** Choose from 50 common city-based time zones or enter another valid IANA time zone. The browser suggestion is editable and is not precise location data.

## What customers and staff can do

### Customer enquiries

- Ask about architectural stills, animation and walkthroughs, visual direction, and post-production in a persistent conversation.
- Attach one JPEG, PNG, or WebP reference image per message, up to 10 MB.
- When enabled, the public assistant can answer from currently published knowledge and show sources where applicable; customers can also request a staff follow-up.
- Contact details are optional for an enquiry. They are collected only when a customer requests follow-up and gives explicit consent.

### Staff follow-up

- Take over a conversation and review the original messages, attachments, lead summary, and the customer’s local date and time.
- Generate or manually write an English reply with a Chinese review meaning, then save revisions as a new version.
- Review and confirm the current draft before sending its English version. Replies are never sent automatically.
- Update lead status, priority, next action, and notes; complete, reopen, or reassign a conversation where permitted.

### Knowledge and AI boundaries

Public retrieval is limited to currently published knowledge and cases approved for public display. Enquiries can be handed to staff when evidence is insufficient, a customer asks for a person, or commercial judgment is required. The system does not quote prices, confirm schedules or delivery quality, or approve legal or contract terms.

AI features are disabled by default. A model participates only after an operator configures and enables it on the server. Without model configuration, customers can still enquire, staff can take over, write bilingual drafts manually, confirm, and send replies. When enabled, AI-assisted staff replies remain drafts until an authorized staff member confirms and sends them. Automated assistance may process messages and images to help prepare replies; see the [privacy notice](app/privacy/page.tsx).

<details>
<summary>More interface views</summary>

![Customer project-enquiry entry](docs/images/customer-portal.jpg)

*Example of the customer-facing entry point.*

![Staff taking over an enquiry and reviewing a bilingual draft](docs/images/staff-review.jpg)

*Staff workspace example with fictional QA records.*

![Customer receives the confirmed English reply](docs/images/customer-reply.jpg)

*Reply example for a fictional enquiry.*

![Mobile customer enquiry and reply](docs/images/customer-mobile.jpg)

*Mobile example at a 390 × 844 viewport with fictional enquiry content.*

</details>

## Privacy and project boundaries

Contact details are collected only when a customer requests follow-up and gives explicit consent. Access to conversations, images, and linked contact details expires after seven days; expired records are removed later through routine cleanup. See the [privacy notice](app/privacy/page.tsx).

This repository is a sanitized reconstruction of an overseas customer-support workflow. Visuals in the repository are concept studies, not real client commissions or deliveries; all enquiries and contacts in screenshots are fictional examples. See [image sources and usage notes](docs/MEDIA.md).

## Run locally

Requires Node.js 22.13 or newer.

```bash
git clone https://github.com/Irixil/OmniServe.git
cd OmniServe
npm ci
cp .dev.vars.example .dev.vars
npm run dev -- --host localhost --port 3000
```

Keep real credentials in a protected local secret store. Do not commit `.dev.vars` or provider keys. Model and image-analysis switches in the example configuration are off by default.

A clean installation using the official public npm registry and an empty npm user configuration has passed. For setup and operation, see [OPERATIONS.md](docs/OPERATIONS.md); for local verification scope and unverified items, see [VERIFICATION.md](docs/VERIFICATION.md).

## Built with

Next.js, React, TypeScript, Vinext, Cloudflare’s Vite integration, D1/R2-compatible storage interfaces, and Orama. Knowledge retrieval uses lexical search and can combine it with vector similarity when embeddings are configured.
