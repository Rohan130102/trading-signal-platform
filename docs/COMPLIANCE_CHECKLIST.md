# Compliance checklist

**Status: release-blocking and unresolved.** This application distributes paid trading recommendations. Do not open
it to paying subscribers until a qualified lawyer has completed this checklist for your entity, your subscribers'
jurisdictions and your instruments.

This document is an engineer's map of questions for counsel, checked on 5 November 2026. **It is not legal advice and
reaches no legal conclusions.** Rules here change often, so re-check everything against the primary sources.

## How each item below was checked

| Mark                   | Meaning                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| **[Read]**             | The official source page itself was read for this checklist.                            |
| **[Official listing]** | Seen in search results from the regulator's own site. The document itself was not read. |
| **[Secondary]**        | From news, law-firm notes or compliance blogs only. Confirm against the primary text.   |

## Blockers to resolve first

| #   | Question for counsel                                                                                         | Why it matters                                                                                                                                                 | Status   |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Who is the legal operator, and where?                                                                        | Every other answer depends on this. `legalEntityName` in Settings is empty until you fill it in.                                                               | **Open** |
| 2   | Does this service need SEBI registration as a Research Analyst or Investment Adviser, or any other licence?  | Paid buy/sell recommendations to the public are the core of the product.                                                                                       | **Open** |
| 3   | Are XAU/USD and BTC/USD "securities" for those rules, and may you recommend them to Indian residents at all? | See the sections on forex and crypto below. The answer may change which instruments can be offered, or whether this can be offered to Indian residents at all. | **Open** |
| 4   | Which other countries will subscribers be in?                                                                | Each may have its own licensing and marketing rules, for example on CFDs and retail forex.                                                                     | **Open** |

## India: research and advice (SEBI)

| Point                                                                                                                                                                                             | Source quality                                       | Action for counsel                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| SEBI amended the Research Analyst Regulations in 2024, including a third amendment of December 2024 that defines "trading calls" and requires disclosure of AI tool use and a functional website. | [Secondary]                                          | Confirm scope, and whether the current product's content counts as "trading calls".                                                          |
| SEBI issued guidelines for research analysts on 8 January 2025 (circular MIRSD-PoD-1/P/CIR/2025/004), with deposit and fee provisions on staged deadlines in 2025.                                | [Secondary]                                          | Confirm fee caps, permitted payment modes, client agreements and disclosures. This app collects no payment and has no client-agreement flow. |
| A further amendment in November 2025 changes eligibility and certification.                                                                                                                       | [Secondary]                                          | Confirm what applies to the principal and to associated persons.                                                                             |
| SEBI barred regulated entities from associating with unregistered "finfluencers", from 2024.                                                                                                      | [Secondary]                                          | Check any marketing or referral plans.                                                                                                       |
| A Common Advertisement Code for specified SEBI-regulated entities appears in a SEBI board document dated September 2026.                                                                          | [Official listing]. The file could not be read here. | Establish whether it is final, whom it covers and what it requires of all marketing text, including the public home page.                    |

## India: past performance (SEBI and PaRRVA)

This is why the public results section is closed by default and needs two independent keys to open.

| Point                                                                                                                                                                                                                                                        | Source quality     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| The Past Risk and Return Verification Agency framework was set by circular on 4 April 2025.                                                                                                                                                                  | [Official listing] |
| An interim arrangement of 30 October 2025 allowed certified past performance to be shared one-to-one, on client request, before PaRRVA began.                                                                                                                | [Official listing] |
| The operationalisation circular is dated 29 April 2026. SEBI's press release names CARE Ratings as PaRRVA and NSE as the PaRRVA Data Centre, with regular services from 4 May 2026, covering investment advisory, research services and algorithmic trading. | [Official listing] |
| An enrolment timeline extension is listed, dated 3 August 2026. Its terms were not read.                                                                                                                                                                     | [Official listing] |
| Advisers and analysts were barred from referring to past performance in advertisements, with PaRRVA-verified figures the route to using it.                                                                                                                  | [Secondary]        |
| After May 2028, only PaRRVA-verified metrics may reportedly be communicated. Selective disclosure of favourable periods is reportedly barred.                                                                                                                | [Secondary]        |

**What this means for the product, pending counsel:**

- The figures this app calculates are **its own records, not PaRRVA-verified results**. Nothing here is integrated with PaRRVA.
- Internal analytics stay internal. Do not screenshot them into marketing.
- Whether even subscriber-facing outcome labels, such as "+150 pts (hypothetical)" in the feed, count as a past-performance reference needs a specific answer. They are operational status today, and the wording can be changed in **Templates**. **Ask this explicitly.**

