import type { Metadata } from "next";
import { AuthProvider } from "./components/auth/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creative Curator — Creative Workspace",
  description: "Explore ideas, shape brand direction, and organize creative outputs.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
