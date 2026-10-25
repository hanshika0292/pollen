import "server-only"
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2"
import nodemailer, { type Transporter } from "nodemailer"
import { z } from "zod"
import { unseal } from "@/lib/crypto"

/** BYOK sending: each workspace sends through its own SES account or SMTP server. */

export const sesConfigSchema = z.object({
  region: z.string().min(3),
  accessKeyId: z.string().min(10),
  secretAccessKey: z.string().min(10),
})
export const smtpConfigSchema = z.object({
  host: z.string().min(3),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().min(1),
  pass: z.string().min(1),
})

export type SenderRow = {
  id: string
  provider: "ses" | "smtp"
  from_name: string
  from_email: string
  reply_to: string | null
  config_encrypted: string
}

export function makeTransport(sender: Pick<SenderRow, "provider" | "config_encrypted">): Transporter {
  const config = JSON.parse(unseal(sender.config_encrypted))
  if (sender.provider === "ses") {
    const c = sesConfigSchema.parse(config)
    const sesClient = new SESv2Client({ region: c.region, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } })
    return nodemailer.createTransport({ SES: { sesClient, SendEmailCommand } })
  }
  const c = smtpConfigSchema.parse(config)
  return nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass } })
}

export function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<(br|\/p|\/h\d|\/li|\/tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim()
}

export async function sendOne(
  transport: Transporter,
  sender: Pick<SenderRow, "from_name" | "from_email" | "reply_to">,
  msg: { to: string; subject: string; html: string; headers?: Record<string, string> },
  retries = 3,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await transport.sendMail({
        from: { name: sender.from_name, address: sender.from_email },
        replyTo: sender.reply_to ?? undefined,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: htmlToText(msg.html),
        headers: msg.headers,
      })
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      // Auth/config failures won't fix themselves — don't burn retries on them.
      if (attempt >= retries || /auth|credential|signature|not verified|invalid/i.test(text)) throw err
      const network = /EBUSY|ENOTFOUND|ECONNRESET|ETIMEDOUT/.test(text)
      await new Promise((r) => setTimeout(r, network ? 2 ** attempt * 2000 : 2 ** (attempt - 1) * 1000))
    }
  }
}
