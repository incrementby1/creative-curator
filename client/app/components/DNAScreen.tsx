"use client";

import React, { useState } from "react";

function SliderRow({
  val,
  setVal,
  leftLabel,
  rightLabel,
}: {
  val: number;
  setVal: (v: number) => void;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div className="flex items-center gap-6 py-3 border-b border-[#E9E9E7] last:border-b-0 group">
      <span className="w-28 text-right text-xs font-medium text-[#91918E] shrink-0">{leftLabel}</span>
      <div className="relative flex-1 h-1.5 bg-[#E9E9E7] rounded-full select-none">
        <div
          className="absolute inset-y-0 left-0 bg-emerald-400 rounded-l-full pointer-events-none transition-all"
          style={{ width: `${val}%` }}
        />
        <div
          className="absolute top-1/2 -mt-2 w-4 h-4 bg-[#37352F] rounded-full shadow-sm pointer-events-none transition-all"
          style={{ left: `calc(${val}% - 8px)` }}
        />
        <input
          type="range"
          min="0"
          max="100"
          value={val}
          onChange={(e) => setVal(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
      </div>
      <span className="w-28 text-xs font-medium text-[#91918E] shrink-0">{rightLabel}</span>
    </div>
  );
}

export default function DNAScreen() {
  const [pointOfView, setPointOfView] = useState(
    "Make ambitious creative work feel clear and navigable."
  );
  const [audience, setAudience] = useState(
    "Small teams turning an early thought into a coherent campaign."
  );
  const [promise, setPromise] = useState(
    "Structure without sanding away the interesting edges."
  );

  const [sliders, setSliders] = useState([
    { left: "Playful", right: "Clear", val: 70 },
    { left: "Quiet", right: "Loud", val: 65 },
    { left: "Traditional", right: "Modern", val: 75 },
    { left: "Minimal", right: "Bold", val: 55 },
    { left: "Serious", right: "Playful", val: 45 },
  ]);

  const setSliderVal = (i: number, v: number) => {
    setSliders((prev) => prev.map((s, idx) => (idx === i ? { ...s, val: v } : s)));
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-[#FBFBFA]">
      <div className="max-w-4xl mx-auto px-8 py-10 space-y-8">

        {/* Header */}
        <div className="space-y-1 pb-6 border-b border-[#E9E9E7]">
          <p className="text-[11px] font-semibold tracking-widest text-[#91918E] uppercase">
            Brand Foundations
          </p>
          <h1 className="text-3xl font-bold text-[#37352F] tracking-tight">DNA</h1>
          <p className="text-sm text-[#91918E]">
            A working hypothesis for the voice and principles behind Creative Curator.
          </p>
        </div>

        {/* Note Blocks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Point of View", val: pointOfView, set: setPointOfView },
            { label: "Audience", val: audience, set: setAudience },
            { label: "Promise", val: promise, set: setPromise },
          ].map((block) => (
            <div
              key={block.label}
              className="bg-white rounded-lg border border-[#E9E9E7] p-5 flex flex-col gap-4 hover:border-[#D4D4D2] focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-100 transition-all shadow-sm"
            >
              <h3 className="text-[10px] font-bold tracking-widest text-[#91918E] uppercase">
                {block.label}
              </h3>
              <textarea
                className="w-full bg-transparent resize-none outline-none text-[#37352F] leading-relaxed flex-1 min-h-[100px] text-[15px] placeholder:text-[#C7C7C3]"
                value={block.val}
                onChange={(e) => block.set(e.target.value)}
                placeholder="Write here..."
              />
            </div>
          ))}
        </div>

        {/* Personality Sliders */}
        <div className="bg-white rounded-lg border border-[#E9E9E7] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E9E9E7] bg-[#FBFBFA]">
            <h2 className="text-[10px] font-bold tracking-widest text-[#91918E] uppercase">
              Brand Personality
            </h2>
            <p className="text-xs text-[#91918E] mt-0.5">
              Calibrate how your brand sounds, feels, and speaks.
            </p>
          </div>
          <div className="px-6 py-2">
            {sliders.map((s, i) => (
              <SliderRow
                key={i}
                val={s.val}
                setVal={(v) => setSliderVal(i, v)}
                leftLabel={s.left}
                rightLabel={s.right}
              />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
