import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { CartProvider } from "@/components/Cart";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "PayOps — Cairo streetwear",
  description: "Cairo streetwear for your everyday rotation. Explore the first PayOps collection.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <CartProvider><Header />
        <main className="flex-1">{children}</main>
        <Footer /></CartProvider>
      </body>
    </html>
  );
}
