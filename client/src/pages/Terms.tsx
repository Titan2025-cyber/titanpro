import titanLogo from "@/assets/titan-logo.png";

// ── Terms of Service ──────────────────────────────────────────────────────────
// Plain-language Terms of Service for the Titan Pro application. This is a
// starting template, NOT legal advice — Titan Restoration LLC should have this
// reviewed and finalized by an attorney before relying on it.
export default function Terms() {
  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="text-center mb-8">
        <img src={titanLogo} alt="Titan Restoration" className="w-16 h-16 object-contain mx-auto mb-3" />
        <h1 className="text-2xl font-bold">Terms of Service</h1>
        <p className="text-sm text-muted-foreground">Titan Pro — Titan Restoration LLC</p>
        <p className="text-xs text-muted-foreground mt-1">Effective July 2, 2026</p>
      </div>

      <div className="prose prose-sm max-w-none space-y-5 text-sm leading-relaxed">
        <section>
          <h2 className="font-bold text-base mb-1">1. Ownership &amp; Proprietary Rights</h2>
          <p>
            Titan Pro (the "Software") and all of its source code, design, features, data models,
            and content are the exclusive property of Titan Restoration LLC ("Titan," "we," "us")
            and are protected by copyright and other intellectual-property laws. All rights are
            reserved. The Software is proprietary and confidential.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">2. License &amp; Authorized Use</h2>
          <p>
            Access is granted only to authorized Titan employees, partners, customers, and
            adjusters, and only for legitimate business purposes related to Titan Restoration LLC.
            Access is limited to the accounts and data you are specifically authorized to view.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">3. Prohibited Conduct</h2>
          <p>You agree that you will not, and will not permit others to:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Copy, reproduce, distribute, or resell the Software or its source code.</li>
            <li>Reverse-engineer, decompile, or attempt to derive the source code.</li>
            <li>Access accounts, records, or data you are not authorized to view.</li>
            <li>Circumvent or attempt to circumvent any security or access control.</li>
            <li>Share login credentials, tokens, or PINs with unauthorized persons.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">4. Confidentiality</h2>
          <p>
            The Software contains confidential business information, customer records, and claim
            data. You must keep all such information confidential and use it only as authorized.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">5. Data &amp; Privacy</h2>
          <p>
            Titan collects and stores business, customer, and claim data to operate the Software.
            We use commercially reasonable safeguards to protect this data. Customers and partners
            may only access their own records.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">6. Disclaimer &amp; Limitation of Liability</h2>
          <p>
            The Software is provided "as is" without warranties of any kind. To the fullest extent
            permitted by law, Titan Restoration LLC is not liable for any indirect, incidental, or
            consequential damages arising from use of the Software.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">7. Enforcement</h2>
          <p>
            Unauthorized use, copying, or infringement may result in termination of access and
            legal action, including claims for injunctive relief and damages.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-base mb-1">8. Contact</h2>
          <p>
            Questions about these Terms? Contact Titan Restoration LLC at{" "}
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
