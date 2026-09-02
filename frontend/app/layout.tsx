import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI SCORM Studio",
  description: "Soạn bài giảng SCORM 2004 dành cho giáo viên Việt Nam.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
