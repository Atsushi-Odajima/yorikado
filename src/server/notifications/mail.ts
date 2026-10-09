import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { adminDb } from '@/server/db/supabase';
import { env } from '@/server/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super('MAIL_PROVIDER=none: email delivery is not configured');
  }
}

export interface MailAdapter {
  name: string;
  send(m: MailMessage): Promise<void>;
}

let transport: Transporter | null = null;

/**
 * Provider adapter. Development uses the Supabase local inbox (Mailpit via
 * SMTP) or the DB sink; production uses only an SMTP account contracted by the
 * operator. "none" refuses to send rather than pretending success.
 */
export function mailAdapter(): MailAdapter {
  const e = env();
  switch (e.mail.provider) {
    case 'smtp':
      return {
        name: 'smtp',
        async send(m) {
          if (!transport) {
            const s = e.mail.smtp!;
            transport = nodemailer.createTransport({
              host: s.host,
              port: s.port,
              secure: s.secure,
              auth: s.user ? { user: s.user, pass: s.password } : undefined,
            });
          }
          await transport.sendMail({ from: e.mail.from, to: m.to, subject: m.subject, text: m.text });
        },
      };
    case 'sink':
      return {
        name: 'sink',
        async send(m) {
          const { error } = await adminDb().from('mail_sink').insert({ to_address: m.to, subject: m.subject, body: m.text });
          if (error) throw new Error('sink insert failed');
        },
      };
    default:
      return {
        name: 'none',
        async send() {
          throw new MailNotConfiguredError();
        },
      };
  }
}
