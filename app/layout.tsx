import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import UserProfileProvider from "./user-profile-provider";
import { parseUserProfileCookie } from "./user-profile";
import "./globals.css";

const title = "A Fine Wall";
const description = "Browse climbs set on A Fine Wall and see every hold in the problem.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0];
  const host = forwardedHost?.trim() || requestHeaders.get("host") || "localhost:3000";
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProtocol || (host.startsWith("localhost") ? "http" : "https");
  const origin = new URL(`${protocol}://${host}`).origin;
  const socialImage = `${origin}/a-fine-wall-icon.png`;

  return {
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
          url: "/a-fine-wall-icon-180.png",
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
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: socialImage,
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
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#ffffff",
  width: "device-width",
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
      </body>
    </html>
  );
}
