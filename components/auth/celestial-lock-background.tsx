"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { getCelestialSky, getCelestialSkyAtMinute } from "@/lib/agentos/celestial-sky";

const BRIGHT_STAR_FIELD = [
  "radial-gradient(circle at 8% 18%, rgba(255,255,255,.95) 0 1px, transparent 1.6px)",
  "radial-gradient(circle at 29% 11%, rgba(255,255,255,.9) 0 1.2px, transparent 1.8px)",
  "radial-gradient(circle at 55% 9%, rgba(255,255,255,.88) 0 1px, transparent 1.6px)",
  "radial-gradient(circle at 78% 13%, rgba(255,255,255,.92) 0 1.2px, transparent 1.8px)"
].join(",");

const SOFT_STAR_FIELD = [
  "radial-gradient(circle at 18% 42%, rgba(214,228,255,.8) 0 1px, transparent 1.5px)",
  "radial-gradient(circle at 43% 31%, rgba(226,235,255,.75) 0 .8px, transparent 1.4px)",
  "radial-gradient(circle at 67% 26%, rgba(210,224,255,.78) 0 1px, transparent 1.5px)",
  "radial-gradient(circle at 91% 37%, rgba(222,233,255,.8) 0 .9px, transparent 1.5px)"
].join(",");

const FINE_STAR_FIELD = [
  "radial-gradient(circle, rgba(255,255,255,.92) 0 .55px, transparent .85px)",
  "radial-gradient(circle, rgba(210,226,255,.78) 0 .5px, transparent .8px)",
  "radial-gradient(circle, rgba(255,243,218,.72) 0 .45px, transparent .75px)",
  "radial-gradient(circle, rgba(228,235,255,.84) 0 .6px, transparent .9px)"
].join(",");

const FINE_STAR_SIZES = "137px 163px, 211px 179px, 173px 229px, 257px 197px";
const FINE_STAR_POSITIONS = "12px 19px, 71px 43px, 31px 97px, 119px 67px";

