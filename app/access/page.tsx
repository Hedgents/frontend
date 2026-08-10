import Image from "next/image";
import { AuthGate } from "./AuthGate";
import styles from "./access.module.css";
import { safeLocalRedirectPath } from "@/lib/access-auth";

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const requested = (await searchParams).next;
  const nextPath = safeLocalRedirectPath(requested);
  return (
    <main className={styles.shell}>
      <section className={styles.panel}>
        <Image className={styles.logo} src="/brand/hedgents-source-lockup-transparent.png" alt="Hedgents" width={1396} height={329} priority />
        <p className={styles.eyebrow}>Closed execution beta / Solana mainnet</p>
        <h1>Metal markets, one terminal.</h1>
        <p className={styles.lead}>Compare live routes, buy eligible tokenized metals, settle back to stablecoins, and verify every execution onchain.</p>
        <AuthGate mode="invite" nextPath={nextPath} />
        <p className={styles.status}>Invite-only while execution controls are validated</p>
      </section>
    </main>
  );
}
