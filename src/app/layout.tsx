import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { DatabaseProvider } from "@/context/DatabaseContext";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-dm-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pointe POS",
  description: "Multi-tenant, offline-first point-of-sale platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1512" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmSerif.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased selection:bg-[#d7a35d]/30">
        <ThemeProvider>
          <AuthProvider>
            <DatabaseProvider>
              {children}
            </DatabaseProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
