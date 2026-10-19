import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'OmniServe｜Architectural Visualization Studio',
  description: 'Architectural imagery, film, art direction and post-production for unbuilt places.',
  openGraph: {
    title: 'OmniServe｜Architectural Visualization Studio',
    description: 'Architectural imagery · Film & motion · Art direction · Post-production',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OmniServe｜Architectural Visualization Studio',
    description: 'Architectural imagery · Film & motion · Art direction · Post-production',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
