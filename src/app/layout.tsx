import type { Metadata } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/theme-provider";
import { getBriefFreshness } from "@/lib/market-brief-actions";
import { headerStatus } from "@/lib/header-status";
import { setupState } from "@/lib/setup/state";
import { SetupGate } from "@/components/setup/setup-gate";
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

/** The brief lives in the database, which may be unconfigured or unmigrated.
 * Nav already accepts a null status, so this degrades to a header without a
 * session stamp rather than taking down every route. */
async function safeStatus() {
  try {
    return headerStatus(new Date(), await getBriefFreshness());
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const state = setupState();
  const status = state.needsSetup ? null : await safeStatus();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${interTight.variable} min-h-screen antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
          <Nav status={status} incomplete={state.incomplete} />
          {/* No DATABASE_URL means no page can render, so every route shows the
              wizard. /setup's own page is the same component, so there is
              nothing to redirect and no loop to guard against. */}
          {state.needsSetup ? <SetupGate /> : children}
        </ThemeProvider>
      </body>
    </html>
  );
}