export function CelestialLockBackground() {
  const reduceMotion = useReducedMotion();
  const [sky, setSky] = useState(() => getCelestialSkyAtMinute(750));

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

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" data-sky-phase={sky.label}>
      <div
        className="absolute inset-0 transition-[background] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{ background: `linear-gradient(180deg, ${sky.top} 0%, ${sky.middle} 46%, ${sky.bottom} 76%, ${sky.horizon} 100%)` }}
      />

      <motion.div
        className="absolute -inset-x-[20%] -top-[18%] h-[62%] rotate-[-7deg] rounded-[50%] blur-[80px]"
        animate={reduceMotion ? undefined : { x: ["-4%", "5%", "-4%"], scaleY: [0.92, 1.08, 0.92] }}
        transition={{ duration: 38, ease: "easeInOut", repeat: Infinity }}
        style={{ background: `linear-gradient(105deg, transparent 20%, ${sky.accent} 51%, transparent 78%)`, opacity: sky.auroraOpacity }}
      />
      <motion.div
        className="absolute -right-[18%] top-[5%] h-[48%] w-[70%] rounded-full blur-[110px]"
        animate={reduceMotion ? undefined : { x: ["3%", "-5%", "3%"], y: ["-2%", "4%", "-2%"] }}
        transition={{ duration: 46, ease: "easeInOut", repeat: Infinity }}
        style={{ background: `radial-gradient(circle, ${sky.accent} 0%, transparent 69%)`, opacity: sky.auroraOpacity * 0.7 }}
      />

      <div
        className="absolute inset-0 transition-opacity [transition-duration:4000ms] motion-reduce:transition-none"
        style={{ opacity: sky.starOpacity }}
      >
        <motion.div
          className="absolute inset-0 mix-blend-screen"
          animate={reduceMotion ? undefined : { opacity: [0.7, 1, 0.76, 0.92, 0.7] }}
          transition={{ duration: 8.5, ease: "easeInOut", repeat: Infinity }}
          style={{ backgroundImage: BRIGHT_STAR_FIELD }}
        />
        <motion.div
          className="absolute inset-0 mix-blend-screen"
          animate={reduceMotion ? undefined : { opacity: [0.92, 0.68, 0.88, 0.74, 0.92] }}
          transition={{ duration: 11.5, ease: "easeInOut", repeat: Infinity }}
          style={{ backgroundImage: SOFT_STAR_FIELD }}
        />
        <motion.div
          className="absolute inset-0 mix-blend-screen"
          animate={reduceMotion ? undefined : { opacity: [0.5, 0.72, 0.58, 0.68, 0.5] }}
          transition={{ duration: 14, ease: "easeInOut", repeat: Infinity }}
          style={{
            backgroundImage: FINE_STAR_FIELD,
            backgroundPosition: FINE_STAR_POSITIONS,
            backgroundSize: FINE_STAR_SIZES
          }}
        />
      </div>

      <div
        className="absolute inset-0 mix-blend-screen transition-[background,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{
          background: `radial-gradient(circle at ${sky.sunX}% ${sky.sunY}%, rgba(255,247,207,.34) 0%, rgba(255,201,112,.16) 10%, rgba(255,148,76,.07) 25%, transparent 48%)`,
          opacity: sky.sunOpacity
        }}
      />
      <div
        className="absolute transition-[left,top,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${sky.sunX}%`, top: `${sky.sunY}%`, opacity: sky.sunOpacity }}
      >
        <motion.div
          className="absolute h-[clamp(270px,31vw,470px)] w-[clamp(270px,31vw,470px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,252,226,.38)_0%,rgba(255,221,150,.24)_13%,rgba(255,172,91,.12)_34%,rgba(255,128,70,.045)_54%,transparent_72%)] blur-[12px] mix-blend-screen"
          animate={reduceMotion ? undefined : { opacity: [0.76, 1, 0.82, 0.76], scale: [0.97, 1.04, 1, 0.97] }}
          transition={{ duration: 11, ease: "easeInOut", repeat: Infinity }}
        />
        <motion.div
          className="absolute h-[clamp(130px,15vw,230px)] w-[clamp(130px,15vw,230px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,236,.62)_0%,rgba(255,215,130,.31)_27%,rgba(255,157,82,.08)_57%,transparent_72%)] blur-[5px] mix-blend-screen"
          animate={reduceMotion ? undefined : { opacity: [0.84, 1, 0.9, 0.84], scale: [1, 1.055, 1.02, 1] }}
          transition={{ duration: 7.5, ease: "easeInOut", repeat: Infinity }}
        />
      </div>
      <motion.div
        className="absolute h-[clamp(54px,6vw,86px)] w-[clamp(54px,6vw,86px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_34%_28%,#fffff4_0%,#fff1ad_22%,#ffc467_58%,#f58b4a_100%)] shadow-[0_0_24px_8px_rgba(255,248,199,.68),0_0_68px_28px_rgba(255,200,112,.38),0_0_150px_72px_rgba(255,141,76,.2)] transition-[left,top,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${sky.sunX}%`, top: `${sky.sunY}%`, opacity: sky.sunOpacity }}
        animate={reduceMotion ? undefined : { filter: ["brightness(1)", "brightness(1.09)", "brightness(1.025)", "brightness(1)"], scale: [1, 1.045, 1.015, 1] }}
        transition={{ duration: 8.5, ease: "easeInOut", repeat: Infinity }}
      />

      <div
        className="absolute inset-0 mix-blend-screen transition-[background,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{
          background: `radial-gradient(circle at ${sky.moonX}% ${sky.moonY}%, rgba(242,247,255,.34) 0%, rgba(188,209,250,.15) 13%, rgba(116,150,224,.055) 31%, transparent 48%)`,
          opacity: sky.moonOpacity
        }}
      />
      <div
        className="absolute transition-[left,top,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${sky.moonX}%`, top: `${sky.moonY}%`, opacity: sky.moonOpacity }}
      >
        <motion.div
          className="absolute h-[clamp(230px,28vw,430px)] w-[clamp(230px,28vw,430px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(244,248,255,.4)_0%,rgba(194,214,253,.2)_20%,rgba(124,156,228,.075)_45%,transparent_71%)] blur-[8px] mix-blend-screen"
          animate={reduceMotion ? undefined : { opacity: [0.78, 1, 0.86, 0.78], scale: [0.98, 1.045, 1.01, 0.98] }}
          transition={{ duration: 12, ease: "easeInOut", repeat: Infinity }}
        />
      </div>
      <motion.div
        data-celestial-body="moon"
        className="absolute h-[clamp(50px,5.3vw,78px)] w-[clamp(50px,5.3vw,78px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-[radial-gradient(circle_at_32%_26%,#ffffff_0%,#fbfdff_28%,#e8effc_62%,#b6c7e5_100%)] shadow-[0_0_20px_8px_rgba(246,249,255,.82),0_0_62px_28px_rgba(190,213,255,.4),0_0_150px_65px_rgba(113,151,226,.2)] transition-[left,top,opacity] [transition-duration:4000ms] ease-linear motion-reduce:transition-none"
        style={{ left: `${sky.moonX}%`, top: `${sky.moonY}%`, opacity: sky.moonOpacity }}
        animate={reduceMotion ? undefined : { filter: ["brightness(1)", "brightness(1.08)", "brightness(1.025)", "brightness(1)"], scale: [1, 1.025, 1.008, 1] }}
        transition={{ duration: 10.5, ease: "easeInOut", repeat: Infinity }}
      >
        <div
          className="absolute inset-0 rounded-full opacity-55"
          style={{
            background:
              "radial-gradient(circle at 29% 42%, rgba(137,157,193,.28) 0 5%, transparent 6%), radial-gradient(circle at 63% 29%, rgba(151,169,202,.2) 0 4%, transparent 5%), radial-gradient(circle at 58% 67%, rgba(126,147,186,.24) 0 7%, transparent 8%), radial-gradient(circle at 78% 53%, rgba(255,255,255,.42) 0 4%, transparent 5%)"
          }}
        />
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_28%_20%,rgba(255,255,255,.72),transparent_42%)]" />
      </motion.div>

      <motion.div
        className="absolute bottom-[17%] left-[-18%] h-[13%] w-[84%] rounded-[50%] bg-white/15 blur-[34px]"
        animate={reduceMotion ? undefined : { x: ["-3%", "20%", "-3%"] }}
        transition={{ duration: 64, ease: "easeInOut", repeat: Infinity }}
      />
      <motion.div
        className="absolute bottom-[7%] right-[-20%] h-[16%] w-[82%] rounded-[50%] bg-white/10 blur-[42px]"
        animate={reduceMotion ? undefined : { x: ["7%", "-18%", "7%"] }}
        transition={{ duration: 78, ease: "easeInOut", repeat: Infinity }}
      />
      <div className="absolute inset-x-0 bottom-0 h-[32%] bg-[linear-gradient(to_top,rgba(3,7,18,.46),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_28%,rgba(2,6,18,.18)_72%,rgba(2,6,18,.42)_100%)]" />
      <div className="absolute inset-0 opacity-[0.055] [background-image:radial-gradient(rgba(255,255,255,.9)_0.55px,transparent_0.7px)] [background-size:4px_4px] [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />
    </div>
  );
}
