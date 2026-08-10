import Image from "next/image";
import { AuthGate } from "@/app/access/AuthGate";
import styles from "@/app/access/access.module.css";

export default function AdminLoginPage() {
  return (
    <main className={styles.shell}>
      <section className={styles.panel}>
        <Image className={styles.logo} src="/brand/hedgents-source-lockup-transparent.png" alt="Hedgents" width={1396} height={329} priority />
        <p className={styles.eyebrow}>Operator access / private</p>
        <h1>Beta control room.</h1>
        <p className={styles.lead}>Review the anonymous invite, quote, signature, execution, and settlement funnel.</p>
        <AuthGate mode="admin" nextPath="/admin" />
      </section>
    </main>
  );
}

