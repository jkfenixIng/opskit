import type { Metadata, Viewport } from 'next';
import { intlLocale, messages } from '../i18n';
import './styles.css';

export const metadata: Metadata = { title: messages.meta.title, description: messages.meta.description };
export const viewport: Viewport = { themeColor: '#10201f' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang={intlLocale} suppressHydrationWarning><body>{children}</body></html>;
}
