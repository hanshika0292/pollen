import { redirect } from "next/navigation"
import { getUser } from "@/lib/auth"
import { PollenLogo } from "@/components/pollen/logo"
import { LoginForm } from "./login-form"

export const metadata = { title: "Sign in" }

export default async function LoginPage() {
  if (await getUser()) redirect("/")
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <PollenLogo light />
        <div className="relative z-10 max-w-md space-y-5">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Marketing that sounds like <span className="text-honey">you</span>, sent in minutes.
          </h1>
          <p className="text-sidebar-foreground/75">
            Pollen learns your brand voice, drafts campaigns, checks them against a quality bar and sends them to exactly the right people.
          </p>
        </div>
        <p className="relative z-10 text-sm text-sidebar-foreground/60">Accounts are set up by the Pollen team. Need access? Ask your account manager.</p>
        <div aria-hidden className="absolute -bottom-40 -right-40 size-[520px] rounded-full bg-honey/10" />
        <div aria-hidden className="absolute -bottom-16 -right-10 size-[260px] rounded-full bg-honey/15" />
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden"><PollenLogo /></div>
          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground">Welcome back. Use the email your workspace was set up with.</p>
          </div>
          <LoginForm />
        </div>
      </section>
    </main>
  )
}
