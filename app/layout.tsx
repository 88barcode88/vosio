import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter, Newsreader } from "next/font/google";
import { PwaRegistration } from "@/components/pwa-registration";
import { PersistentRecordingSessionProvider } from "@/components/persistent-recording-session";
import { RecordingNavigationGuardProvider } from "@/components/recording-navigation-guard";
import { getVosioLicenseMarker } from "@/lib/license-marker";
import { normalizeTheme, VOSIO_THEME_COOKIE, VOSIO_THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-ui"
});

const newsreader = Newsreader({
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-heading"
});

const themeInitScript = `
try {
  var storedTheme = window.localStorage.getItem("${VOSIO_THEME_STORAGE_KEY}");
  var cookieMatch = document.cookie.match(/(?:^|; )${VOSIO_THEME_COOKIE}=([^;]+)/);
  var cookieTheme = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
  var theme = storedTheme || cookieTheme;
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
} catch (_) {
  document.documentElement.dataset.theme = "dark";
}
`;

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
  themeColor: "#061014",
  width: "device-width"
};

// RootLayout defines the global document shell for the Vosio Next.js app.
export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialTheme = normalizeTheme(cookieStore.get(VOSIO_THEME_COOKIE)?.value);

  return (
    <html data-theme={initialTheme} lang="cs" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${inter.variable} ${newsreader.variable}`}>
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
