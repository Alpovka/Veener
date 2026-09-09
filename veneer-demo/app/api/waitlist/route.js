import { Resend } from 'resend';

export const runtime = 'nodejs';

/**
 * Waitlist signup — runs as a Vercel (Next.js) function.
 *
 * Captures the email via Resend. Configure with env vars:
 *   RESEND_API_KEY       (required)  your Resend API key
 *   WAITLIST_NOTIFY      (optional)  address that receives a "new signup" email
 *   RESEND_AUDIENCE_ID   (optional)  Resend audience to add the contact to
 *   WAITLIST_FROM        (optional)  verified from-address (default: Resend's test sender)
 *
 * Signup succeeds if it is captured by at least one of the configured channels
 * (audience contact or owner notification). The confirmation email to the user
 * is best-effort and never blocks the response.
 */
export async function POST(req) {
  try {
    const { email, firstName, lastName, location } = await req.json();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }
    if (!firstName || !firstName.trim() || !lastName || !lastName.trim()) {
      return Response.json({ error: 'First name and last name are required.' }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: 'The waitlist isn’t configured yet.' },
        { status: 500 }
      );
    }

    const resend = new Resend(apiKey);
    const from = process.env.WAITLIST_FROM || 'Veneer <onboarding@resend.dev>';
    const audienceId = process.env.RESEND_AUDIENCE_ID;
    const notify = process.env.WAITLIST_NOTIFY || 'karavelx@gmail.com';

    let captured = false;

    if (audienceId) {
      try {
        await resend.contacts.create({
          email,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          unsubscribed: false,
          audienceId,
        });
        captured = true;
      } catch (e) {
        /* keep going — fall back to notification */
      }
    }

    if (notify) {
      try {
        await resend.emails.send({
          from,
          to: notify,
          replyTo: email,
          subject: 'New Veneer waitlist signup',
          text: `A new builder joined the waitlist!\n\nName: ${firstName.trim()} ${lastName.trim()}\nEmail: ${email}\nLocation: ${location ? location.trim() : 'Not provided'}`,
        });
        captured = true;
      } catch (e) {
        /* keep going */
      }
    }

    if (!captured) {
      return Response.json(
        { error: `Couldn’t add to waitlist. Contact ${notify} directly.` },
        { status: 500 }
      );
    }

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 500 });
  }
}
