import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "@/styles/tokens.css";
import { Providers } from "./providers";

// Archivo with the width axis: the prototypes use font-stretch 100-125% for headings and numbers.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: "Paritas · The best price on every stock token",
  description: "Paritas routes every Robinhood Chain stock token trade across its oracle-anchored vaults, Uniswap and market makers, and shows you a receipt for every fill.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body style={{ fontFamily: "var(--font-archivo), var(--font)" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
