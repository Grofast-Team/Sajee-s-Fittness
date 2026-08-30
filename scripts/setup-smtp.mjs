#!/usr/bin/env node
/**
 * Configure custom SMTP and branded auth emails on a Supabase project.
 *
 * Why this exists: on the free tier with Supabase's shared sender, emails come
 * from "Supabase Auth <noreply@mail.app.supabase.io>", template editing is
 * refused outright by the API, and you get **2 emails per hour** — so the third
 * person to sign up within an hour silently receives nothing at all. Custom
 * SMTP fixes all three.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_...           \
 *   SUPABASE_PROJECT_REF=abc123             \
 *   SMTP_HOST=smtp.gmail.com                \
 *   SMTP_PORT=465                           \
 *   SMTP_USER=you@gmail.com                 \
 *   SMTP_PASS="abcd efgh ijkl mnop"         \
 *   SMTP_SENDER_EMAIL=you@gmail.com         \
 *   SMTP_SENDER_NAME=FitCoach               \
 *   node scripts/setup-smtp.mjs
 *
 * Gmail / Google Workspace notes:
 *   - SMTP_PASS must be a 16-character App Password, not your account password.
 *     Create one at https://myaccount.google.com/apppasswords (requires
 *     2-Step Verification to be switched on first).
 *   - SMTP_SENDER_EMAIL must equal SMTP_USER. Gmail rewrites the From header to
 *     the authenticated account, so a different address is silently replaced.
 *     The display name is still yours: mail arrives as "FitCoach <you@gmail.com>".
 *   - Roughly 500 recipients/day personal, 2,000/day Workspace.
 *
 * For any other provider the sender address must be on a domain you have
 * verified with them. Unverified senders get rejected or land in spam.
 */

const REQUIRED = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_SENDER_EMAIL',
];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(['Missing required environment variables:', ...missing.map((m) => `  ${m}`)].join('\n'));
  process.exit(1);
}

const {
  SUPABASE_ACCESS_TOKEN: token,
  SUPABASE_PROJECT_REF: ref,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SENDER_EMAIL,
  SMTP_SENDER_NAME = 'FitCoach',
} = process.env;

const API = `https://api.supabase.com/v1/projects/${ref}/config/auth`;

// App Passwords are displayed in four groups of four; the spaces are
// presentational and must not be sent.
const password = SMTP_PASS.replace(/\s+/g, '');

// ---------------------------------------------------------------------------
// Gmail guards.
//
// These are the two mistakes that produce a configuration the API happily
// accepts but which never actually delivers — the worst kind of failure,
// because everything looks fine until a user reports they got no email.
// ---------------------------------------------------------------------------
if (/gmail\.com|googlemail\.com/i.test(SMTP_HOST)) {
  if (SMTP_SENDER_EMAIL.toLowerCase() !== SMTP_USER.toLowerCase()) {
    console.error(
      [
        'Gmail rewrites the From header to the authenticated account.',
        `  SMTP_USER         = ${SMTP_USER}`,
        `  SMTP_SENDER_EMAIL = ${SMTP_SENDER_EMAIL}`,
        'These must match, or Gmail silently replaces your sender address.',
      ].join('\n'),
    );
    process.exit(1);
  }

  if (password.length !== 16) {
    console.error(
      [
        `That is not a Gmail App Password (expected 16 characters, got ${password.length}).`,
        'Your normal account password will not work — Google requires an App Password for SMTP.',
        'Create one at https://myaccount.google.com/apppasswords (needs 2-Step Verification on).',
      ].join('\n'),
    );
    process.exit(1);
  }
}

/** Shared shell for every auth email. Plain, legible, and carrying the same
 *  medical disclaimer the app does — these are health-adjacent emails. */
function template({ heading, intro, cta, outro }) {
  return [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;`,
    `max-width:520px;margin:0 auto;padding:32px 24px;color:#10333d;line-height:1.55">`,
    `<p style="font-size:20px;font-weight:600;margin:0 0 4px;color:#0e7490">${SMTP_SENDER_NAME}</p>`,
    `<h1 style="font-size:22px;font-weight:600;margin:24px 0 12px">${heading}</h1>`,
    `<p style="margin:0 0 24px;color:#4d7784">${intro}</p>`,
    `<p style="margin:0 0 28px">`,
    `<a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0e7490;`,
    `color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:600">`,
    `${cta}</a></p>`,
    `<p style="margin:0 0 8px;font-size:14px;color:#6f939e">${outro}</p>`,
    `<p style="margin:24px 0 0;font-size:12px;color:#6f939e;border-top:1px solid #d9e9ee;padding-top:16px">`,
    `${SMTP_SENDER_NAME} gives general wellness, nutrition and activity guidance. It does not `,
    `diagnose or treat, and it is not a substitute for a doctor or a registered dietitian.</p></div>`,
  ].join('');
}

