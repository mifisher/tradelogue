import type { Metadata } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/theme-provider";
import { getBriefFreshness } from "@/lib/market-brief-actions";
import { headerStatus } from "@/lib/header-status";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  weight: ["500"],
});

export const metadata: Metadata = {
  title: "Tradelogue",
  description: "A local-first, AI-native trading journal for options day traders",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Computed on the server so the stamp never disagrees with the PT session the
  // pages filter on, and never flickers in after hydration.
  const status = headerStatus(new Date(), await getBriefFreshness());

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${interTight.variable} min-h-screen antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
          <Nav status={status} />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
