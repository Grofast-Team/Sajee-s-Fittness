#!/usr/bin/env node
/**
 * Test SMTP credentials directly, and report the server's actual reply.
 *
 * Supabase surfaces every mail failure as the same opaque
 * `500 Error sending recovery email`, which tells you nothing about whether the
 * password is wrong, the account is blocked, or the port is unreachable. This
 * talks to the mail server itself so the real reason is visible.
 *
 * Usage:
 *   SMTP_HOST=smtp.gmail.com SMTP_PORT=587 \
 *   SMTP_USER=you@gmail.com SMTP_PASS="abcd efgh ijkl mnop" \
 *   node scripts/test-smtp.mjs
 */

import net from 'node:net';
import tls from 'node:tls';

const HOST = process.env.SMTP_HOST ?? 'smtp.gmail.com';
const PORT = Number(process.env.SMTP_PORT ?? 587);
const USER = process.env.SMTP_USER;
const PASS = (process.env.SMTP_PASS ?? '').replace(/\s+/g, '');

if (!USER || !PASS) {
  console.error('SMTP_USER and SMTP_PASS are required.');
  process.exit(1);
}

/** Read one SMTP reply. Multi-line replies use `250-`; the last uses `250 `. */
function readReply(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        socket.removeListener('data', onData);
        resolve(buffer.trim());
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
    setTimeout(() => reject(new Error('timed out waiting for a reply')), 15_000);
  });
}

async function send(socket, line, label) {
  // Never print the credentials themselves.
  console.log(`  → ${label ?? line}`);
  socket.write(`${line}\r\n`);
  const reply = await readReply(socket);
  console.log(`  ← ${reply.split('\r\n')[0]}`);
  return reply;
}

console.log(`Connecting to ${HOST}:${PORT} as ${USER}\n`);

let socket;
try {
  socket = net.createConnection({ host: HOST, port: PORT });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
    setTimeout(() => reject(new Error('connection timed out')), 15_000);
  });
  console.log(`  ← ${(await readReply(socket)).split('\r\n')[0]}`);

  await send(socket, 'EHLO fitcoach.local');
  const starttls = await send(socket, 'STARTTLS');
  if (!starttls.startsWith('220')) {
    console.error('\nServer refused STARTTLS. Try port 465, or check the host.');
    process.exit(1);
  }

  const secure = tls.connect({ socket, servername: HOST });
  await new Promise((resolve, reject) => {
    secure.once('secureConnect', resolve);
    secure.once('error', reject);
  });
  console.log('  ✓ TLS established\n');

  await send(secure, 'EHLO fitcoach.local');

  // AUTH LOGIN sends the username and password as separate base64 lines.
  const auth = await send(secure, 'AUTH LOGIN', 'AUTH LOGIN');
  if (!auth.startsWith('334')) {
    console.error('\nServer did not offer AUTH LOGIN.');
    process.exit(1);
  }
  await send(secure, Buffer.from(USER).toString('base64'), '<username>');
  const result = await send(secure, Buffer.from(PASS).toString('base64'), '<password>');

  secure.write('QUIT\r\n');

  console.log();
  if (result.startsWith('235')) {
    console.log('✓ AUTHENTICATION SUCCEEDED — these credentials work.');
    console.log('  If Supabase still fails, the problem is on its side, not the password.');
    process.exit(0);
  }

  console.log('✗ AUTHENTICATION FAILED');
  console.log(`  Server said: ${result.split('\r\n')[0]}`);
  if (/535/.test(result)) {
    console.log(
      [
        '',
        '  535 means the username or password was rejected. Usually one of:',
        '    - the App Password belongs to a different Google account',
        '    - it was mistyped, or regenerated and this is the old one',
        '    - 2-Step Verification was turned off again (this revokes App Passwords)',
      ].join('\n'),
    );
  }
  process.exit(1);
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
} finally {
  socket?.destroy();
}
