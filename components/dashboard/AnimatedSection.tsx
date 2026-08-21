"use client";

import { useEffect, useRef } from "react";

/**
 * Section entrance reveal.
 *
 * The animation is a CSS keyframe whose end state is the element's natural
 * state, so content is readable even if the class is never applied, the
 * animation never starts, or it is interrupted half way. Nothing about
 * visibility depends on JavaScript or on an animation library completing.
 */
export function AnimatedSection({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.classList.add("le-reveal");
    const clear = () => element.classList.remove("le-reveal");
    element.addEventListener("animationend", clear, { once: true });
    // Safety net so a missed animationend can never strand the section mid-state.
    const timer = window.setTimeout(clear, 1200);
    return () => {
      window.clearTimeout(timer);
      element.removeEventListener("animationend", clear);
      clear();
    };
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}
