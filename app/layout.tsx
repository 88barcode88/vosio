import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import { PwaRegistration } from "@/components/pwa-registration";
import { ThemeStorageMigration } from "@/components/theme-storage-migration";
import { PersistentRecordingSessionProvider } from "@/components/persistent-recording-session";
import { RecordingNavigationGuardProvider } from "@/components/recording-navigation-guard";
import { getVosioLicenseMarker } from "@/lib/license-marker";
import { normalizeTheme, VOSIO_THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-ui"
});

export const metadata: Metadata = {
  applicationName: "Vosio",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vosio"
  },
  description: "Pracovní prostor pro nahrávky, přepisy a AI výstupy.",
  formatDetection: {
    telephone: false
  },
  icons: {
    apple: "/icons/vosio-180.png",
    icon: [
      { rel: "icon", url: "/vosio-logo.svg", type: "image/svg+xml" },
      { rel: "icon", url: "/icons/vosio-192.png", sizes: "192x192", type: "image/png" }
    ]
  },
  manifest: "/manifest.webmanifest",
  other: {
    "vosio-license-marker": getVosioLicenseMarker()
  },
  title: "Vosio"
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#171717",
  width: "device-width"
};

// RootLayout defines the global document shell for the Vosio Next.js app.
export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const storedTheme = cookieStore.get(VOSIO_THEME_COOKIE)?.value;
  const initialTheme = normalizeTheme(storedTheme);
  const themeSource = storedTheme === "dark" || storedTheme === "light" ? "cookie" : "default";

  return (
    <html data-theme={initialTheme} data-theme-source={themeSource} lang="cs" suppressHydrationWarning>
      <body className={inter.variable}>
        <ThemeStorageMigration />
        <RecordingNavigationGuardProvider>
          <PersistentRecordingSessionProvider>
            {children}
          </PersistentRecordingSessionProvider>
        </RecordingNavigationGuardProvider>
        <PwaRegistration />
      </body>
    </html>
  );
}
