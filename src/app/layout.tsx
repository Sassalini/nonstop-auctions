import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nonstop Auctions",
  description: "Premium live auction rooms and curated lots.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div aria-hidden="true" className="site-background" />
        <div aria-hidden="true" className="site-background-overlay" />
        <div className="relative z-10 min-h-screen">
          <AppHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
