/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  // pg and the AWS SDK are server-only and shouldn't be bundled.
  serverExternalPackages: ["pg", "@aws-sdk/client-sesv2"],
}

export default nextConfig
