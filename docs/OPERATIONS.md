# Running OmniServe

## Local setup

Use Node.js 22.13 or newer. This publication was installed and checked with Node.js 24.19.0.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev -- --host localhost --port 3000
```

Open `http://localhost:3000/` for the customer portal and `http://localhost:3000/admin/concierge` for the staff workspace. Local D1 and R2 bindings initialize the schema and synthetic public knowledge on first use. Files and records remain in the ignored `.wrangler/` directory. No hosted database or storage credentials are required for this local path.

The sample turns text and vision models off and contains no model key. Customers can leave an enquiry and consent to follow-up. Staff can claim it, choose the explicit manual context review, write both languages, save a draft, confirm its meaning and send English. A new customer message requires reviewing the current conversation again.

## Optional AI configuration

The runtime defaults to the DeepSeek adapter. Configure an account-supported model ID and server-side key in the ignored `.dev.vars`, and explicitly enable the model flag. Vision has a separate flag and model ID. Verify provider availability, costs and data handling before enabling either. Provider keys, usage allowance and external model service are not included in this repository.

The source also contains AIHubMix adapter functions and an optional embedding adapter. These are integration code, not proof that every provider/model is available or selected by the sample environment. The retained local Codex adapter requires a separate trusted loopback bridge; no bridge, account credential or subscription API is supplied here. Changing a flag alone does not establish that integration.

When model assistance is unavailable, the app keeps the enquiry and routes it to staff. The public assistant can answer automatically when configured and supported by published knowledge. After human takeover, the employee must confirm the current bilingual draft before sending it. These are separate paths.

## Authentication and deployment

The development workspace deliberately uses a local identity on loopback hosts; it does not ask you to sign in. Keep the development server on localhost. This is not a production login system.

Hosted internal routes expect a trusted authentication gateway to inject `oai-authenticated-user-id` and, where used, `oai-authenticated-user-email`. The edge must reject or replace user-supplied identity headers. Configure staff, publisher and project-lead allowlists separately. The development-only `x-test-user-id` override applies only on loopback in development mode.

Before deploying, provision your own D1/R2 resources, trusted authentication, domain and canonical metadata base. The committed Vite bindings and localhost metadata URL serve local development only. Configure monitoring, rate limits, backups, retention and a reliable cleanup schedule for the target environment. Expiry is access enforcement; the current request-triggered cleanup is not a guarantee of deletion at an exact instant. Website deployment and production acceptance are separate from this source publication.

## Offline checks

```bash
npm run check
npm run check:ai
npm run check:staff
npm run check:timezones
npm run check:lifecycle
npx tsc --noEmit
npm run lint
npm run build
```

These checks do not call a real model. The lifecycle check intentionally exercises a failed storage deletion and verifies that its index remains available for retry; its expected diagnostic line is not a failed check.
