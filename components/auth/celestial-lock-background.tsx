"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { getCelestialSky, type CelestialSky } from "@/lib/agentos/celestial-sky";

const BRIGHT_STAR_FIELD = [
  "radial-gradient(circle at 8% 18%, rgba(255,255,255,.72) 0 .8px, transparent 1.4px)",
  "radial-gradient(circle at 29% 11%, rgba(255,255,255,.62) 0 1px, transparent 1.6px)",
  "radial-gradient(circle at 55% 9%, rgba(255,255,255,.58) 0 .8px, transparent 1.4px)",
  "radial-gradient(circle at 78% 13%, rgba(255,255,255,.64) 0 1px, transparent 1.6px)"
].join(",");

const SOFT_STAR_FIELD = [
  "radial-gradient(circle at 18% 42%, rgba(214,228,255,.5) 0 .8px, transparent 1.35px)",
  "radial-gradient(circle at 43% 31%, rgba(226,235,255,.46) 0 .7px, transparent 1.25px)",
  "radial-gradient(circle at 67% 26%, rgba(210,224,255,.48) 0 .8px, transparent 1.35px)",
  "radial-gradient(circle at 91% 37%, rgba(222,233,255,.5) 0 .8px, transparent 1.35px)"
].join(",");

const INITIAL_SKY: CelestialSky = {
  accent: "#a9aaa6",
  auroraOpacity: 0,
  bottom: "#7b7c79",
  daylight: 0.18,
  horizon: "#8d8d88",
  label: "Syncing",
  middle: "#626867",
  moonOpacity: 0,
  moonX: 50,
  moonY: 50,
  starOpacity: 0,
  sunOpacity: 0,
  sunX: 50,
  sunY: 50,
  top: "#41494f"
};

