"use client";

import React, { useState } from "react";

export default function SettingsScreen() {
  const [brandName, setBrandName] = useState("Creative Curator");
  const [timezone, setTimezone] = useState("Asia/Singapore");
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(false);
  const [appearance, setAppearance] = useState<"light" | "system">("light");

  return (
    <div className="w-full h-full overflow-y-auto bg-[#FBFBFA]">
      <div className="max-w-3xl mx-auto py-12 px-8 space-y-10">

        {/* Header */}
        <div className="space-y-1 pb-6 border-b border-[#E9E9E7]">
          <h1 className="text-xl font-semibold text-[#37352F]">Settings</h1>
          <p className="text-sm text-[#91918E]">Manage your workspace preferences and integrations.</p>
        </div>

        {/* Section: Workspace */}
        <section className="space-y-6">
          <h2 className="text-[11px] font-bold text-[#91918E] uppercase tracking-widest">Workspace</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-4 border-b border-[#E9E9E7]">
              <div>
                <p className="text-sm font-medium text-[#37352F]">Brand name</p>
                <p className="text-xs text-[#91918E] mt-0.5">Used across all screens and exports.</p>
              </div>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-48 text-sm text-[#37352F] bg-[#F7F7F5] border border-[#E9E9E7] rounded-md px-3 py-1.5 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all text-right"
              />
            </div>

            <div className="flex items-center justify-between py-4 border-b border-[#E9E9E7]">
              <div>
                <p className="text-sm font-medium text-[#37352F]">Timezone</p>
                <p className="text-xs text-[#91918E] mt-0.5">Used for scheduler and calendar events.</p>
              </div>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-48 text-sm text-[#37352F] bg-[#F7F7F5] border border-[#E9E9E7] rounded-md px-3 py-1.5 outline-none focus:border-emerald-500 transition-all"
              >
                <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                <option value="America/New_York">America/New York (UTC-5)</option>
                <option value="Europe/London">Europe/London (UTC+0)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
                <option value="America/Los_Angeles">America/Los Angeles (UTC-8)</option>
              </select>
            </div>
          </div>
        </section>

        {/* Section: Appearance */}
        <section className="space-y-6">
          <h2 className="text-[11px] font-bold text-[#91918E] uppercase tracking-widest">Appearance</h2>

          <div className="grid grid-cols-2 gap-3">
            {(["light", "system"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setAppearance(mode)}
                className={`flex flex-col gap-2 p-4 rounded-lg border text-sm font-medium capitalize transition-all ${
                  appearance === mode
                    ? "border-emerald-500 ring-2 ring-emerald-100 text-emerald-700"
                    : "border-[#E9E9E7] text-[#37352F] hover:border-[#D4D4D2]"
                }`}
              >
                <div className={`w-full h-12 rounded-md ${mode === "light" ? "bg-[#F7F7F5]" : "bg-gradient-to-br from-[#F7F7F5] to-[#1e2022]"} border border-[#E9E9E7]`} />
                <span>{mode === "light" ? "Light" : "System Default"}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Section: Notifications */}
        <section className="space-y-6">
          <h2 className="text-[11px] font-bold text-[#91918E] uppercase tracking-widest">Notifications</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-4 border-b border-[#E9E9E7]">
              <div>
                <p className="text-sm font-medium text-[#37352F]">Email notifications</p>
                <p className="text-xs text-[#91918E] mt-0.5">Receive alerts for scheduled posts and deadlines.</p>
              </div>
              <button
                onClick={() => setEmailNotifs(!emailNotifs)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${emailNotifs ? "bg-emerald-500" : "bg-[#E9E9E7]"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${emailNotifs ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>

            <div className="flex items-center justify-between py-4 border-b border-[#E9E9E7]">
              <div>
                <p className="text-sm font-medium text-[#37352F]">Weekly digest</p>
                <p className="text-xs text-[#91918E] mt-0.5">A summary of your creative outputs every Monday.</p>
              </div>
              <button
                onClick={() => setWeeklyDigest(!weeklyDigest)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${weeklyDigest ? "bg-emerald-500" : "bg-[#E9E9E7]"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${weeklyDigest ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
          </div>
        </section>

        {/* Section: Integrations */}
        <section className="space-y-6">
          <h2 className="text-[11px] font-bold text-[#91918E] uppercase tracking-widest">Integrations</h2>
          <div className="space-y-3">
            {[
              { name: "Facebook", color: "text-blue-600", desc: "Sync posts and campaign data.", connected: true },
              { name: "Instagram", color: "text-pink-600", desc: "Sync creative assets and story schedules.", connected: false },
              { name: "X (Twitter)", color: "text-sky-500", desc: "Publish and track engagement.", connected: false },
              { name: "LinkedIn", color: "text-blue-800", desc: "Professional content distribution.", connected: false },
            ].map((item) => (
              <div key={item.name} className="flex items-center justify-between py-4 border-b border-[#E9E9E7]">
                <div>
                  <p className={`text-sm font-medium ${item.color}`}>{item.name}</p>
                  <p className="text-xs text-[#91918E] mt-0.5">{item.desc}</p>
                </div>
                <button className={`px-4 py-1.5 text-xs font-semibold rounded-md border transition-all ${
                  item.connected
                    ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                    : "bg-white border-[#E9E9E7] text-[#37352F] hover:bg-stone-50"
                }`}>
                  {item.connected ? "Connected ✓" : "Connect"}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Danger Zone */}
        <section className="space-y-4 pt-4">
          <h2 className="text-[11px] font-bold text-red-400 uppercase tracking-widest">Danger Zone</h2>
          <div className="border border-red-200 rounded-lg p-4 flex items-center justify-between bg-red-50/40">
            <div>
              <p className="text-sm font-medium text-[#37352F]">Reset workspace</p>
              <p className="text-xs text-[#91918E] mt-0.5">Clear all boards, notes, and DNA settings.</p>
            </div>
            <button className="px-4 py-1.5 text-xs font-semibold text-red-600 border border-red-300 bg-white rounded-md hover:bg-red-50 transition-colors">
              Reset
            </button>
          </div>
        </section>

      </div>
    </div>
  );
}
