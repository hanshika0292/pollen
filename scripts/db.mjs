// Usage:
//   node --env-file=.env.local scripts/db.mjs migrate   # apply db/migrations/*.sql (as the DB owner)
//   node --env-file=.env.local scripts/db.mjs seed      # platform admin + demo tenant (idempotent)
//
// Needs DATABASE_ADMIN_URL (owner connection). `migrate` also sets the
// pollen_app role's password from POLLEN_APP_PASSWORD so the app can log in.

import { readFileSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import pg from "pg"
import bcrypt from "bcryptjs"
import { randomUUID } from "crypto"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const url = process.env.DATABASE_ADMIN_URL
if (!url) {
  console.error("DATABASE_ADMIN_URL is not set")
  process.exit(1)
}
const client = new pg.Client({ connectionString: url, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } })
await client.connect()

async function migrate() {
  await client.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`)
  await client.query(`alter table schema_migrations enable row level security`)
  const done = new Set((await client.query(`select name from schema_migrations`)).rows.map((r) => r.name))
  const dir = join(root, "db", "migrations")
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue
    process.stdout.write(`applying ${file}… `)
    await client.query("begin")
    try {
      await client.query(readFileSync(join(dir, file), "utf8"))
      await client.query(`insert into schema_migrations (name) values ($1)`, [file])
      await client.query("commit")
      console.log("ok")
    } catch (e) {
      await client.query("rollback")
      throw e
    }
  }
  if (process.env.POLLEN_APP_PASSWORD) {
    await client.query(`alter role pollen_app with password '${process.env.POLLEN_APP_PASSWORD.replace(/'/g, "''")}'`)
    console.log("pollen_app password set")
  }
}

// ─── Seed ────────────────────────────────────────────────────────────────────

const FIRST = ["Aarav","Diya","Kabir","Meera","Rohan","Ananya","Vikram","Isha","Arjun","Saanvi","Neel","Tara","Dev","Kavya","Rahul","Nisha","Aditya","Pooja","Karan","Riya","Sameer","Zoya","Farhan","Leela","Omar","Priya","Yash","Aisha","Manav","Sneha"]
const LAST = ["Sharma","Iyer","Khan","Reddy","Nair","Mehta","Das","Rao","Kapoor","Menon","Joshi","Pillai","Bose","Singh","Fernandes"]
const TAGS = ["regular","weekend-brunch","coffee-club","catering","lapsed","vegan"]
const FAVS = ["cold brew","filter coffee","cardamom bun","sourdough","matcha latte","banana bread"]

function rng(seed) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
}

async function upsertUser(email, name, password, isAdmin) {
  const hash = await bcrypt.hash(password, 12)
  const { rows } = await client.query(
    `insert into users (email, name, password_hash, is_platform_admin) values ($1,$2,$3,$4)
     on conflict (email) do update set name = excluded.name, password_hash = excluded.password_hash, is_platform_admin = excluded.is_platform_admin
     returning id`,
    [email, name, hash, isAdmin],
  )
  return rows[0].id
}

