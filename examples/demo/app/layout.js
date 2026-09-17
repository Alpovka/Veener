import './globals.css';
import { Inter } from 'next/font/google';
import { ThemeProvider } from './_components/theme';
import SmoothScroll from './_components/smooth-scroll';
import { Analytics } from '@vercel/analytics/next';
import { SITE_URL } from './site';

// Runs before paint to set the theme class — prevents a flash of the wrong theme.
const noFlashTheme = `(function(){try{var t=localStorage.getItem('veneer-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

const title = 'Veneer — an MCP for in-app personalization';
const description =
  'Veneer is an open-source React npm package that lets your end users redesign your app with AI. The model writes real UI code that runs in a hard security sandbox and can only ever use the capabilities you register.';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: title,
    template: '%s · Veneer',
  },
  description,
  applicationName: 'Veneer',
  keywords: [
    'Veneer',
    'in-app personalization',
    'AI UI generation',
    'open-source React package',
    'MCP',
    'sandboxed interpreter',
    'generative UI',
    'open-source npm package',
  ],
  authors: [{ name: 'Veneer' }],
  category: 'technology',
  openGraph: {
    type: 'website',
    siteName: 'Veneer',
    title,
    description,
    url: SITE_URL,
    images: [
      {
        url: '/opengraph-image.png',
        width: 1200,
        height: 630,
        alt: 'Veneer — Let your users personalize the UI as they like.',
      }
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/twitter-image.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [{ url: '/icon.png', type: 'image/png' }],
  },
};

export const viewport = {
  themeColor: '#4f46e5',
};

export default function RootLayout({ children }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Veneer',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    description,
    author: { '@type': 'Organization', name: 'AlpovkaApps', url: 'https://alpovka.github.io/' },
  };
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body>
        <ThemeProvider>
          <SmoothScroll />
          {children}
        </ThemeProvider>
        <Analytics />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
