"use client";

import Link from "next/link";
import { FormEvent, useCallback, useState } from "react";
import {
  addEdge,
  Background,
  Connection,
  Controls,
  Edge,
  MiniMap,
  Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import styles from "../page.module.css";

type View = "chat" | "dna" | "outputs" | "scheduler" | "settings";
type Message = { role: "user" | "assistant"; content: string };

const NAV_ITEMS: Array<{ id: View; label: string; eyebrow: string }> = [
  { id: "chat", label: "New Chat", eyebrow: "Start a fresh brief" },
  { id: "dna", label: "DNA", eyebrow: "Brand foundations" },
  { id: "outputs", label: "Outputs", eyebrow: "Canvas and artifacts" },
  { id: "scheduler", label: "Scheduler", eyebrow: "Experimental" },
  { id: "settings", label: "Settings", eyebrow: "Workspace preferences" },
];

const INITIAL_MESSAGES: Message[] = [
  {
    role: "assistant",
    content:
      "What are we shaping today? Share a brand, campaign, or half-formed idea and I’ll help give it direction.",
  },
];

const INITIAL_NODES: Node[] = [
  {
    id: "brief",
    position: { x: 80, y: 90 },
    data: { label: "Campaign brief" },
    style: { borderColor: "#d96b49", background: "#fffaf2" },
  },
  {
    id: "direction",
    position: { x: 390, y: 40 },
    data: { label: "Creative direction" },
    style: { borderColor: "#d8ac42", background: "#fffdf7" },
  },
  {
    id: "artifact",
    position: { x: 390, y: 210 },
    data: { label: "Output concept" },
    style: { borderColor: "#647763", background: "#f8fbf7" },
  },
];

const INITIAL_EDGES: Edge[] = [
  { id: "brief-direction", source: "brief", target: "direction" },
  { id: "direction-artifact", source: "direction", target: "artifact" },
];

function MenuIcon({ open }: { open: boolean }) {
  return (
    <span className={`${styles.menuIcon} ${open ? styles.menuIconOpen : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function ChatView({ sessionKey }: { sessionKey: number }) {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;

    setMessages((current) => [
      ...current,
      { role: "user", content },
      {
        role: "assistant",
        content:
          "Placeholder reply: I’ve captured that thought. In a future pass, I’ll turn it into a structured creative direction.",
      },
    ]);
    setDraft("");
  }

  return (
    <section className={styles.workspaceView} aria-labelledby={`chat-title-${sessionKey}`}>
      <header className={styles.viewHeader}>
        <div>
          <p className={styles.eyebrow}>AI creative partner</p>
          <h1 id={`chat-title-${sessionKey}`}>Start with the spark.</h1>
        </div>
        <span className={styles.statusDot}>Local demo</span>
      </header>

      <div className={styles.chatPanel}>
        <div className={styles.messageList} aria-live="polite">
          {messages.map((message, index) => (
            <article
              className={`${styles.message} ${
                message.role === "user" ? styles.userMessage : styles.assistantMessage
              }`}
              key={`${message.role}-${index}`}
            >
              <span>{message.role === "user" ? "You" : "Curator"}</span>
              <p>{message.content}</p>
            </article>
          ))}
        </div>

        <form className={styles.composer} onSubmit={sendMessage}>
          <label htmlFor={`chat-input-${sessionKey}`}>Message Creative Curator</label>
          <div>
            <textarea
              id={`chat-input-${sessionKey}`}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Describe the idea, audience, feeling, or outcome…"
              rows={3}
              value={draft}
            />
            <button disabled={!draft.trim()} type="submit">
              Send
              <span aria-hidden="true">↗</span>
            </button>
          </div>
          <small>UI demo only — no message leaves this browser.</small>
        </form>
      </div>
    </section>
  );
}

function DnaView() {
  const traits = [
    ["Point of view", "Make ambitious creative work feel clear and navigable."],
    ["Audience", "Small teams turning an early thought into a coherent campaign."],
    ["Promise", "Structure without sanding away the interesting edges."],
  ];

  return (
    <section className={styles.workspaceView} aria-labelledby="dna-view-title">
      <header className={styles.viewHeader}>
        <div>
          <p className={styles.eyebrow}>Brand foundations</p>
          <h1 id="dna-view-title">DNA</h1>
          <p>A working hypothesis for the voice and principles behind Creative Curator.</p>
        </div>
      </header>
      <div className={styles.dnaOverview}>
        {traits.map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <h2>{value}</h2>
          </article>
        ))}
      </div>
      <div className={styles.tonePanel}>
        <div>
          <span>Playful</span>
          <strong>Confident</strong>
          <span>Clear</span>
        </div>
        <div className={styles.toneTrack}><i style={{ left: "68%" }} /></div>
        <div>
          <span>Quiet</span>
          <strong>Confident</strong>
          <span>Loud</span>
        </div>
        <div className={styles.toneTrack}><i style={{ left: "68%" }} /></div>
        <div>
          <span>Quiet</span>
          <strong>Confident</strong>
          <span>Loud</span>
        </div>
        <div className={styles.toneTrack}><i style={{ left: "68%" }} /></div>
        <div>
          <span>Quiet</span>
          <strong>Confident</strong>
          <span>Loud</span>
        </div>
        <div className={styles.toneTrack}><i style={{ left: "68%" }} /></div>
        <div>
          <span>Quiet</span>
          <strong>Confident</strong>
          <span>Loud</span>
        </div>
        <div className={styles.toneTrack}><i style={{ left: "68%" }} /></div>
        <div>
          <span>Quiet</span>
          <strong>Confident</strong>
          <span>Loud</span>
        </div>
        <div className={styles.toneTrack}><i style={{ left: "68%" }} /></div>
        <div>
          <span>Playful</span>
          <strong>Considered</strong>
          <span>Formal</span>
        </div>
        <div className={styles.toneTrack}><i style={{ left: "57%" }} /></div>
      </div>
    </section>
  );
}

function CanvasView() {
  const [nodes, , onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const onConnect = useCallback(
    (connection: Connection) => setEdges((current) => addEdge(connection, current)),
    [setEdges],
  );

  return (
    <section className={styles.workspaceView} aria-labelledby="outputs-view-title">
      <header className={styles.viewHeader}>
        <div>
          <p className={styles.eyebrow}>Outputs</p>
          <h1 id="outputs-view-title">A canvas for what comes next.</h1>
          <p>Drag the cards, pan the surface, or zoom to explore this placeholder workspace.</p>
        </div>
        <Link className={styles.studioLink} href="/studio">Open direction studio ↗</Link>
      </header>
      <div className={styles.canvasFrame}>
        <ReactFlow
          edges={edges}
          fitView
          nodes={nodes}
          onConnect={onConnect}
          onEdgesChange={onEdgesChange}
          onNodesChange={onNodesChange}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#a9aea4" gap={24} size={1} />
          <MiniMap
            maskColor="rgba(244, 241, 232, 0.72)"
            nodeColor="#d96b49"
            pannable
            zoomable
          />
          <Controls showInteractive={false} />
        </ReactFlow>
        <span className={styles.canvasHint}>Scroll to zoom · drag the canvas to pan</span>
      </div>
    </section>
  );
}

// Experimental concept only. Scheduler is not committed to the roadmap and may be removed.
function SchedulerView() {
  return (
    <section className={styles.workspaceView} aria-labelledby="scheduler-view-title">
      <header className={styles.viewHeader}>
        <div>
          <p className={styles.eyebrow}>Experimental — may be removed</p>
          <h1 id="scheduler-view-title">Scheduler</h1>
          <p>A lightweight placeholder for planning creative releases.</p>
        </div>
        <span className={styles.experimentalBadge}>Lab concept</span>
      </header>
      <div className={styles.emptyState}>
        <span>07 / 21</span>
        <h2>No releases scheduled.</h2>
        <p>This concept is intentionally inactive while the product direction is being decided.</p>
        <button disabled type="button">Schedule an output</button>
      </div>
    </section>
  );
}

function SettingsView() {
  const [apiKey, setApiKey] = useState("");

  return (
    <section className={styles.workspaceView} aria-labelledby="settings-view-title">
      <header className={styles.viewHeader}>
        <div>
          <p className={styles.eyebrow}>Workspace preferences</p>
          <h1 id="settings-view-title">Settings</h1>
          <p>These controls are visual placeholders and do not persist yet.</p>
        </div>
      </header>
      <div className={styles.settingsGrid}>
        <label className={styles.settingCard}>
          <span>Font picker</span>
          <strong>Interface typeface</strong>
          <select defaultValue="aptos">
            <option value="aptos">Aptos + Iowan Old Style</option>
            <option value="system">System Sans</option>
            <option value="editorial">Editorial Serif</option>
          </select>
          <small>Preview only — selection does not change the interface.</small>
        </label>
        <div className={styles.settingCard}>
          <span>Config file locations</span>
          <strong>Project configuration</strong>
          <code>client/next.config.ts</code>
          <code>client/tsconfig.json</code>
          <code>backend/.env</code>
        </div>
        <label className={styles.settingCard}>
          <span>Change AI model</span>
          <strong>Default model</strong>
          <select defaultValue="creative-curator">
            <option value="creative-curator">Creative Curator Default</option>
            <option value="fast-concepts">Fast Concepts</option>
            <option value="deep-direction">Deep Direction</option>
          </select>
          <small>UI only — no model is selected at runtime.</small>
        </label>
        <label className={styles.settingCard}>
          <span>Provide API key</span>
          <strong>Personal provider key</strong>
          <input
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-••••••••••••••••"
            type="password"
            value={apiKey}
          />
          <small>Held in local component state only and never submitted.</small>
        </label>
      </div>
    </section>
  );
}

export default function CreativeShell() {
  const [activeView, setActiveView] = useState<View>("chat");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatSession, setChatSession] = useState(0);

  function navigate(view: View) {
    if (view === "chat") setChatSession((current) => current + 1);
    setActiveView(view);
    setDrawerOpen(false);
  }

  const activeLabel = NAV_ITEMS.find((item) => item.id === activeView)?.label ?? "New Chat";

  return (
    <main className={styles.appShell}>
      <header className={styles.appBar}>
        <button
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
          className={styles.menuButton}
          onClick={() => setDrawerOpen((current) => !current)}
          type="button"
        >
          <MenuIcon open={drawerOpen} />
        </button>
        <button className={styles.appWordmark} onClick={() => navigate("chat")} type="button">
          Creative Curator
        </button>
        <span className={styles.currentView}>{activeLabel}</span>
      </header>

      <div
        aria-hidden="true"
        className={`${styles.drawerScrim} ${drawerOpen ? styles.drawerScrimOpen : ""}`}
        onClick={() => setDrawerOpen(false)}
      />
      <aside
        aria-label="Primary navigation"
        className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`}
      >
        <div className={styles.drawerHeader}>
          <p>Creative workspace</p>
          <span>Direction, conversation, and making in one place.</span>
        </div>
        <nav>
          {NAV_ITEMS.map((item, index) => (
            <button
              aria-current={activeView === item.id ? "page" : undefined}
              className={activeView === item.id ? styles.activeNavItem : ""}
              key={item.id}
              onClick={() => navigate(item.id)}
              type="button"
            >
              <small>0{index + 1}</small>
              <span>
                <strong>{item.label}</strong>
                <em>{item.eyebrow}</em>
              </span>
              <i aria-hidden="true">↗</i>
            </button>
          ))}
        </nav>
        <div className={styles.drawerFooter}>
          <Link href="/studio">Original direction workflow</Link>
          <span>UI prototype · local state only</span>
        </div>
      </aside>

      <div className={styles.appContent}>
        {activeView === "chat" && <ChatView key={chatSession} sessionKey={chatSession} />}
        {activeView === "dna" && <DnaView />}
        {activeView === "outputs" && <CanvasView />}
        {activeView === "scheduler" && <SchedulerView />}
        {activeView === "settings" && <SettingsView />}
      </div>
    </main>
  );
}
