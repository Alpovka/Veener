export default function robots() {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: 'https://veneer.dev/sitemap.xml',
  };
}
