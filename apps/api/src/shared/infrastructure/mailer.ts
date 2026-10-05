import nodemailer, { type Transporter } from 'nodemailer';
import type { ApiConfig } from '../../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class Mailer {
  private readonly transport: Transporter;

  constructor(private readonly config: ApiConfig) {
    this.transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
      ignoreTLS: true,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...message });
  }

  close(): void {
    this.transport.close();
  }
}
