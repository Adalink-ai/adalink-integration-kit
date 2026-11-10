import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Adaflow para v0',
  description: 'Blocos da Adaflow para abrir no v0: chat com especialistas e agentes autônomos',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
