import { PollenLogo } from "@/components/pollen/logo"

export default function Suspended() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <PollenLogo />
      <h1 className="text-2xl font-semibold">This workspace is paused</h1>
      <p className="max-w-md text-muted-foreground">Your account manager has paused access. Reach out to them and they'll get you going again.</p>
    </main>
  )
}
