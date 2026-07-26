"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type CalEvent = { id: number; day: number; title: string; type: "ig" | "fb" | "x" | "blog" | "email" };

const MOCK_EVENTS: CalEvent[] = [
  { id: 1, day: 3, title: "IG: Brand teaser story", type: "ig" },
  { id: 2, day: 7, title: "FB: Campaign launch ad", type: "fb" },
  { id: 3, day: 10, title: "Email: Newsletter #12", type: "email" },
  { id: 4, day: 14, title: "X: Thought leadership thread", type: "x" },
  { id: 5, day: 17, title: "IG: Behind-the-scenes reel", type: "ig" },
  { id: 6, day: 21, title: "Blog: Q3 strategy recap", type: "blog" },
  { id: 7, day: 24, title: "FB: Retargeting ad set", type: "fb" },
  { id: 8, day: 28, title: "IG: Product spotlight post", type: "ig" },
];

const typeStyles: Record<CalEvent["type"], string> = {
  ig: "bg-pink-100 text-pink-700",
  fb: "bg-blue-100 text-blue-700",
  x: "bg-sky-100 text-sky-700",
  blog: "bg-purple-100 text-purple-700",
  email: "bg-amber-100 text-amber-700",
};

const typeLabels: Record<CalEvent["type"], string> = {
  ig: "IG",
  fb: "FB",
  x: "X",
  blog: "Blog",
  email: "Email",
};

function SyncButton({ icon, label, color, connected }: { icon: React.ReactNode; label: string; color: string; connected?: boolean }) {
  const [isConnected, setIsConnected] = useState(!!connected);
  return (
    <button
      onClick={() => setIsConnected(!isConnected)}
      className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border shadow-sm transition-all ${
        isConnected
          ? "bg-emerald-50 border-emerald-300 text-emerald-700"
          : "bg-white border-[#E9E9E7] text-[#37352F] hover:bg-stone-50"
      }`}
    >
      <span className={color}>{icon}</span>
      {isConnected ? `${label} ✓` : `Sync ${label}`}
    </button>
  );
}

export default function SchedulerScreen() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  // Build 42-cell grid
  const cells: { day: number; current: boolean }[] = [];
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: prevMonthDays - i, current: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, current: true });
  while (cells.length < 42) cells.push({ day: cells.length - daysInMonth - firstDay + 1, current: false });

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const isToday = (day: number, current: boolean) =>
    current && day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  return (
    <div className="w-full h-full overflow-y-auto bg-[#FBFBFA] p-6 lg:p-10">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[#37352F]">Scheduler</h1>
            <p className="text-sm text-[#91918E] mt-0.5">Plan and schedule your campaign deliverables.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SyncButton
              icon={
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
              }
              label="Facebook"
              color="text-blue-600"
              connected
            />
            <SyncButton
              icon={
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                </svg>
              }
              label="Instagram"
              color="text-pink-600"
            />
            <SyncButton
              icon={
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              }
              label="X"
              color="text-[#37352F]"
            />
            <SyncButton
              icon={
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              }
              label="LinkedIn"
              color="text-blue-800"
            />
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 flex-wrap">
          {(Object.entries(typeStyles) as [CalEvent["type"], string][]).map(([type, cls]) => (
            <span key={type} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>
              {typeLabels[type]}
            </span>
          ))}
        </div>

        {/* Calendar */}
        <div className="bg-white border border-[#E9E9E7] rounded-xl shadow-sm overflow-hidden">
          {/* Month Nav */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E9E9E7]">
            <h2 className="text-lg font-semibold text-[#37352F]">
              {MONTHS[month]} {year}
            </h2>
            <div className="flex items-center gap-1">
              <button onClick={prevMonth} className="p-1.5 hover:bg-stone-100 rounded-md transition-colors">
                <ChevronLeft className="w-5 h-5 text-[#91918E]" />
              </button>
              <button
                onClick={() => { setMonth(today.getMonth()); setYear(today.getFullYear()); }}
                className="px-3 py-1 text-xs font-medium text-[#37352F] hover:bg-stone-100 rounded-md transition-colors"
              >
                Today
              </button>
              <button onClick={nextMonth} className="p-1.5 hover:bg-stone-100 rounded-md transition-colors">
                <ChevronRight className="w-5 h-5 text-[#91918E]" />
              </button>
            </div>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 bg-stone-50 border-b border-[#E9E9E7]">
            {DAYS_OF_WEEK.map(d => (
              <div key={d} className="py-2.5 text-center text-[11px] font-semibold text-[#91918E] uppercase tracking-wider border-r border-[#E9E9E7] last:border-r-0">
                {d}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7">
            {cells.map((cell, idx) => {
              const events = MOCK_EVENTS.filter(e => e.day === cell.day && cell.current);
              const today_ = isToday(cell.day, cell.current);

              return (
                <div
                  key={idx}
                  className={`min-h-[110px] p-2 border-r border-b border-[#E9E9E7] last:border-r-0 relative group transition-colors ${
                    !cell.current ? "bg-stone-50/60" : "hover:bg-stone-50"
                  }`}
                >
                  <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full mb-1 ${
                    today_
                      ? "bg-emerald-500 text-white"
                      : cell.current
                      ? "text-[#37352F]"
                      : "text-[#91918E]/40"
                  }`}>
                    {cell.day}
                  </span>
                  <div className="space-y-1">
                    {events.map(ev => (
                      <div key={ev.id} className={`text-[10px] font-medium px-1.5 py-0.5 rounded truncate flex items-center gap-1 ${typeStyles[ev.type]}`}>
                        <span className="font-bold">{typeLabels[ev.type]}</span>
                        <span className="truncate">{ev.title.split(": ")[1]}</span>
                      </div>
                    ))}
                  </div>
                  {cell.current && (
                    <button className="absolute top-2 right-2 p-1 bg-white border border-[#E9E9E7] rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-[#91918E] hover:text-[#1e2022] shadow-sm">
                      <Plus className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
