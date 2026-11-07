import "./globals.css";

const siteUrl = "https://nova-freelance-platform.onrender.com";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "NOVA — منصة العمل الحر",
    template: "%s | NOVA"
  },
  description: "منصة عربية للعمل الحر والخدمات والمشاريع. اكتشف الخدمات، انشر مشروعك، وتواصل مع المستقلين والعملاء في مكان واحد.",
  applicationName: "NOVA",
  manifest: "/manifest.json",
  alternates: { canonical: "/" },
  verification: {
    google: "lZ0Zz3K7Cplr5vKpdXp-g1gPe5deSqvOt-g39D0oWaE"
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "NOVA",
    title: "NOVA — منصة العمل الحر",
    description: "منصة عربية للخدمات والمشاريع والعمل الحر.",
    locale: "ar_AR"
  },
  twitter: {
    card: "summary",
    title: "NOVA — منصة العمل الحر",
    description: "منصة عربية للخدمات والمشاريع والعمل الحر."
  },
  robots: { index: true, follow: true }
};

export default function RootLayout({ children }) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
