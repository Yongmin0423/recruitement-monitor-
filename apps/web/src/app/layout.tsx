import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "채용 레이더",
  description: "내 조건에 맞는 새 채용공고를 모아보는 개인 화면",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
