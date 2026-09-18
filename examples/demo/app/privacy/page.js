'use client';

import { LegalPage, Sec } from '../_components/legal';

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="June 20, 2026">
      <Sec title="Overview">
        <p>
          This Privacy Policy explains how AlpovkaApps (“we”, “us”) handles information in connection
          with Veneer (the “Service”). We aim to collect as little as possible and to be clear about
          what we do with it.
        </p>
      </Sec>

      <Sec title="Information we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium text-slate-800 dark:text-slate-200">Waitlist email.</span> When
            you join the waitlist, we collect the email address you submit so we can send you an
            invitation and beta updates.
          </li>
          <li>
            <span className="font-medium text-slate-800 dark:text-slate-200">Local browser storage.</span>{' '}
            We store your theme preference and any UI you generate in the live demo in your browser
            (localStorage / sessionStorage). This stays on your device and is not sent to us.
          </li>
          <li>
            <span className="font-medium text-slate-800 dark:text-slate-200">Basic usage data.</span> Our
            hosting provider may process standard technical logs (such as IP address and request
            metadata) to operate and secure the site.
          </li>
        </ul>
      </Sec>

      <Sec title="How we use it">
        <p>
          We use your email solely to manage the waitlist and tell you about access and product
          updates. We do not sell your personal information, and we do not use it for unrelated
          advertising.
        </p>
      </Sec>

      <Sec title="Service providers">
        <p>
          We use trusted third parties to run the Service — for example, Resend to deliver waitlist and
          transactional email, and a hosting provider (Vercel) to serve the site. These providers
          process data on our behalf under their own terms and security practices.
        </p>
      </Sec>

      <Sec title="The live demo">
        <p>
          The demo runs generated UI inside a sandboxed JavaScript interpreter in your browser, with no
          network access. Your demo data
          stays in your browser session and is not transmitted to us. Prompts you type into the “redesign
          with AI” chat are sent to the configured model provider to generate the requested interface.
        </p>
      </Sec>

      <Sec title="Data retention & your choices">
        <p>
          We keep your waitlist email until you ask us to remove it or the waitlist is closed. You can
          request access to, correction of, or deletion of your information at any time by contacting
          us. You can clear locally stored data by clearing your browser storage for this site.
        </p>
      </Sec>

      <Sec title="Changes">
        <p>
          We may update this policy from time to time; the “last updated” date above reflects the most
          recent version.
        </p>
      </Sec>

      <Sec title="Contact">
        <p>
          For privacy questions or requests, contact AlpovkaApps via{' '}
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
