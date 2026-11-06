# Third-party notices

Pollen is released under the MIT License (see [LICENSE](LICENSE)). This file lists third-party
material that is copied into this repository or shipped with a build of it.

## shadcn/ui

Most of the UI primitives in this repository were generated with the shadcn/ui CLI, which copies
component source into the project. Some of them may have been edited since.

- Project: https://github.com/shadcn-ui/ui
- Copied into: `components/ui/` (every file except `confirm-dialog.tsx`, which is Pollen's own),
  `hooks/use-mobile.ts`, `hooks/use-toast.ts`, `components/theme-provider.tsx`, the default
  theme in `styles/globals.css`, and the theme-variable layout of `app/globals.css` (the colour
  values there are Pollen's own)
- Configuration: `components.json`

```
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Inter (font)

The app uses the Inter typeface through `next/font/google` (`app/layout.tsx`). The font files are
not in this repository. Next.js downloads them at build time and serves them with the built app.

- Project: https://github.com/rsms/inter
- License: SIL Open Font License 1.1, Copyright (c) 2016 The Inter Project Authors

## npm dependencies

Everything else Pollen uses (Next.js, React, Radix UI, the Vercel AI SDK, node-postgres,
NextAuth, Nodemailer, the AWS SDK, Cheerio, Recharts, Lucide icons, Zod and the rest of
`package.json`) is installed from npm when you run `npm install`. Those packages are not
included in this repository and are used under their own licenses.

## Pollen's own assets

The Pollen logo (`public/icon.svg`, `components/pollen/logo.tsx`) and the screenshots and social
preview image in `docs/` were made for this project and are covered by Pollen's MIT License. The
screenshots show the seeded demo workspace, whose business, people and contact details are
fictional.
