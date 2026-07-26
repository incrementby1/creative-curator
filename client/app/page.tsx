"use client";

import React, { useState, useCallback } from "react";
import { Menu, X, ArrowUpRight, ArrowUp, User, Bot, ChevronRight, ChevronDown, Plus, SquarePen } from "lucide-react";
import dynamic from "next/dynamic";
import DNAScreen from "./components/DNAScreen";
import SchedulerScreen from "./components/SchedulerScreen";
import SettingsScreen from "./components/SettingsScreen";

// Canvas must be dynamically imported because it uses ReactFlow (browser-only)
const Canvas = dynamic(() => import("./components/Canvas"), { ssr: false });

type ActiveTab = "new-chat" | "dna" | "outputs" | "scheduler" | "settings";

// --- Shared Chat Panel ---
function ChatPanel({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState("");

  return (
    <aside className="w-80 border-l border-[#E9E9E7] bg-[#FBFBFA] flex flex-col h-full shadow-sm z-10 shrink-0">
      <div className="h-12 border-b border-[#E9E9E7] flex items-center justify-between px-4">
        <h2 className="text-[12px] font-semibold text-[#91918E] uppercase tracking-wider">Chat</h2>
        <button onClick={onClose} className="p-1 hover:bg-[#E9E9E7] rounded-md transition-colors text-[#91918E]" aria-label="Close Chat">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="flex gap-3">
          <div className="w-6 h-6 rounded-full bg-[#E9E9E7] flex items-center justify-center shrink-0">
            <User className="w-3.5 h-3.5 text-[#91918E]" />
          </div>
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-[#37352F]">You</p>
            <p className="text-[13px] text-[#37352F] leading-relaxed">
              Can we break down the output concept into three distinct actionable parts?
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <Bot className="w-3.5 h-3.5 text-emerald-700" />
          </div>
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-[#37352F]">Curator</p>
            <p className="text-[13px] text-[#37352F] leading-relaxed">
              Absolutely. I&apos;ve mapped three core nodes on the canvas:
            </p>
            <div className="bg-stone-50 border border-[#E9E9E7] rounded-md p-3">
              <ul className="text-[13px] text-[#37352F] space-y-2">
                <li className="flex gap-2"><span className="font-mono text-[#91918E]">1.</span><span>Review brand values</span></li>
                <li className="flex gap-2"><span className="font-mono text-[#91918E]">2.</span><span>Define audience</span></li>
                <li className="flex gap-2"><span className="font-mono text-[#91918E]">3.</span><span>Set schedule</span></li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-[#E9E9E7] bg-[#FBFBFA]">
        <div className="relative flex items-center bg-stone-100 rounded-md border border-stone-200 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 transition-all">
          <input
            type="text"
            placeholder="Type a message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full bg-transparent text-[13px] text-[#37352F] px-3 py-2.5 outline-none placeholder:text-[#91918E]"
          />
          <button className="mr-1.5 p-1.5 bg-emerald-500 hover:bg-emerald-600 rounded-md text-white transition-colors shrink-0">
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}

// --- Project Group ---
function ProjectGroup({ name, chats }: { name: string; chats: string[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-[#91918E] uppercase tracking-wider hover:text-[#37352F] transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {name}
      </button>
      {open && (
        <ul className="space-y-0.5 mt-0.5">
          {chats.map((chat, i) => (
            <li key={i}>
              <button className="w-full text-left pl-6 pr-2 py-1.5 hover:bg-[#E9E9E7] rounded-md text-sm text-[#37352F] truncate">
                {chat}
              </button>
            </li>
          ))}
          <li>
            <button className="w-full text-left pl-6 pr-2 py-1.5 hover:bg-[#E9E9E7] rounded-md text-xs text-[#91918E] flex items-center gap-1.5 transition-colors">
              <Plus className="w-3 h-3" /> New chat
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

// --- Main Shell ---
export default function CreativeCuratorShell() {
  const [isLeftNavOpen, setIsLeftNavOpen] = useState(false);
  const [isRightChatOpen, setIsRightChatOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>("dna");
  // canvasKey forces Canvas to fully remount (reset) on New Chat
  const [canvasKey, setCanvasKey] = useState(0);

  const handleNewChat = useCallback(() => {
    setCanvasKey((k) => k + 1);
    setActiveTab("dna");
    setIsRightChatOpen(true);
    setIsLeftNavOpen(false);
  }, []);

  const navigate = (tab: ActiveTab) => {
    setActiveTab(tab);
    setIsLeftNavOpen(false);
  };

  const tabLabel: Record<ActiveTab, string> = {
    "new-chat": "New Chat",
    dna: "DNA",
    outputs: "Outputs",
    scheduler: "Scheduler",
    settings: "Settings",
  };

  // Which screens show the right chat panel
  const chatVisible = activeTab === "dna" || activeTab === "outputs";
  // Scheduler and settings don't show chat
  const showChat = chatVisible && isRightChatOpen;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#FBFBFA] text-[#37352F]">
      {/* Global Header */}
      <header className="flex-none h-14 border-b border-[#E9E9E7] flex items-center justify-between px-4 bg-[#FBFBFA] z-20">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsLeftNavOpen(!isLeftNavOpen)}
            className="p-1 hover:bg-[#E9E9E7] rounded-md transition-colors"
            aria-label="Toggle Navigation"
          >
            <Menu className="w-5 h-5 text-[#37352F]" />
          </button>
          <h1 className="font-semibold text-[15px]">Creative Curator</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-[#91918E]">{tabLabel[activeTab]}</span>
          <span className="text-[11px] font-medium tracking-wider uppercase px-2 py-1 bg-[#E9E9E7] text-[#37352F] rounded-full">
            Workspace
          </span>
        </div>
      </header>

      {/* Main Layout Area */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* Left Navigation Drawer */}
        {isLeftNavOpen && (
          <div className="absolute inset-0 z-10" onClick={() => setIsLeftNavOpen(false)} />
        )}
        <nav
          className={`absolute top-0 left-0 h-full w-64 bg-[#F7F7F5] border-r border-[#E9E9E7] z-20 flex flex-col transition-transform duration-300 ease-in-out ${
            isLeftNavOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">

            {/* Top Nav Items */}
            <ul className="space-y-0.5">
              {[
                { num: "01", label: "New Chat", tab: "new-chat" as ActiveTab, icon: SquarePen },
                { num: "02", label: "DNA", tab: "dna" as ActiveTab },
                { num: "03", label: "Outputs", tab: "outputs" as ActiveTab },
                { num: "04", label: "Scheduler", tab: "scheduler" as ActiveTab },
                { num: "05", label: "Settings", tab: "settings" as ActiveTab },
              ].map((item) => (
                <li key={item.num}>
                  <button
                    onClick={() => item.tab === "new-chat" ? handleNewChat() : navigate(item.tab)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors text-left group ${
                      activeTab === item.tab && item.tab !== "new-chat"
                        ? "bg-[#E9E9E7] text-[#37352F] font-medium"
                        : "hover:bg-[#E9E9E7] text-[#37352F]"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span className="text-[11px] text-[#91918E] font-mono">{item.num}</span>
                      <span className={activeTab === item.tab && item.tab !== "new-chat" ? "font-semibold" : "font-medium"}>{item.label}</span>
                    </span>
                    {item.tab === "new-chat" && <SquarePen className="w-3.5 h-3.5 text-[#91918E]" />}
                    {(item.tab === "outputs" || item.tab === "scheduler") && (
                      <ArrowUpRight className="w-3.5 h-3.5 text-[#91918E] opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>
                </li>
              ))}
            </ul>

            {/* Pinned Chats */}
            <div>
              <h3 className="px-2 text-[11px] font-semibold text-[#91918E] uppercase tracking-wider mb-2">
                Pinned chats
              </h3>
              <ul className="space-y-0.5">
                {["Marketing Strategy Review", "Product Naming Session", "Weekly Sync"].map((chat, i) => (
                  <li key={i}>
                    <button className="w-full text-left px-2 py-1.5 hover:bg-[#E9E9E7] rounded-md text-sm text-[#37352F] truncate">
                      {chat}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Projects */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-[11px] font-semibold text-[#91918E] uppercase tracking-wider">Projects</h3>
                <button className="text-[#91918E] hover:text-[#37352F] transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <ProjectGroup
                name="Brand Refresh"
                chats={["Marketing Strategy", "Naming Session", "Brand Voice"]}
              />
              <ProjectGroup
                name="Q3 Campaign"
                chats={["Ad Copy Review", "Weekly Sync", "Competitor Analysis"]}
              />
              <ProjectGroup
                name="Product Launch"
                chats={["User Persona Setup", "Content Calendar"]}
              />
            </div>

          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 relative overflow-hidden flex">
          <div className="flex-1 relative overflow-hidden">
            {activeTab === "dna" && <DNAScreen key={`dna-${canvasKey}`} />}
            {activeTab === "outputs" && <Canvas key={`canvas-${canvasKey}`} />}
            {activeTab === "scheduler" && <SchedulerScreen />}
            {activeTab === "settings" && <SettingsScreen />}
          </div>

          {/* Right Chat Panel (DNA + Outputs only) */}
          {chatVisible && (
            showChat
              ? <ChatPanel onClose={() => setIsRightChatOpen(false)} />
              : (
                <button
                  onClick={() => setIsRightChatOpen(true)}
                  className="absolute top-4 right-4 px-3 py-2 bg-white border border-[#E9E9E7] shadow-sm rounded-md hover:bg-stone-50 transition-colors z-20 text-[#37352F] text-[13px] font-medium flex items-center gap-2"
                >
                  <Bot className="w-4 h-4 text-emerald-600" />
                  Open Chat
                </button>
              )
          )}
        </main>

      </div>
    </div>
  );
}
