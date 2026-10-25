import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Toaster } from "sonner"
import { Providers } from "./providers"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata: Metadata = {
  title: { default: "Pollen", template: "%s · Pollen" },
  description: "AI-powered growth marketing for small businesses: email, contacts, segments and campaigns that sound like you.",
  icons: { icon: "/icon.svg" },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  )
}
