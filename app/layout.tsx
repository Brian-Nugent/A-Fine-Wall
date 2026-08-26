import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import PwaRegistration from "./pwa-registration";
import UserProfileProvider from "./user-profile-provider";
import { parseUserProfileCookie } from "./user-profile";
import "./globals.css";

const title = "A Fine Wall";
const description = "Browse climbs set on A Fine Wall and see every hold in the problem.";
const canonicalOrigin = "https://a-fine-wall.bnugent1021.workers.dev";

export const metadata: Metadata = {
  metadataBase: new URL(canonicalOrigin),
  applicationName: title,
  title,
  description,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/a-fine-wall-icon-32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/a-fine-wall-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    shortcut: "/a-fine-wall-icon-32.png",
    apple: [
      {
        url: "/apple-touch-icon-v2.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title,
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
  },
  openGraph: {
    title,
    description,
    type: "website",
    url: canonicalOrigin,
    siteName: title,
    images: [
      {
        url: "/a-fine-wall-icon.png",
        width: 1254,
        height: 1254,
        alt: "A dog in front of the A Fine Wall climbing wall",
      },
    ],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: ["/a-fine-wall-icon.png"],
  },
};

export const viewport: Viewport = {
  initialScale: undefined,
  themeColor: "#ffffff",
  width: undefined,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const initialProfile = parseUserProfileCookie(requestHeaders.get("cookie"));

  return (
    <html lang="en">
      <body>
        <UserProfileProvider initialProfile={initialProfile}>
          {children}
        </UserProfileProvider>
        <PwaRegistration />
      </body>
    </html>
  );
}
