export const metadata = {
  title: "Bot Chat MK",
  description: "LINE OA Bot backend — Makro Ranong",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
