/**
 * Legal document TEMPLATES. They are drafting aids, not legal advice, and must be
 * reviewed and completed by qualified counsel in the operator's jurisdiction before
 * use. Bracketed placeholders ([Operator legal name], etc.) must be replaced.
 * No statement here claims compliance with any specific law or certification.
 */
import { PLANS } from "@/config/pricing";

export interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  summary: string;
  sections: LegalSection[];
}

const OP = "[Operator legal name]";
const SERVICE = "the Service";

export const LEGAL_LAST_UPDATED = "[Date of adoption]";

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    slug: "terms",
    title: "Terms of service",
    summary: "The agreement between you and the operator for using the hosted software.",
    sections: [
      { heading: "1. Who we are", body: [`${SERVICE} is provided by ${OP}, a company registered in [jurisdiction] with registration number [number] and registered office at [address] ("we", "us").`, "These terms apply to the hosted application, the public demo and related support. Separate licence terms apply to self-hosted installations."] },
      { heading: "2. Accounts", body: ["You must provide accurate account information and keep sign-in credentials confidential. You are responsible for activity under your organisation's accounts, including access you grant to your staff, accountants and advisers.", "You must promptly remove access for people who leave your organisation."] },
      { heading: "3. Your responsibilities for payroll", body: ["The software calculates pay using the employee data, methodology settings and statutory rules that you configure and approve. You remain responsible for the accuracy of that information, for verifying results before paying employees, and for meeting your filing, payment and record-keeping obligations.", "Statutory rules supplied as examples are placeholders. They are not a statement of the law and must be replaced with verified values approved by you or your adviser. See the Statutory disclaimer."] },
      { heading: "4. Your data", body: ["You own the data you put into the Service. You grant us a limited right to host, process and back it up solely to provide the Service and support you, as described in the Data processing terms.", "You must have a lawful basis to process your employees' personal data in the Service and must provide any notices your employees are entitled to."] },
      { heading: "5. Acceptable use", body: ["You agree to the Acceptable use policy. We may suspend access that threatens the security or availability of the Service, with notice where practicable."] },
      { heading: "6. Fees", body: ["Fees, trials and billing cycles are set out on the pricing page and in the Subscription terms. Access to paid features depends on payment being confirmed by our payment processor."] },
      { heading: "7. Availability and changes", body: ["We aim to keep the Service available and will give reasonable notice of planned maintenance. We may improve or change features; we will not materially reduce core functionality during a paid term without notice."] },
      { heading: "8. Warranties and liability", body: ["[Counsel to draft: warranty disclaimers, exclusions and a liability cap appropriate to the jurisdiction and commercial model, including treatment of indirect loss and any non-excludable rights.]"] },
      { heading: "9. Termination", body: ["You may stop using the Service at any time as described in the Subscription terms. On termination you may export your data for [30] days, after which we delete it from active systems, subject to backup retention described in the Data processing terms."] },
      { heading: "10. Governing law", body: ["These terms are governed by the laws of [jurisdiction]. [Counsel to confirm dispute resolution forum.]"] },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy policy",
    summary: "How the operator handles personal data of website visitors and customer contacts.",
    sections: [
      { heading: "Scope", body: [`This policy explains how ${OP} handles personal data about visitors to our website and the business contacts of our customers. Employee data that customers store in the application is processed on the customer's behalf under the Data processing terms; the customer decides how it is used.`] },
      { heading: "Data we collect", body: ["Account data: name, work email, role and sign-in activity of people who use the application.", "Billing data: billing contact and payment status from our payment processor. We do not receive or store full card numbers.", "Communications: messages you send us.", "Technical data: IP address, browser and security logs needed to protect the Service."] },
      { heading: "Why we use it", body: ["To provide and secure the Service, to bill for it, to provide support, and to meet legal obligations. [Counsel to map each purpose to a lawful basis under the applicable data protection law.]"] },
      { heading: "Cookies", body: ["We use strictly necessary cookies only, such as the session cookie that keeps you signed in. See the Cookie policy."] },
      { heading: "Sharing", body: ["We share data with service providers that help us run the Service (for example hosting, email and payment processing) under contracts that limit their use of it. A current list is available on request. We do not sell personal data."] },
      { heading: "International transfers", body: ["[Counsel to describe hosting locations and transfer safeguards.]"] },
      { heading: "Retention", body: ["We keep account and billing records for as long as needed for the purposes above and to meet legal retention periods, then delete or anonymise them."] },
      { heading: "Your rights", body: ["Depending on where you are, you may have rights to access, correct, delete or restrict use of your data, or to object. Contact [privacy contact email]. Employees of our customers should contact their employer first."] },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie policy",
    summary: "Which cookies and browser storage the site and application use.",
    sections: [
      { heading: "Strictly necessary", body: ["Session cookie (production application): a random, HttpOnly, Secure cookie that keeps you signed in. It expires after inactivity and when you sign out.", "No advertising or cross-site tracking cookies are set by the application."] },
      { heading: "Demo storage", body: ["The public demo stores its fictional data in your browser's IndexedDB so your changes persist between visits. Use “Reset demo data” or clear site data to remove it. Nothing is sent to a server."] },
      { heading: "Analytics", body: ["[If the operator adds analytics, describe the provider, purpose and consent mechanism here before enabling it.]"] },
    ],
  },
  {
    slug: "data-protection",
    title: "Data processing terms",
    summary: "Terms under which the operator processes customer employee data as a processor.",
    sections: [
      { heading: "Roles", body: ["The customer is the controller of employee personal data entered into the Service. The operator processes it only on the customer's documented instructions, which are the agreement and the customer's use of the application."] },
      { heading: "Security measures", body: ["Encryption in transit (TLS) and encryption at rest of statutory identifiers, bank account numbers and two-factor secrets; scrypt password hashing; role, company and data-scope access controls enforced on the server; rate-limited authentication with optional two-factor; an append-only audit log; tenant isolation of company data; regular backups. [Operator to add hosting-provider controls and backup schedule.]"] },
      { heading: "Personnel", body: ["Operator staff with access to customer data are bound by confidentiality and access it only to provide the Service or support requested by the customer."] },
      { heading: "Sub-processors", body: ["[List hosting, database, email and payment sub-processors, their locations and how customers are notified of changes.]"] },
      { heading: "Incidents", body: ["The operator will notify the customer without undue delay after becoming aware of a personal data breach affecting customer data, with the information reasonably available. [Counsel to set notification timeframe.]"] },
      { heading: "Assistance and audits", body: ["The operator will provide reasonable assistance with data subject requests and impact assessments, and will make available information needed to demonstrate these commitments. [Counsel to define audit mechanics.]"] },
      { heading: "Deletion and return", body: ["At the end of the service the customer may export its data. The operator then deletes customer data from active systems within [30] days and from backups within [90] days, unless law requires retention."] },
    ],
  },
  {
    slug: "acceptable-use",
    title: "Acceptable use policy",
    summary: "What you may not do with the Service.",
    sections: [
      { heading: "You may not", body: ["Use the Service to process data you have no right to process, or for unlawful discrimination or surveillance of employees.", "Attempt to access another organisation's data, probe or bypass security controls, or test vulnerabilities without written permission.", "Upload malware, or files designed to exploit software that opens them.", "Overload the Service, scrape it, or resell access without agreement.", "Use the demo to store real personal data."] },
      { heading: "Reporting", body: ["Report suspected abuse or security issues to [security contact email]. We appreciate responsible disclosure."] },
    ],
  },
  {
    slug: "subscription-terms",
    title: "Subscription terms",
    summary: "Trials, billing cycles, renewals and cancellation for the hosted plan.",
    sections: [
      { heading: "Flexible Subscription", body: [`One-time setup fee of $${PLANS.hosted.setupFee} and a recurring fee of $${PLANS.hosted.recurringMonthly} per month, in USD, excluding applicable taxes.`, `A ${PLANS.hosted.trialDays}-day trial applies to new subscriptions.${PLANS.hosted.subscriptionFreeMonthsAfterPurchase > 0 ? ` The recurring fee is first charged ${PLANS.hosted.subscriptionFreeMonthsAfterPurchase} calendar months after purchase.` : ""} [Operator to confirm the final commercial promise and how the setup fee is treated if cancelled during the trial.]`] },
      { heading: "Billing", body: ["Payments are processed by our payment processor. Your subscription renews monthly until cancelled. If a payment fails we will notify you and retry; access may be limited if payment remains outstanding after [14] days."] },
      { heading: "Cancellation", body: ["You can cancel from the billing portal at any time. Cancellation takes effect at the end of the current billing period. Your data remains available for export as described in the Terms of service."] },
      { heading: "Price changes", body: ["We will give at least [30] days' notice of price changes, which apply from your next billing period."] },
    ],
  },
  {
    slug: "license",
    title: "Software licence",
    summary: "Terms for the Own the Software plan and self-hosted installations.",
    sections: [
      { heading: "Grant", body: [`On payment of the one-time fee ($${PLANS.owned.oneTime} USD), ${OP} grants your organisation a perpetual, non-exclusive, non-transferable licence to install and use the software for its own internal business purposes, for the number of organisations and companies stated in your order.`] },
      { heading: "Included period", body: [`No software subscription fee is payable for ${PLANS.owned.subscriptionFreeMonths} months from purchase. Maintenance and support are included for ${PLANS.owned.includedMaintenanceMonths} months as described in the Support and maintenance terms. [Operator to state what applies after month ${PLANS.owned.subscriptionFreeMonths}.]`] },
      { heading: "Restrictions", body: ["You may not resell, sublicense or offer the software as a service to third parties, or remove licence notices. [Counsel to address source code access, modification rights and third-party open-source components and their licences.]"] },
      { heading: "Your environment", body: ["You are responsible for hosting, backups, security patches of your infrastructure, encryption key custody and applying updates we provide."] },
      { heading: "Warranty and liability", body: ["[Counsel to draft.]"] },
    ],
  },
  {
    slug: "support-terms",
    title: "Support and maintenance terms",
    summary: "What support includes, response targets and maintenance.",
    sections: [
      { heading: "Included", body: ["Email support for configuration questions and defects; bug fixes and security updates; guidance on importing data and on configuring statutory rules you provide. Support does not include determining which statutory rates apply to you."] },
      { heading: "Response targets", body: ["[Operator to set targets, e.g. first response within one business day; critical defects preventing payroll prioritised.] Targets are goals, not guarantees, unless a separate service level agreement is signed."] },
      { heading: "Maintenance windows", body: ["Planned maintenance of the hosted Service is scheduled outside [region] business hours where possible, with advance notice."] },
      { heading: "Ownership plan", body: [`Maintenance is included for ${PLANS.owned.includedMaintenanceMonths} months from purchase. Optional maintenance afterwards is ${PLANS.owned.maintenanceMonthlyAfterIncluded ? `$${PLANS.owned.maintenanceMonthlyAfterIncluded} per month` : "quoted separately"}.`] },
    ],
  },
  {
    slug: "refund-cancellation",
    title: "Refund and cancellation policy",
    summary: "When refunds are available.",
    sections: [
      { heading: "Subscription", body: ["You can cancel at any time; access continues until the end of the paid period. Monthly fees already charged are not refunded except where required by law or stated here. [Operator to decide treatment of the setup fee if cancelled within the trial.]"] },
      { heading: "Ownership licence", body: ["[Operator to define any refund window, e.g. a full refund within 14 days of purchase if the software has not been deployed to production.]"] },
      { heading: "How to request", body: ["Email [billing contact email] with your organisation name and invoice number. Approved refunds are returned to the original payment method."] },
    ],
  },
  {
    slug: "statutory-disclaimer",
    title: "Statutory rules disclaimer",
    summary: "The software does not determine your legal obligations.",
    sections: [
      { heading: "Rules are configuration, not advice", body: ["Social Security, National Health Insurance, Payroll Tax and any other statutory rules in the software are data that you enter and approve. Any example values shipped with the software are illustrative placeholders, labelled as unverified, and must not be relied on.", "The operator does not monitor changes in legislation on your behalf and does not warrant that any rule, rate, ceiling, threshold or calculation method is correct for your circumstances."] },
      { heading: "Your responsibility", body: ["Before running live payroll, confirm each rule against official publications with a qualified payroll, tax or accounting professional, record the source in the rule, and approve it. Re-check rules whenever the law changes. The software records who approved each rule and when."] },
      { heading: "Methodology choices", body: ["Daily-rate, proration, overtime and rounding methods are business decisions. The software shows the formulas it applies so they can be reviewed, but choosing them is your responsibility."] },
    ],
  },
  {
    slug: "security",
    title: "Security overview",
    summary: "How the application protects payroll data. Descriptive, not a certification.",
    sections: [
      { heading: "Access control", body: ["Every request is authorized on the server by user, role, company and data scope. Supervisors cannot see salaries; employees can see only their own records. Records outside a user's scope are reported as not found."] },
      { heading: "Authentication", body: ["Passwords are hashed with scrypt. Sessions use a random token in an HttpOnly, Secure, SameSite cookie; only a hash of the token is stored. Sign-in is rate-limited per address and per account. Time-based two-factor authentication is available to every user. Cross-site requests are rejected."] },
      { heading: "Data protection", body: ["Statutory identifiers, bank account numbers and two-factor secrets are encrypted with AES-256-GCM before storage. Data is separated by company and organisation, and database constraints prevent duplicate employees and payroll periods.", "Uploaded documents are size-limited and checked by file signature, so a renamed executable is rejected."] },
      { heading: "Integrity", body: ["The audit log is append-only and enforced by a database trigger. Finalized and locked payroll results cannot be modified or deleted at the database level; changes require an audited reopen or a correction run."] },
      { heading: "Browser protections", body: ["A strict Content Security Policy, HSTS in production, frame blocking and no-sniff headers are applied to every response. Spreadsheet exports neutralise formula injection."] },
      { heading: "Responsible disclosure", body: ["Report vulnerabilities to [security contact email]. Please do not access other customers' data or degrade the Service while testing."] },
      { heading: "What this is not", body: ["This page describes technical measures. It is not a claim of certification or of compliance with any specific standard or law."] },
    ],
  },
];

export function legalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((d) => d.slug === slug);
}
