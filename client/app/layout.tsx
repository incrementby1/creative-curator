import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creative Curator — Direction Studio",
  description: "Turn a creative goal into clear, actionable campaign directions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
