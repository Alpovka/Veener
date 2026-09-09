import { Resend } from 'resend';
import { checkRequestOrigin, createMemoryRateLimiter, clientKey } from 'veneer-sdk/server';

export const runtime = 'nodejs';

/**
 * Waitlist signup — runs as a Vercel (Next.js) function.
 *
 * Captures the signup via Resend. Configure with env vars:
 *   RESEND_API_KEY       (required)  your Resend API key
 *   WAITLIST_NOTIFY      (optional)  address that receives a "new signup" email
 *   RESEND_AUDIENCE_ID   (optional)  Resend audience to add the contact to
 *   WAITLIST_FROM        (optional)  verified from-address (default: Resend's test sender)
 * At least one of WAITLIST_NOTIFY / RESEND_AUDIENCE_ID must be set.
 *
 * Only same-site JSON requests are accepted, fields are length-capped, and signups are
 * rate-limited per IP so the endpoint cannot be used to spam the inbox or the audience.
 */
const MAX_FIELD = 120;
const allow = createMemoryRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });

function field(v) {
  return typeof v === 'string' ? v.trim().slice(0, MAX_FIELD) : '';
}

export async function POST(req) {
  try {
    const origin = checkRequestOrigin(req);
    if (!origin.ok) return Response.json({ error: origin.error }, { status: origin.status });
    if (!(await allow(clientKey(req)))) {
      return Response.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
    }

    const text = await req.text();
    if (text.length > 4096) return Response.json({ error: 'Request too large.' }, { status: 413 });
    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      return Response.json({ error: 'Invalid request.' }, { status: 400 });
    }
    const email = field(body && body.email);
    const firstName = field(body && body.firstName);
    const lastName = field(body && body.lastName);
    const location = field(body && body.location);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }
    if (!firstName || !lastName) {
      return Response.json({ error: 'First name and last name are required.' }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const audienceId = process.env.RESEND_AUDIENCE_ID;
    const notify = process.env.WAITLIST_NOTIFY;
    if (!apiKey || (!audienceId && !notify)) {
      return Response.json({ error: 'The waitlist isn’t configured yet.' }, { status: 503 });
    }

    const resend = new Resend(apiKey);
    const from = process.env.WAITLIST_FROM || 'Veneer <onboarding@resend.dev>';
    let captured = false;

    if (audienceId) {
      try {
        await resend.contacts.create({ email, firstName, lastName, unsubscribed: false, audienceId });
        captured = true;
      } catch (e) {
        console.error('[waitlist] audience add failed:', e && e.message ? e.message : e);
      }
    }

    if (notify) {
      try {
        await resend.emails.send({
          from,
          to: notify,
          replyTo: email,
          subject: 'New Veneer waitlist signup',
          text: `A new builder joined the waitlist!\n\nName: ${firstName} ${lastName}\nEmail: ${email}\nLocation: ${location || 'Not provided'}`,
        });
        captured = true;
      } catch (e) {
        console.error('[waitlist] notify failed:', e && e.message ? e.message : e);
      }
    }

    if (!captured) {
      return Response.json({ error: 'Couldn’t add you to the waitlist right now. Please try again later.' }, { status: 502 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[waitlist]', e && e.message ? e.message : e);
    return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