export function useCelestialSky() {
  const [sky, setSky] = useState<CelestialSky | null>(null);

  useEffect(() => {
    const update = () => setSky(getCelestialSky(new Date()));
    update();
    const timer = window.setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return sky;
}

export function CelestialLockBackground({ sky }: { sky: CelestialSky | null }) {
  const reduceMotion = useReducedMotion();
  const renderSky = sky ?? INITIAL_SKY;
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPlayback = () => {
      if (reduceMotion === true || motionPreference.matches) {
        video.pause();
        return;
      }
      void video.play().catch(() => undefined);
    };

    syncPlayback();
    motionPreference.addEventListener("change", syncPlayback);
    return () => motionPreference.removeEventListener("change", syncPlayback);
  }, [reduceMotion]);

  return (
    <div
      aria-hidden="true"
      className="celestial-lock-background pointer-events-none absolute inset-0 overflow-hidden"
      data-sky-phase={renderSky.label}
      data-sky-ready={sky ? "true" : "false"}
    >
      <div
        className="absolute inset-0 transition-[background] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{ background: `linear-gradient(180deg, ${renderSky.top} 0%, ${renderSky.middle} 44%, ${renderSky.bottom} 74%, ${renderSky.horizon} 100%)` }}
      />
      <video
        ref={videoRef}
        aria-hidden="true"
        tabIndex={-1}
        className="lock-screen-video absolute inset-0 h-full w-full object-cover"
        src="/assets/lock-screen/lockBack.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      />
      <div aria-hidden="true" className="lock-screen-video-wash absolute inset-0" />
      <div aria-hidden="true" className="lock-screen-crt-scanlines absolute inset-0" />
      <div aria-hidden="true" className="lock-screen-crt-grain absolute inset-0" />

      <motion.div
        className="absolute -inset-x-[18%] -top-[20%] h-[68%] rotate-[-8deg] rounded-[50%] blur-[110px]"
        animate={reduceMotion || !sky ? undefined : { x: ["-2%", "4%", "-2%"], scaleY: [0.97, 1.03, 0.97] }}
        transition={{ duration: 52, ease: "easeInOut", repeat: Infinity }}
        style={{ background: `linear-gradient(105deg, transparent 22%, ${renderSky.accent} 52%, transparent 80%)`, opacity: renderSky.auroraOpacity * 0.55 }}
      />

      <div
        className="absolute inset-0 transition-opacity [transition-duration:4000ms] motion-reduce:transition-none"
        style={{ opacity: renderSky.starOpacity }}
      >
        <motion.div
          className="absolute inset-0 mix-blend-screen"
          animate={reduceMotion || !sky ? undefined : { opacity: [0.7, 0.94, 0.72, 0.86, 0.7] }}
          transition={{ duration: 10, ease: "easeInOut", repeat: Infinity }}
          style={{ backgroundImage: BRIGHT_STAR_FIELD }}
        />
        <motion.div
          className="absolute inset-0 mix-blend-screen"
          animate={reduceMotion || !sky ? undefined : { opacity: [0.82, 0.6, 0.78, 0.66, 0.82] }}
          transition={{ duration: 14, ease: "easeInOut", repeat: Infinity }}
          style={{ backgroundImage: SOFT_STAR_FIELD }}
        />
      </div>

      <div
        className="absolute inset-0 mix-blend-screen transition-[background,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{
          background: `radial-gradient(circle at ${renderSky.sunX}% ${renderSky.sunY}%, rgba(255,247,220,.24) 0%, rgba(245,213,165,.13) 13%, rgba(220,183,131,.045) 30%, transparent 52%)`,
          opacity: renderSky.sunOpacity * 0.64
        }}
      />
      <div
        className="absolute transition-[left,top,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${renderSky.sunX}%`, top: `${renderSky.sunY}%`, opacity: renderSky.sunOpacity }}
      >
        <motion.div
          className="absolute h-[clamp(170px,19vw,300px)] w-[clamp(170px,19vw,300px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,250,232,.26)_0%,rgba(246,220,178,.13)_30%,rgba(228,189,139,.04)_58%,transparent_74%)] blur-[18px] mix-blend-screen"
          animate={reduceMotion || !sky ? undefined : { opacity: [0.72, 1, 0.8, 0.72], scale: [0.98, 1.03, 1, 0.98] }}
          transition={{ duration: 13, ease: "easeInOut", repeat: Infinity }}
        />
      </div>
      <motion.div
        className="absolute h-[clamp(34px,3.7vw,58px)] w-[clamp(34px,3.7vw,58px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_35%_28%,#fffdf5_0%,#f7e7c7_34%,#d7b98d_74%,#b28b63_100%)] shadow-[0_0_18px_5px_rgba(255,246,218,.28),0_0_54px_20px_rgba(234,198,147,.14)] transition-[left,top,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${renderSky.sunX}%`, top: `${renderSky.sunY}%`, opacity: renderSky.sunOpacity }}
        animate={reduceMotion || !sky ? undefined : { filter: ["brightness(1)", "brightness(1.045)", "brightness(1)"] }}
        transition={{ duration: 10, ease: "easeInOut", repeat: Infinity }}
      />

      <div
        className="absolute inset-0 mix-blend-screen transition-[background,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{
          background: `radial-gradient(circle at ${renderSky.moonX}% ${renderSky.moonY}%, rgba(231,239,245,.22) 0%, rgba(181,200,211,.1) 16%, rgba(131,157,171,.035) 34%, transparent 52%)`,
          opacity: renderSky.moonOpacity * 0.62
        }}
      />
      <div
        className="absolute transition-[left,top,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${renderSky.moonX}%`, top: `${renderSky.moonY}%`, opacity: renderSky.moonOpacity }}
      >
        <motion.div
          className="absolute h-[clamp(170px,20vw,310px)] w-[clamp(170px,20vw,310px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(235,242,247,.26)_0%,rgba(190,211,222,.11)_25%,rgba(131,160,176,.035)_53%,transparent_74%)] blur-[16px] mix-blend-screen"
          animate={reduceMotion || !sky ? undefined : { opacity: [0.76, 1, 0.82, 0.76], scale: [0.99, 1.025, 1, 0.99] }}
          transition={{ duration: 14, ease: "easeInOut", repeat: Infinity }}
        />
      </div>
      <motion.div
        data-celestial-body="moon"
        className="absolute h-[clamp(38px,4.3vw,64px)] w-[clamp(38px,4.3vw,64px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-[radial-gradient(circle_at_32%_26%,#ffffff_0%,#f4f7f8_30%,#dbe4e8_65%,#aebfc8_100%)] shadow-[0_0_18px_5px_rgba(239,245,247,.38),0_0_56px_22px_rgba(191,215,224,.15)] transition-[left,top,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${renderSky.moonX}%`, top: `${renderSky.moonY}%`, opacity: renderSky.moonOpacity }}
        animate={reduceMotion || !sky ? undefined : { filter: ["brightness(1)", "brightness(1.045)", "brightness(1)"], scale: [1, 1.015, 1] }}
        transition={{ duration: 12, ease: "easeInOut", repeat: Infinity }}
      >
        <div
          className="absolute inset-0 rounded-full opacity-45"
          style={{
            background:
              "radial-gradient(circle at 29% 42%, rgba(137,157,168,.2) 0 5%, transparent 6%), radial-gradient(circle at 63% 29%, rgba(151,169,178,.16) 0 4%, transparent 5%), radial-gradient(circle at 58% 67%, rgba(126,147,159,.18) 0 7%, transparent 8%), radial-gradient(circle at 78% 53%, rgba(255,255,255,.38) 0 4%, transparent 5%)"
          }}
        />
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_28%_20%,rgba(255,255,255,.64),transparent_42%)]" />
      </motion.div>

      <motion.div
        className="absolute bottom-[15%] left-[-18%] h-[13%] w-[84%] rounded-[50%] bg-white/[0.08] blur-[42px]"
        animate={reduceMotion || !sky ? undefined : { x: ["-3%", "16%", "-3%"] }}
        transition={{ duration: 72, ease: "easeInOut", repeat: Infinity }}
      />
      <motion.div
        className="absolute bottom-[7%] right-[-20%] h-[15%] w-[82%] rounded-[50%] bg-white/[0.06] blur-[48px]"
        animate={reduceMotion || !sky ? undefined : { x: ["6%", "-14%", "6%"] }}
        transition={{ duration: 86, ease: "easeInOut", repeat: Infinity }}
      />
      <div className="absolute inset-x-0 bottom-0 h-[25%] bg-[linear-gradient(to_top,rgba(8,13,18,.2),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_28%,rgba(8,14,20,.08)_72%,rgba(8,14,20,.25)_100%)]" />
    </div>
  );
}
