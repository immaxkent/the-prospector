/**
 * RFC 5322 message building. Plain text only, with an unsubscribe header so a recipient
 * always has a one-click way out (a legal requirement for B2B outreach in the UK).
 */
const encodeHeader = (value: string) =>
  // eslint-disable-next-line no-control-regex
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

export interface RawMessageInput {
  fromName: string;
  fromAddress: string;
  toName?: string | null;
  toAddress: string;
  subject: string;
  body: string;
  /** Set on a reply so mail clients thread it. */
  inReplyTo?: string | null;
  references?: readonly string[];
  unsubscribeMailto: string;
}

export function buildRawMessage(input: RawMessageInput) {
  const to = input.toName ? `${encodeHeader(input.toName)} <${input.toAddress}>` : input.toAddress;
  const headers = [
    `From: ${encodeHeader(input.fromName)} <${input.fromAddress}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    `List-Unsubscribe: <mailto:${input.unsubscribeMailto}?subject=unsubscribe>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references?.length) headers.push(`References: ${input.references.join(" ")}`);

  const body = input.body.replace(/\r?\n/g, "\r\n").trimEnd();
  const footer = `\r\n\r\n--\r\nReply "unsubscribe" and I will not contact you again.`;
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}${footer}`, "utf8").toString("base64url");
}

export function decodeRawMessage(raw: string) {
  return Buffer.from(raw, "base64url").toString("utf8");
}
