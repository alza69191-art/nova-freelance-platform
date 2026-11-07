const siteUrl = "https://nova-freelance-platform.onrender.com";

export default function robots() {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/"] },
      { userAgent: "Googlebot", allow: "/", disallow: ["/api/"] },
      { userAgent: "Bingbot", allow: "/", disallow: ["/api/"] }
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl
  };
}
