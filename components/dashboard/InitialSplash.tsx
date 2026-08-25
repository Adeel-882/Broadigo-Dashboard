"use client";

import { useEffect, useState } from "react";
import styles from "./InitialSplash.module.css";

const SPLASH_SEEN_KEY = "leadsedge-initial-splash-seen";

export function InitialSplash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (window.sessionStorage.getItem(SPLASH_SEEN_KEY)) {
      const frame = window.requestAnimationFrame(() => setVisible(false));
      return () => window.cancelAnimationFrame(frame);
    }

    window.sessionStorage.setItem(SPLASH_SEEN_KEY, "true");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 220 : 4050;
    const timer = window.setTimeout(() => {
      document.body.style.overflow = previousOverflow;
      setVisible(false);
    }, duration);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!visible) return null;

  return (
    <div className={styles.splash} aria-hidden="true">
      <div className={styles.glow} />
      <svg
        className={styles.mark}
        viewBox="0 0 160 160"
        role="presentation"
        focusable="false"
      >
        <path d="M44 0 40 37h120l-32 32H0L44 0Z" />
        <path d="M32 91h128l-44 69 4-36H0l32-33Z" />
      </svg>
    </div>
  );
}
