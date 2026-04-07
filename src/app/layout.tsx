import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PostHogProvider } from "@/components/PostHogProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "melch.cloud | Command Center",
  description: "Command center for media buying teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-satoshi bg-brand-bg min-h-screen text-brand-text-primary antialiased">
        <PostHogProvider>
          {children}
        </PostHogProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