async function patch(label, body) {
  const response = await fetch(API, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error(`✗ ${label}: ${response.status} ${await response.text()}`);
    return false;
  }
  console.log(`✓ ${label}`);
  return true;
}

// Step 1 — SMTP. Template editing stays locked until this lands, so it has to
// go first and has to succeed before anything else is attempted.
const smtpConfigured = await patch('SMTP configured', {
  smtp_host: SMTP_HOST,
  smtp_port: String(SMTP_PORT),
  smtp_user: SMTP_USER,
  smtp_pass: password,
  smtp_admin_email: SMTP_SENDER_EMAIL,
  smtp_sender_name: SMTP_SENDER_NAME,
  // The shared-sender cap of 2/hour no longer applies once you own the pipe.
  rate_limit_email_sent: 100,
});

if (!smtpConfigured) {
  console.error('\nStopping: templates cannot be customised until SMTP is accepted.');
  process.exit(1);
}

// Step 2 — branded templates.
await patch('Email templates branded', {
  mailer_subjects_confirmation: `Confirm your email — ${SMTP_SENDER_NAME}`,
  mailer_templates_confirmation_content: template({
    heading: 'Confirm your email address',
    intro:
      `Tap the button below to finish setting up your ${SMTP_SENDER_NAME} account. Next we will ` +
      `ask a few questions about your food, budget and schedule so your plan fits your actual life.`,
    cta: 'Confirm my email',
    outro: `If you did not sign up for ${SMTP_SENDER_NAME}, ignore this email and nothing happens.`,
  }),

  mailer_subjects_recovery: `Reset your ${SMTP_SENDER_NAME} password`,
  mailer_templates_recovery_content: template({
    heading: 'Reset your password',
    intro:
      'Tap below to choose a new password. Your food logs, weight history and plan are unchanged.',
    cta: 'Choose a new password',
    outro: 'If you did not ask for this, ignore this email — your password stays as it is.',
  }),

  mailer_subjects_magic_link: `Your ${SMTP_SENDER_NAME} sign-in link`,
  mailer_templates_magic_link_content: template({
    heading: `Sign in to ${SMTP_SENDER_NAME}`,
    intro: 'Tap below to sign in. The link works once and expires shortly.',
    cta: 'Sign in',
    outro: 'If you did not request this, you can safely ignore it.',
  }),

  mailer_subjects_email_change: `Confirm your new email — ${SMTP_SENDER_NAME}`,
  mailer_templates_email_change_content: template({
    heading: 'Confirm your new email address',
    intro: `Tap below to confirm the new address on your ${SMTP_SENDER_NAME} account.`,
    cta: 'Confirm new address',
    outro: 'If you did not request this change, ignore this email and check your account.',
  }),
});

// Step 3 — read back what actually landed, rather than trusting the 200s.
const live = await fetch(API, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const branded = String(live.mailer_templates_confirmation_content ?? '').includes(SMTP_SENDER_NAME);

console.log(
  [
    '',
    'Live configuration:',
    `  sender          ${live.smtp_sender_name} <${live.smtp_admin_email}>`,
    `  host            ${live.smtp_host}:${live.smtp_port}`,
    `  subject         ${live.mailer_subjects_confirmation}`,
    `  branded body    ${branded}`,
    `  emails per hour ${live.rate_limit_email_sent}`,
    `  site url        ${live.site_url}`,
    '',
    'Now sign up with a real address to confirm delivery, and check the spam folder.',
  ].join('\n'),
);

if (/gmail\.com/i.test(live.smtp_host ?? '')) {
  console.log(
    [
      '',
      'Gmail limits: about 500 recipients a day personal, 2,000 on Workspace.',
      'Fine for a private beta. Move to a domain-based sender before a real launch — a personal',
      'Gmail address as a transactional sender hurts deliverability and is not portable.',
    ].join('\n'),
  );
}
