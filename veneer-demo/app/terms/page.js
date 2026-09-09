'use client';

import { LegalPage, Sec } from '../_components/legal';

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="June 20, 2026">
      <Sec title="1. Agreement">
        <p>
          These Terms of Service (“Terms”) govern your access to and use of Veneer (the “Service”), a
          product operated by AlpovkaApps (“we”, “us”). By joining the waitlist, accessing the
          website, or using the Service, you agree to these Terms. If you do not agree, please do not
          use the Service.
        </p>
      </Sec>

      <Sec title="2. Beta service">
        <p>
          Veneer is currently offered in a private beta and on an “as-is” and “as-available” basis. We
          may add, change, suspend, or remove features at any time, and access may be limited or
          invitation-only. Beta features may contain bugs and are not guaranteed to be available,
          uninterrupted, or error-free.
        </p>
      </Sec>

      <Sec title="3. Acceptable use">
        <p>You agree not to use the Service to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>break the law or infringe the rights of others;</li>
          <li>attempt to bypass the security sandbox, access data you are not authorized to access, or disrupt the Service;</li>
          <li>reverse-engineer, resell, or misuse the Service beyond what these Terms permit;</li>
          <li>generate or distribute malicious, deceptive, or harmful content.</li>
        </ul>
      </Sec>

      <Sec title="4. Your content and integrations">
        <p>
          You retain ownership of the data, code, and capabilities you connect to or create with the
          Service. You are responsible for the actions you register and the implementations behind
          them, including enforcing your own authorization and validation. The security sandbox bounds
          what generated UI can do, but it does not replace server-side access control in your
          application.
        </p>
      </Sec>

      <Sec title="5. Intellectual property">
        <p>
          The Service, including the open-source package, website, and brand, is owned by AlpovkaApps and protected by
          applicable law. These Terms do not grant you any rights to our trademarks or branding except
          as needed to use the Service as intended.
        </p>
      </Sec>

      <Sec title="6. Disclaimers & limitation of liability">
        <p>
          To the fullest extent permitted by law, the Service is provided without warranties of any
          kind. AlpovkaApps will not be liable for any indirect, incidental, or consequential damages,
          or for any loss of data, revenue, or profits arising from your use of the Service.
        </p>
      </Sec>

      <Sec title="7. Changes & termination">
        <p>
          We may update these Terms from time to time; material changes will be reflected by the “last
          updated” date above. We may suspend or terminate access if these Terms are violated. You may
          stop using the Service at any time.
        </p>
      </Sec>

      <Sec title="8. Contact">
        <p>
          For questions about these Terms, contact AlpovkaApps via{' '}
          <a
            href="https://alpovka.github.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            alpovka.github.io
          </a>
          .
        </p>
      </Sec>
    </LegalPage>
  );
}