## India: forex (RBI and FEMA), relevant to XAU/USD

| Point                                                                                                                                                                                                                                                                                        | Source quality                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Residents may undertake forex transactions only with authorised persons and for permitted purposes under FEMA. Electronic forex trades must be on RBI-authorised electronic trading platforms or recognised exchanges. Dealing otherwise makes a resident liable to penal action under FEMA. | **[Read]** RBI FAQ                                                        |
| The RBI publishes an Alert List of unauthorised entities and says it is not exhaustive, so absence from the list does not mean a platform is authorised.                                                                                                                                     | **[Read]** RBI FAQ. Updated as on 19 November 2025 per [Official listing] |
| Remittances for margin to overseas exchanges or counterparties are not allowed under the Liberalised Remittance Scheme.                                                                                                                                                                      | [Official listing]                                                        |

**Question for counsel:** subscribers would need somewhere to act on an XAU/USD signal. If that is an offshore CFD
broker, does recommending it expose you or them? The application cannot answer this and does not name any broker.

## India: crypto-assets, relevant to BTC/USD

| Point                                                                                                                                                                                                  | Source quality |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| There is no comprehensive statute. Virtual digital asset service providers fall under anti-money-laundering rules and must register with FIU-IND. Updated AML/CFT guidelines are dated 8 January 2026. | [Secondary]    |
| Parliamentary and official framing describes crypto-assets as unregulated, and sources do not all put this the same way.                                                                               | [Secondary]    |

**Question for counsel:** is a paid signals service a regulated activity for crypto-assets? This application holds and
transfers no assets, but that alone does not settle the question.

## India: personal data (DPDP)

| Point                                                                                                                                                                           | Source quality |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| The Digital Personal Data Protection Rules were notified in November 2025 with a phased start. Core data-fiduciary obligations begin about 18 months later, around 13 May 2027. | [Secondary]    |
| Reported requirements include notifying the Data Protection Board of a breach within 72 hours and resolving grievances within 90 days.                                          | [Secondary]    |

**Known product gap:** there is no built-in data export or erasure workflow for a subscriber. Signal events hold no
subscriber data, so erasure would touch `users`, `sessions`, `push_subscriptions` and audit metadata, and must be
balanced against record-keeping duties. It is a manual procedure today. Decide this before the obligations begin.

## App stores

A native app adds gatekeepers beyond the regulators. None of this has been tested with a real review. Details are in
[MOBILE.md](MOBILE.md).

- [ ] Apple's rules on financial trading and investing apps, including who may submit them
- [ ] Google Play's financial features declaration and country-specific rules
- [ ] Privacy labels and the data safety form
- [ ] In-app account deletion: decide whether it applies, since only administrators create accounts
- [ ] A demo account for reviewers, with no real signals

## Sign-off list

Nothing below is complete. Each needs a named owner and evidence.

- [ ] Legal entity and intended business jurisdiction documented
- [ ] Subscriber jurisdictions listed, and any restricted countries blocked in onboarding
- [ ] Registration or authorisation requirements determined, and obtained where required
- [ ] Instruments reviewed: are XAU/USD and BTC/USD allowed for this entity and audience?
- [ ] Payment handling reviewed: permitted modes and fee limits. Payment is offline, outside this application
- [ ] Client agreement and onboarding disclosures drafted. **This app has no acceptance flow yet**
- [ ] Risk disclosure text reviewed. The seeded text in Settings is a placeholder written by an engineer
- [ ] Privacy notice reviewed. The seeded text is a placeholder too
- [ ] Regulatory statement written. It is deliberately empty, so the app claims no status
- [ ] Public home page reviewed against advertising rules
- [ ] Decision made on outcome labels shown to subscribers, and templates updated to match
- [ ] Record-retention periods confirmed against the indefinite retention here
- [ ] Data-subject request procedure written
- [ ] Complaints or grievance channel set in `supportContact`, with any required escalation details
- [ ] Decision recorded on public performance. If yes: PaRRVA enrolment, an approval record and the deployment flag

## How the application supports this

