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

export function readyToSignEmail(to: string, contractTitle: string, link: string): OutboundEmail {
  const text =
    `Both sides have agreed the final text of "${contractTitle}". It's ready to sign.\n\n` +
    `Open it here: ${link}`;
  return {
    to,
    subject: `${contractTitle} is ready to sign`,
    text,
    html: wrap(
      'Ready to sign',
      `<p style="margin:0 0 14px"><strong>${escapeHtml(contractTitle)}</strong></p>` +
        '<p style="margin:0 0 14px">Both sides have agreed the final text.</p>' +
        `<p style="margin:0"><a href="${link}">Open the contract</a></p>`,
    ),
  };
}

export function reopenedEmail(to: string, reopenerOrg: string, contractTitle: string, link: string, discardedOrg?: string): OutboundEmail {
  const discarded = discardedOrg ? ` ${discardedOrg}'s signature was discarded and they will need to sign again.` : '';
  const text =
    `${reopenerOrg} reopened "${contractTitle}" for changes. ` +
    `Both sides will need to click Ready to sign again.${discarded}\n\n` +
    `Open it here: ${link}`;
  return {
    to,
    subject: `${reopenerOrg} reopened ${contractTitle}`,
    text,
    html: wrap(
      `${escapeHtml(reopenerOrg)} reopened a contract for changes`,
      `<p style="margin:0 0 14px"><strong>${escapeHtml(contractTitle)}</strong></p>` +
        `<p style="margin:0 0 14px">Both sides will need to click Ready to sign again.${escapeHtml(discarded)}</p>` +
        `<p style="margin:0"><a href="${link}">Open the contract</a></p>`,
    ),
  };
}

// To a chosen signer who hasn't joined the contract yet; the link signs them in and adds them.
export function signInToSignEmail(to: string, orgName: string, contractTitle: string, link: string): OutboundEmail {
  const text =
    `"${contractTitle}" is ready to sign, and you've been chosen to sign it for ${orgName}.\n\n` +
    `Open it here: ${link}\n\n` +
    'You will be sent a short code to confirm your email address.';
  return {
    to,
    subject: `Your signature is needed: ${contractTitle}`,
    text,
    html: wrap(
      'Your signature is needed',
      `<p style="margin:0 0 14px"><strong>${escapeHtml(contractTitle)}</strong> is ready to sign, and you've been chosen to sign it for ${escapeHtml(orgName)}.</p>` +
        `<p style="margin:0 0 14px"><a href="${link}">Open the contract</a></p>` +
        '<p style="margin:0;color:#555">You will be sent a short code to confirm your email address.</p>',
    ),
  };
}

export function signedEmail(to: string, contractTitle: string, link: string): OutboundEmail {
  const text = `"${contractTitle}" has been signed by both sides. The signed copy is ready to download.\n\nOpen it here: ${link}`;
  return {
    to,
    subject: `${contractTitle} is signed`,
    text,
    html: wrap(
      'Signed by both sides',
      `<p style="margin:0 0 14px"><strong>${escapeHtml(contractTitle)}</strong> has been signed by both sides.</p>` +
        `<p style="margin:0"><a href="${link}">Download the signed copy</a></p>`,
    ),
  };
}
