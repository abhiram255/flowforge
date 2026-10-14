import { env } from '../config/env'
import { logger } from '../config/logger'

export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface Mailer {
  readonly kind: 'console' | 'smtp'
  send(message: MailMessage): Promise<void>
}

/** Development transport: mail is logged, never silently dropped. */
const consoleMailer: Mailer = {
  kind: 'console',
  async send(message) {
    logger.info({ to: message.to, subject: message.subject }, `[mail:console] ${message.subject}\n${message.text}`)
  },
}

let smtpMailer: Mailer | null = null

export async function getMailer(): Promise<Mailer> {
  if (!env.SMTP_URL) return consoleMailer
  if (smtpMailer) return smtpMailer
  const nodemailer = await import('nodemailer')
  const transport = nodemailer.default.createTransport(env.SMTP_URL)
  smtpMailer = {
    kind: 'smtp',
    async send(message) {
      await transport.sendMail({ from: env.MAIL_FROM, ...message })
    },
  }
  return smtpMailer
}
