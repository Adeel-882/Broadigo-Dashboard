import type { Metadata } from "next";
import { Archivo, Manrope } from "next/font/google";
import "./globals.css";
import "./leadsedge-system.css";

const leadsEdgeDisplay = Archivo({
  subsets: ["latin"],
  variable: "--font-le-display",
  display: "swap",
});

const leadsEdgeUi = Manrope({
  subsets: ["latin"],
  variable: "--font-le-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LeadsEdge Executive Command Center",
  description: "Slack-powered executive employee performance intelligence",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${leadsEdgeDisplay.variable} ${leadsEdgeUi.variable}`}><body>{children}</body></html>;
}
