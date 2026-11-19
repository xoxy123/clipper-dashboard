// Copy of the Shredbound repo's Tools/online/orders/mail.ts (Gmail SMTP, MAIL_APP_PASSWORD).
// A small SMTP client for one job: one plain-text mail through Gmail's
// smtp.gmail.com on port 465, TLS from the first byte. Supabase's edge runtime
// blocks ports 25 and 587 (so no STARTTLS), and 465 is what Gmail offers with
// an app password. No dependency: the few commands are written out here.

export interface MailAccount {
  /** The Gmail address that logs in and sends (and gets the replies). */
  user: string;
  /** Its 16-letter Google app password (spaces are dropped). */
  password: string;
  /** The name shown as the sender. */
  fromName: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Why a mail did not go out:
 *   login       the account or its app password was refused (no mail can go out)
 *   connection  no answer, a closed line or a timeout (try again later)
 *   recipient   the address was refused for good (no point trying it again)
 *   rejected    the server refused this mail for now (try again later)
 */
export type MailFailure = "login" | "connection" | "recipient" | "rejected";

export class MailError extends Error {
  constructor(public kind: MailFailure, public smtpCode: number, message: string) {
    super(message);
  }
}

/** A connection: Deno.TlsConn has this shape, and so does a test's fake. */
export interface Pipe {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): void;
}

export type Connect = () => Promise<Pipe>;

export const gmail: Connect = () => Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });

// A mail address as a buyer types it into Stripe; anything with spaces, angle
// brackets or line breaks is refused (it would end up in a header).
const EMAIL =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function cleanEmail(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length <= 254 && EMAIL.test(text) ? text : null;
}

const encoder = new TextEncoder();

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

function wrap(text: string, width: number): string {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) {
    lines.push(text.slice(i, i + width));
  }

  return lines.join("\r\n");
}

// A header word: plain when it is plain ASCII, else RFC 2047 base64.
function headerWord(text: string): string {
  return /^[\x20-\x7E]*$/.test(text) && !/[<>"=?]/.test(text)
    ? text
    : `=?UTF-8?B?${base64(encoder.encode(text))}?=`;
}

/** The whole message as it goes after DATA, headers and a base64 body, CRLF line ends. */
export function message(account: MailAccount, mail: Mail, now = new Date()): string {
  if (!cleanEmail(mail.to) || !cleanEmail(account.user)) {
    throw new MailError("recipient", 0, "not a mail address");
  }

  const domain = account.user.split("@")[1];
  const headers = [
    `From: ${headerWord(account.fromName)} <${account.user}>`,
    `To: <${mail.to}>`,
    `Reply-To: <${account.user}>`,
    `Subject: ${headerWord(mail.subject)}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const body = wrap(base64(encoder.encode(mail.text.replace(/\r?\n/g, "\r\n"))), 76);
  return headers.join("\r\n") + "\r\n\r\n" + body;
}

function firstLine(text: string): string {
  return text.split("\n")[0].trim().slice(0, 200);
}

class Session {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = "";

  constructor(private pipe: Pipe) {
    this.reader = pipe.readable.getReader();
    this.writer = pipe.writable.getWriter();
  }

  // One reply: its lines until the one without a dash after the code.
  async read(): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    for (;;) {
      let end = this.buffer.indexOf("\r\n");
      while (end < 0) {
        const { value, done } = await this.reader.read();
        if (done) {
          throw new MailError("connection", 0, "the mail server closed the line");
        }

        this.buffer += this.decoder.decode(value, { stream: true });
        if (this.buffer.length > 65_536) {
          throw new MailError("connection", 0, "the mail server sent too much");
        }

        end = this.buffer.indexOf("\r\n");
      }

      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      lines.push(line);
      if (!/^\d{3}-/.test(line)) {
        const code = Number(line.slice(0, 3));
        return { code: Number.isInteger(code) ? code : 0, text: lines.join("\n") };
      }
    }
  }

  async write(text: string): Promise<void> {
    await this.writer.write(encoder.encode(text + "\r\n"));
  }

  // Sends a line (or nothing, for the greeting) and wants one of the codes.
  // The error names the step, never the line sent (the login line holds the password).
  async expect(line: string | null, ok: number[], kind: MailFailure, step: string): Promise<string> {
    if (line !== null) {
      await this.write(line);
    }

    const reply = await this.read();
    if (!ok.includes(reply.code)) {
      let failure = kind;
      if (kind === "recipient" && reply.code >= 400 && reply.code < 500) {
        failure = "rejected";
      }

      throw new MailError(failure, reply.code, `${step}: ${firstLine(reply.text)}`);
    }

    return reply.text;
  }

  close(): void {
    try {
      this.pipe.close();
    } catch {
      // already closed
    }
  }
}

async function timed<T>(work: Promise<T>, ms: number, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MailError("connection", 0, `${step}: no answer in ${ms / 1000} s`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Logs in and out without sending anything, to check the setup: "login ok"
 * when the account and its app password are taken (or, with no password, the
 * server's hello line); a MailError otherwise.
 */
export async function checkLogin(account: MailAccount, connect: Connect = gmail, timeoutMs = 20_000): Promise<string> {
  const pipe = await timed(connect(), 10_000, "connect").catch((error) => {
    throw error instanceof MailError ? error : new MailError("connection", 0, "connect: the mail server could not be reached");
  });
  const session = new Session(pipe);
  const work = (async () => {
    await session.expect(null, [220], "connection", "greeting");
    const hello = await session.expect("EHLO shredbound", [250], "connection", "hello");
    if (account.password) {
      await session.expect("AUTH PLAIN " + base64(encoder.encode(`\0${account.user}\0${account.password}`)), [235], "login", "login");
    }

    await session.write("QUIT").catch(() => {});
    return account.password ? "login ok" : firstLine(hello);
  })();
  work.catch(() => {});
  try {
    return await timed(work, timeoutMs, "login");
  } finally {
    session.close();
  }
}

/** Sends one mail; the server's answer to the message on success, a MailError otherwise. */
export async function sendMail(account: MailAccount, mail: Mail, connect: Connect = gmail, timeoutMs = 30_000): Promise<string> {
  const data = message(account, mail);
  const pipe = await timed(connect(), 10_000, "connect").catch((error) => {
    throw error instanceof MailError ? error : new MailError("connection", 0, "connect: the mail server could not be reached");
  });
  const session = new Session(pipe);
  const work = (async () => {
    await session.expect(null, [220], "connection", "greeting");
    await session.expect("EHLO shredbound", [250], "connection", "hello");
    await session.expect("AUTH PLAIN " + base64(encoder.encode(`\0${account.user}\0${account.password}`)), [235], "login", "login");
    await session.expect(`MAIL FROM:<${account.user}>`, [250], "connection", "sender");
    await session.expect(`RCPT TO:<${mail.to}>`, [250, 251], "recipient", "recipient");
    await session.expect("DATA", [354], "rejected", "data");
    // A line that starts with a dot gets a second one (the body is base64, so
    // none does, but the rule costs nothing); a lone dot ends the message.
    const accepted = await session.expect(data.replace(/^\./gm, "..") + "\r\n.", [250], "rejected", "message");
    await session.write("QUIT").catch(() => {});
    return firstLine(accepted);
  })();
  work.catch(() => {});
  try {
    return await timed(work, timeoutMs, "mail");
  } finally {
    session.close();
  }
}
