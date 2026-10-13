import { useState } from "react";
import Chat from "./components/Chat.jsx";
import Explorer from "./components/Explorer.jsx";

export default function App() {
  const [tab, setTab] = useState("chat");
  // chat history lives here (not inside <Chat>) so it survives switching tabs
  const [messages, setMessages] = useState([]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Constitution RAG</span>
        <nav className="tabs">
          <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
            Chat
          </button>
          <button className={tab === "explore" ? "active" : ""} onClick={() => setTab("explore")}>
            Explore chunks
          </button>
        </nav>
      </header>

      {tab === "chat" ? <Chat messages={messages} setMessages={setMessages} /> : <Explorer />}
    </div>
  );
}