async function seed() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL
  const adminPassword = process.env.SEED_ADMIN_PASSWORD
  const demoPassword = process.env.SEED_DEMO_PASSWORD
  if (!adminEmail || !adminPassword || !demoPassword) throw new Error("Set SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_DEMO_PASSWORD")

  await client.query("begin")
  const adminId = await upsertUser(adminEmail, "Pollen Admin", adminPassword, true)
  const ownerId = await upsertUser("owner@bloombrew.example", "Asha Menon", demoPassword, false)

  const existing = await client.query(`select id from workspaces where slug = 'bloom-brew'`)
  if (existing.rowCount) {
    // Re-seeding replaces the demo tenant wholesale so it's always in a known state.
    await client.query(`delete from workspaces where id = $1`, [existing.rows[0].id])
  }
  const ws = (await client.query(
    `insert into workspaces (slug, name, industry, website, plan, is_demo, notes, created_by)
     values ('bloom-brew', 'Bloom & Brew Café', 'Café & bakery', 'https://bloomandbrew.example', 'growth', true,
             'Demo tenant for sales walkthroughs. All contacts use example.com addresses.', $1) returning id`,
    [adminId],
  )).rows[0].id
  await client.query(`insert into memberships (workspace_id, user_id, role) values ($1,$2,'owner')`, [ws, ownerId])

  await client.query(
    `insert into brand_kits (workspace_id, display_name, primary_color, accent_color, website, address, footer_text, voice)
     values ($1, 'Bloom & Brew', '#3d6b4f', '#e9b44c', 'https://bloomandbrew.example',
             'Bloom & Brew Café, 12 Sample Street, Indiranagar, Bengaluru',
             'You''re getting this because you signed up at the café or on our website.', $2)`,
    [ws, JSON.stringify({
      summary: "A neighbourhood café and bakery in Indiranagar that talks like a friendly barista who remembers your order. Warm, a little playful, always specific about what's fresh.",
      audience: "Young professionals and families nearby who treat the café as their weekend ritual and work-from-café spot.",
      tone: ["warm", "playful", "specific", "unhurried"],
      formality: "conversational",
      emoji: "light",
      do: ["Name specific bakes and drinks", "Write like the owner is talking", "Keep paragraphs to 1-2 sentences", "Mention timing (fresh at 8am, weekends only)"],
      dont: ["Hard-sell or use countdown pressure", "Use corporate words like 'leverage' or 'solutions'", "Promise discounts that weren't announced", "Use more than two emoji"],
      preferred_words: ["fresh", "neighbourhood", "slow mornings", "baked this morning"],
      avoid_words: ["deal", "limited time", "customers"],
      sample_phrases: ["The cardamom buns are out of the oven — come early.", "Your usual table's waiting.", "Slow mornings, strong coffee."],
    })],
  )

  const r = rng(42)
  const pick = (a) => a[Math.floor(r() * a.length)]
  const contactIds = []
  for (let i = 0; i < 64; i++) {
    const first = FIRST[i % FIRST.length]
    const last = pick(LAST)
    const tags = TAGS.filter(() => r() < 0.3)
    const status = i % 23 === 7 ? "unsubscribed" : i % 31 === 11 ? "bounced" : "subscribed"
    const joinedDaysAgo = Math.floor(r() * 300)
    const engagedDaysAgo = r() < 0.15 ? null : Math.floor(r() * Math.min(joinedDaysAgo + 1, 120))
    // Placeholder numbers only (+91 90000 000NN), never real ones.
    const phone = r() < 0.7 ? "919000" + String(i).padStart(6, "0") : null
    const { rows } = await client.query(
      `insert into contacts (workspace_id, email, first_name, last_name, phone, status, source, tags, attributes, created_at, last_engaged_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - make_interval(days => $10), case when $11::int is null then null else now() - make_interval(days => $11::int) end)
       returning id`,
      [ws, `${first}.${last}${i}`.toLowerCase() + "@example.com", first, last, phone, status, i < 40 ? "import" : pick(["form", "manual"]),
       tags, { city: "Bengaluru", favourite: pick(FAVS) }, joinedDaysAgo, engagedDaysAgo],
    )
    contactIds.push({ id: rows[0].id, status, tags })
  }

  const club = (await client.query(`insert into lists (workspace_id, name, description) values ($1,'Coffee Club','Loyalty card members') returning id`, [ws])).rows[0].id
  const catering = (await client.query(`insert into lists (workspace_id, name, description) values ($1,'Catering enquiries','Office & event catering leads') returning id`, [ws])).rows[0].id
  for (const c of contactIds) {
    if (c.tags.includes("coffee-club") || r() < 0.2) await client.query(`insert into list_members (workspace_id, list_id, contact_id) values ($1,$2,$3)`, [ws, club, c.id])
    if (c.tags.includes("catering")) await client.query(`insert into list_members (workspace_id, list_id, contact_id) values ($1,$2,$3)`, [ws, catering, c.id])
  }

  await client.query(
    `insert into segments (workspace_id, name, description, rules, ai_prompt) values
     ($1, 'Weekend brunch regulars', 'Subscribed brunch-goers who engaged in the last 60 days', $2, 'people who come for weekend brunch and have been active in the last two months'),
     ($1, 'Win-back: lapsed', 'Subscribed, no engagement in 90+ days', $3, null)`,
    [ws,
     { match: "all", conditions: [{ field: "status", op: "is", value: "subscribed" }, { field: "tag", op: "has", value: "weekend-brunch" }, { field: "engaged_days", op: "within", value: "60" }] },
     { match: "all", conditions: [{ field: "status", op: "is", value: "subscribed" }, { field: "engaged_days", op: "older_than", value: "90" }] }],
  )

  // One sent campaign with illustrative engagement so the dashboard isn't empty.
  const sentBlocks = [
    { type: "paragraph", text: "Hi {{first_name|there}},", items: [], url: "" },
    { type: "paragraph", text: "The rain's here, and so is our **monsoon menu** — masala chai affogato, pepper-jaggery cookies and a ginger cold brew that tastes like a warm blanket.", items: [], url: "" },
    { type: "bullets", text: "", items: ["Masala chai affogato", "Pepper-jaggery cookies (baked at 8am)", "Ginger cold brew"], url: "" },
    { type: "cta", text: "See the monsoon menu", items: [], url: "https://bloomandbrew.example/menu" },
    { type: "paragraph", text: "See you at your usual table,\nAsha & the Bloom & Brew crew", items: [], url: "" },
  ]
  const sent = (await client.query(
    `insert into campaigns (workspace_id, name, subject, preview_text, blocks, status, audience, recipients, sent_count, sent_at, created_by, created_at)
     values ($1,'Monsoon menu launch','Chai affogato has entered the chat','Three new rainy-day treats, fresh from 8am',$2,'sent','{"type":"all"}',$3,$3, now() - interval '9 days', $4, now() - interval '10 days')
     returning id`,
    [ws, JSON.stringify(sentBlocks), contactIds.filter((c) => c.status === "subscribed").length, ownerId],
  )).rows[0].id
  for (const c of contactIds.filter((c) => c.status === "subscribed")) {
    const when = `now() - interval '9 days' + make_interval(mins => ${Math.floor(r() * 3000)})`
    await client.query(`insert into email_events (workspace_id, campaign_id, contact_id, type, occurred_at) values ($1,$2,$3,'sent', now() - interval '9 days')`, [ws, sent, c.id])
    if (r() < 0.52) {
      await client.query(`insert into email_events (workspace_id, campaign_id, contact_id, type, occurred_at) values ($1,$2,$3,'open', ${when})`, [ws, sent, c.id])
      if (r() < 0.35) await client.query(`insert into email_events (workspace_id, campaign_id, contact_id, type, meta, occurred_at) values ($1,$2,$3,'click','{"url":"https://bloomandbrew.example/menu"}', ${when} + interval '2 minutes')`, [ws, sent, c.id])
    }
  }

  await client.query(
    `insert into campaigns (workspace_id, name, subject, preview_text, blocks, status, audience, brief, created_by)
     values ($1,'Weekend brunch invite','','', '[]','draft', $2, 'Invite brunch regulars to try the new shakshuka + sourdough plate this weekend, 9am-1pm. No discount.', $3)`,
    [ws, JSON.stringify({ type: "list", id: club }), ownerId],
  )


  // WhatsApp demo: a connection (dummy token — sending stays disabled) + sample threads.
  await client.query(
    `insert into wa_credentials (workspace_id, phone_number_id, waba_id, display_phone, token_encrypted, verify_token, auto_reply, last_ok_at)
     values ($1, '100000000000001', '200000000000002', '+91 90000 00000', 'demo-placeholder-not-a-real-token', $2, $3, now())`,
    [ws, randomUUID(), JSON.stringify({ mode: "ai" })],
  )
  const waThreads = [
    { phone: "919000000101", name: "Rahul Sharma", mins: 40, msgs: [
      ["in", "Hi! Are you open for brunch this Sunday?"],
      ["out", "Hi Rahul! Yes — brunch runs 9am to 1pm on Sunday. The shakshuka plate is back this week 🍳"],
      ["in", "Perfect, can I book a table for 4 at 10?"],
    ] },
    { phone: "919000000102", name: "Priya Menon", mins: 5, msgs: [
      ["in", "Do you have anything vegan for the cardamom buns?"],
    ] },
    { phone: "919000000103", name: "Sameer", mins: 3000, msgs: [
      ["in", "Loved the cold brew yesterday!"],
      ["out", "So glad, Sameer! 💚 See you next time."],
    ] },
  ]
  for (const t of waThreads) {
    const convo = (await client.query(
      `insert into wa_conversations (workspace_id, wa_phone, name, last_message_at, last_inbound_at, unread)
       values ($1,$2,$3, now() - make_interval(mins => $4), now() - make_interval(mins => $4), $5) returning id`,
      [ws, t.phone, t.name, t.mins, t.msgs.filter(m => m[0] === "in").length && t.msgs[t.msgs.length-1][0] === "in" ? 1 : 0],
    )).rows[0].id
    let step = t.msgs.length
    for (const [dir, body] of t.msgs) {
      await client.query(
        `insert into wa_messages (workspace_id, conversation_id, direction, type, body, status, created_at)
         values ($1,$2,$3,'text',$4,$5, now() - make_interval(mins => $6))`,
        [ws, convo, dir, body, dir === "out" ? "read" : null, t.mins + step],
      )
      step--
    }
  }

  await client.query(`insert into audit_log (workspace_id, actor_user_id, action, target) values ($1,$2,'workspace.seeded','bloom-brew')`, [ws, adminId])
  await client.query("commit")
  console.log(`seeded: admin ${adminEmail}, demo tenant bloom-brew (owner owner@bloombrew.example), ${contactIds.length} contacts`)
}

try {
  const cmd = process.argv[2]
  if (cmd === "migrate") await migrate()
  else if (cmd === "seed") await seed()
  else console.error("usage: db.mjs migrate|seed")
} catch (e) {
  await client.query("rollback").catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
