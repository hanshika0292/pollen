import { PageHeader } from "@/components/pollen/ui"
import { NewTenantForm } from "./form"

export const metadata = { title: "New tenant" }

export default function NewTenantPage() {
  return (
    <>
      <PageHeader title="New tenant" description="Set up a workspace for a business you've signed. The owner gets a one-time password to share with them." />
      <NewTenantForm />
    </>
  )
}