| Control                                                                                                                                                        | Where                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Public results closed by default. Needs `PUBLIC_PERFORMANCE_ENABLED=true` **and** a current approval record naming jurisdiction, scope, reviewer and document. | `PerformanceService.publicGate`, Settings                              |
| Revoking an approval, or its expiry, closes the section immediately.                                                                                           | Tested in `apps/api/test/public.test.ts`                               |
| Every outcome in the period is included. Cancelled and untriggered signals remain in the record.                                                               | `computePerformanceStats`                                              |
| Hypothetical and declared outcomes are never combined. An admin-typed result can never be labelled verified.                                                   | `resolveOutcome`. `EXTERNALLY_VERIFIED` is unreachable through any API |
| No backdating: event time is set by the database, and an exit time cannot precede activation or be in the future.                                              | Trigger `signal_events_before_insert`, `assertExitTime`                |
| History cannot be silently changed: append-only triggers, plus a hash chain anyone can verify.                                                                 | Migration `20261105000100_integrity`, Audit log page                   |
| Legal text is configuration, not code. The app makes no claim of being regulated.                                                                              | Settings                                                               |
| No testimonials, screenshots, sample trades or demo results are seeded.                                                                                        | `apps/api/src/scripts/seed.ts`                                         |

## Sources

- [SEBI: Recognition and operationalization of PaRRVA, April 2025](https://www.sebi.gov.in/legal/circulars/apr-2025/recognition-and-operationalization-of-past-risk-and-return-verification-agency-parrva-_93321.html)
- [SEBI: Operationalisation of PaRRVA, 29 April 2026](https://www.sebi.gov.in/legal/circulars/apr-2026/operationalisation-of-past-risk-and-return-verification-agency-parrva-_101185.html)
- [SEBI press release PR No. 28/2026](https://www.sebi.gov.in/sebi_data/attachdocs/apr-2026/1777472194521.pdf)
- [SEBI: Interim arrangement for certified past performance, October 2025](https://www.sebi.gov.in/legal/circulars/oct-2025/ease-of-doing-business-interim-arrangement-for-certified-past-performance-of-investment-advisers-and-research-analysts-prior-to-operationalisation-of-past-risk-and-return-verification-agency-parrv-_97556.html)
- [SEBI board document: Common Advertisement Code, September 2026](https://www.sebi.gov.in/sebi_data/meetingfiles/sep-2026/1790747052409_1.pdf)
- [RBI FAQ: resident forex transactions](https://www.rbi.org.in/commonman/english/scripts/FAQs.aspx?Id=3347)
- [RBI Alert List, updated 19 November 2025](https://rbidocs.rbi.org.in/rdocs/Content/PDFs/ALERTLIST10022023CC5FC4ACD619431497A56B6894188478.PDF)
- [Business Standard: SEBI launches PaRRVA](https://www.business-standard.com/markets/news/sebi-launches-return-verification-framework-parrva-to-curb-fake-performance-claims-125120800842_1.html)
- [Business Standard: deadlines to verify past performance](https://www.business-standard.com/markets/news/sebi-parrva-framework-performance-verification-deadlines-126042901492_1.html)
- [Outlook Money: SEBI operationalises PaRRVA](https://www.outlookmoney.com/news/sebi-operationalises-parrva-framework-sets-deadline-for-advisers-to-verify-data-on-past-performance)
- [TaxGuru: SEBI (Research Analysts) (Third Amendment) Regulations, 2024](https://taxguru.in/sebi/sebi-research-analysts-third-amendment-regulations-2024.html)
- [TaxGuru: SEBI tightens rules for research analysts, 2025](https://taxguru.in/sebi/sebi-tightens-rules-research-analysts-2025.html)
- [Complisec: summary of RA amendments](https://complisec.in/?p=854)
- [MediaNama: SEBI orders regulated entities to cut ties with finfluencers](https://www.medianama.com/2024/10/223-sebi-orders-regulated-entities-to-cut-ties-with-unauthorised-finfluencers/)
- [Upstox: crypto-assets unregulated in India](https://upstox.com/news/personal-finance/latest-updates/crypto-assets-unregulated-in-india-regulators-step-up-kyc-and-tax-oversight-for-investors/article-189067/)
- [Zigram: FIU-IND 2026 AML and CFT guidelines](https://www.zigram.tech/?p=34975)
- [AZB & Partners: DPDP phased rollout](https://www.azbpartners.com/bank/indias-digital-personal-data-protection-act-phased-rollout-and-key-compliance-milestones/)
- [Mondaq: DPDP 2026 compliance milestones](https://www.mondaq.com/dpdp-act-and-rules-2025-the-2026-compliance-milestones-businesses-cant-afford-to-miss/1830402)
