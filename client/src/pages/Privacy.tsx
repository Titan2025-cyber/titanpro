import titanLogo from "@/assets/titan-logo.png";

// ── Privacy Policy ────────────────────────────────────────────────────────────
// Plain-language Privacy Policy for the Titan Pro application, including the
// Google / Gmail integration disclosures. This is a starting template, NOT legal
// advice — Titan Restoration LLC should have this reviewed and finalized by an
// attorney before relying on it.
export default function Privacy() {
  return (
    <div className="max-w-2xl mx-auto py-8 px-4" data-testid="page-privacy">
      <div className="text-center mb-8">
        <img src={titanLogo} alt="Titan Restoration" className="w-16 h-16 object-contain mx-auto mb-3" />
        <h1 className="text-2xl font-bold">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">Titan Pro — Titan Restoration LLC</p>
        <p className="text-xs text-muted-foreground mt-1">Effective July 23, 2026</p>
      </div>

      <div className="prose prose-sm max-w-none space-y-5 text-sm leading-relaxed">
        <section>
          <h2 className="font-bold text-base mb-1">1. Overview</h2>
          <p>
            This Privacy Policy explains how Titan Restoration LLC ("Titan," "we," "us") collects,
            uses, and protects information within the Titan Pro application (the "Software"). Titan
            Pro is a private business tool used by authorized Titan employees, partners, customers,
            and adjusters.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">2. Information We Collect</h2>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Account information — name, email, role, and login credentials for authorized users.</li>
            <li>Business records — jobs, estimates, invoices, photos, and related restoration data.</li>
            <li>Customer &amp; claim data — contact details and insurance claim information you enter.</li>
            <li>Usage data — basic activity needed to operate and secure the application.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">3. Google / Gmail Integration</h2>
          <p>
            Titan Pro offers an optional Gmail integration. When an authorized user chooses to
            connect their Google Workspace account, Titan Pro requests access using Google OAuth 2.0
            so the user can read, send, and manage their email from inside the app. This access is:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li><span className="font-semibold">Opt-in per user</span> — nothing is connected until the user clicks "Connect Gmail" and approves the Google consent screen.</li>
            <li><span className="font-semibold">Used only to provide the feature</span> — reading the connected inbox, sending mail as the user, and marking messages read within Titan Pro.</li>
            <li><span className="font-semibold">Never sold or shared</span> — Gmail data is not sold, rented, or transferred to third parties, and is not used for advertising.</li>
            <li><span className="font-semibold">Stored securely</span> — the Google refresh token is encrypted at rest (AES-256-GCM). Email content is fetched on demand and displayed to the connected user only.</li>
            <li><span className="font-semibold">Revocable anytime</span> — the user can click "Disconnect Gmail" in the app, or revoke access at{" "}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--titan-red))] font-semibold hover:underline">
                Google Account → Security → Third-party access
              </a>.
            </li>
          </ul>
          <p className="mt-2">
            Titan Pro's use of information received from Google APIs adheres to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--titan-red))] font-semibold hover:underline">
              Google API Services User Data Policy
            </a>, including the Limited Use requirements.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">4. How We Use Information</h2>
          <p>
            We use collected information solely to operate the Software: managing jobs and claims,
            communicating with customers and adjusters, generating documents, and securing accounts.
            We do not use your information for advertising or sell it to anyone.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">5. How We Protect Information</h2>
          <p>
            We use commercially reasonable safeguards including encryption of sensitive fields at
            rest, encrypted connections (HTTPS), role-based access controls, and authenticated
            sessions. No system is perfectly secure, but we work to protect your data.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">6. Data Sharing</h2>
          <p>
            We share data only with the service providers needed to run the Software (for example,
            hosting and payment processing) and only as required to deliver those services, or when
            required by law. Customers and partners may only access their own records.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">7. Data Retention &amp; Deletion</h2>
          <p>
            We retain business and account data for as long as needed to operate the Software and
            meet legal obligations. If you disconnect Gmail, the stored Google tokens for your
            account are deleted. To request deletion of other data, contact us using the details below.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">8. Contact</h2>
          <p>
            Questions about this Privacy Policy? Contact Titan Restoration LLC at{" "}
            <a href="tel:7069220154" className="text-[hsl(var(--titan-red))] font-semibold hover:underline">
              706-922-0154
            </a>
            .
          </p>
        </section>
      </div>

      <div className="mt-10 pt-4 border-t text-center text-[11px] text-muted-foreground space-y-1">
        <p>© 2026 Titan Restoration LLC. All rights reserved.</p>
        <p>Titan Pro is proprietary and confidential software.</p>
        <p className="mt-2">
          <a href="#/" className="text-[hsl(var(--titan-red))] hover:underline">← Back to app</a>
        </p>
      </div>
    </div>
  );
}
