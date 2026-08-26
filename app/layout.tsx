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
  const socialImage = `${origin}/og-climbs.png`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: socialImage,
          width: 1536,
          height: 1024,
          alt: "A Fine Wall",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
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
