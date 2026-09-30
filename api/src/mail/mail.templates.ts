import type { OutboundEmail } from './mail.provider.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function wrap(title: string, body: string): string {
  return [
    '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#111">',
    `<h2 style="font-size:17px;margin:0 0 12px">${title}</h2>`,
    body,
    '</div>',
  ].join('');
}

export function signInCodeEmail(to: string, code: string, ttlMinutes: number): OutboundEmail {
  const text = `Your sign-in code is ${code}. It expires in ${ttlMinutes} minutes and can be used once.`;
  return {
    to,
    subject: `${code} is your sign-in code`,
    text,
    html: wrap(
      'Your sign-in code',
      `<p style="font-size:30px;letter-spacing:5px;margin:0 0 12px"><strong>${code}</strong></p>` +
        `<p style="margin:0;color:#555">Expires in ${ttlMinutes} minutes and can be used once. ` +
        'If you did not ask for it, you can ignore this email.</p>',
    ),
  };
}

export function inviteEmail(
  to: string,
  inviterName: string,
  contractTitle: string,
  link: string,
): OutboundEmail {
  const text =
    `${inviterName} invited you to review "${contractTitle}".\n\n` +
    `Open it here: ${link}\n\n` +
    'You will be sent a short code to confirm your email address.';
  return {
    to,
    subject: `${inviterName} invited you to review ${contractTitle}`,
    text,
    html: wrap(
      `${escapeHtml(inviterName)} invited you to review a contract`,
      `<p style="margin:0 0 14px"><strong>${escapeHtml(contractTitle)}</strong></p>` +
        `<p style="margin:0 0 14px"><a href="${link}">Open the contract</a></p>` +
        '<p style="margin:0;color:#555">You will be sent a short code to confirm your email address.</p>',
    ),
  };
}

export function contractSentEmail(to: string, senderOrg: string, contractTitle: string, link: string): OutboundEmail {
  const text =
    `${senderOrg} sent you "${contractTitle}". It's your turn to review it.\n\n` +
    `Open it here: ${link}\n\n` +
    'You will be sent a short code to confirm your email address.';
  return {
    to,
    subject: `${senderOrg} sent you ${contractTitle}`,
    text,
    html: wrap(
      `${escapeHtml(senderOrg)} sent you a contract`,
      `<p style="margin:0 0 14px"><strong>${escapeHtml(contractTitle)}</strong></p>` +
        "<p style=\"margin:0 0 14px\">It's your turn to review it.</p>" +
        `<p style="margin:0 0 14px"><a href="${link}">Open the contract</a></p>` +
        '<p style="margin:0;color:#555">You will be sent a short code to confirm your email address.</p>',
    ),
  };
}
