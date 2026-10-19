# Verification scope

The 2026-10-19 README GIF update repeats the synthetic customer-to-staff manual flow in fresh isolated D1/R2 storage with the same published business source. Captured states cover takeover, manual context review, bilingual draft save/confirmation, sending and customer refresh. The customer-visible English exactly matches the confirmed reply; the Chinese meaning and internal draft label are absent from the customer view. The 25-second GIF decodes through all 21 frames and loops; captions identify the manual path and compressed waits. Only documentation and media change in this update, so the prior application build/check results below retain their original scope.

Checked on 2026-10-19 against the sanitized source in this repository. This is a source publication, not a website deployment or a claim of production acceptance.

## Passed for the published source

- A clean dependency installation from `https://registry.npmjs.org`, with an empty npm user configuration; Node.js 24.19.0.
- Domain, AI workflow, staff workspace, timezone and lifecycle offline checks; TypeScript, ESLint and the Vinext production build.
- Actual browser flow with fresh local D1/R2 storage: customer submits the fictional Melbourne hotel enquiry; opts into follow-up; chooses Australia/Melbourne; staff claims the same conversation; reviews context manually; writes English and Chinese; saves and confirms the draft; sends it; customer refreshes and sees only the English reply.
- Staff displays the customer-selected Melbourne time and its current three-hour difference from the employee's Shanghai browser zone. The timezone checks cover date-sensitive offsets, fractional offsets and missing values.
- Desktop and mobile screenshots are captured from that flow. See [MEDIA.md](MEDIA.md) for precise provenance.
- Public-copy review excludes environment secrets, the original database, original Git history, internal QA/provider logs, hosting project association and withdrawn external reference images. Common credential/private-key and personal-path scans returned no source matches; this is a scoped review, not a universal security guarantee.

The standalone multimodal dataset-integrity checker was not included because its private evaluation-image set is outside the source publication. Upload validation and the vision adapter's offline behavior remain covered by the included domain/AI checks.

## Existing development evidence

Before this publication, the local project exercised real-model bilingual generation/revision and a single-image vision path in a bounded integration run. That evidence belongs to its original environment. This publication does not repeat those calls or turn them into a broad visual-accuracy or model-quality benchmark.

## Still requires target-environment verification

Production authentication and member lifecycle; real-provider availability and costs; response-time and load behavior; real-device accessibility; operational follow-up; scheduled cleanup; backup/restore and release recovery. No production customer conversion, business performance or availability figure is claimed.
