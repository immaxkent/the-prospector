import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Move one level up within a section by swiping right, flicking a trackpad
 * right, or pressing Alt + Left. Top-level navbar sections never traverse
 * sideways into one another.
 */
export function useSwipeNav(parent: "/endeavours" | undefined) {
  const navigate = useNavigate();
  const lock = useRef(0);

  useEffect(() => {
    const goBack = () => {
      if (!parent) return;
      const now = Date.now();
      if (now < lock.current) return;
      lock.current = now + 700;
      navigate({ to: parent });
    };

    const blocked = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest("[data-no-swipe], input, textarea, [contenteditable='true']");

    // --- touch ---
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || blocked(e.target)) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      if (dx > 0) goBack();
    };

    // --- trackpad ---
    let wheelSum = 0;
    let wheelReset: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (blocked(e.target)) return;
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.4) return;
      wheelSum += e.deltaX;
      if (wheelReset) clearTimeout(wheelReset);
      wheelReset = setTimeout(() => {
        wheelSum = 0;
      }, 220);
      if (Math.abs(wheelSum) > 160) {
        if (wheelSum < 0) goBack();
        wheelSum = 0;
      }
    };

    // --- keyboard ---
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || blocked(e.target)) return;
      if (e.key === "ArrowLeft") goBack();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      if (wheelReset) clearTimeout(wheelReset);
    };
  }, [navigate, parent]);
}
