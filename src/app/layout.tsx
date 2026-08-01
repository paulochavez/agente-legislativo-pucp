import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Legisla | Agente de proyectos de ley",
  description: "Agente PUCP que decide entre un grafo Neo4j y recuperación RAG.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
