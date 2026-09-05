import type { Metadata } from "next";
import { GenesisVault } from "@/components/GenesisVault";

export const metadata: Metadata = {
  title: "Genesis Vault · Hedgents",
  description: "Explore the proposed gold-backed Genesis Relics fixed-deck economy.",
};

export default function RelicsPage() {
  return <GenesisVault />;
}
