import { useState, useEffect, useCallback } from "react";

// ─── Google Drive MCP Integration ──────────────────────────────────────────
const SHEET_FILE_NAME = "Dashboard_Gestao_Tarefas";

async function callDriveAI(userMessage, conversationHistory = []) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: `Você é um assistente que gerencia dados de projetos e tarefas usando Google Drive MCP.
O arquivo de dados se chama "${SHEET_FILE_NAME}.json" no Google Drive.
Sempre responda APENAS com JSON válido, sem markdown, sem texto extra.
Para listar arquivos, usar create_file ou update_file conforme necessário.`,
      messages: [...conversationHistory, { role: "user", content: userMessage }],
      mcp_servers: [{ type: "url", url: "https://drivemcp.googleapis.com/mcp/v1", name: "gdrive" }],
    }),
  });
  const data = await response.json();
  return data;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  "Não iniciado": { color: "#94a3b8", bg: "#f1f5f9", icon: "○" },
  "Em andamento": { color: "#3b82f6", bg: "#eff6ff", icon: "◔" },
  "Bloqueado":    { color: "#ef4444", bg: "#fef2f2", icon: "✕" },
  "Concluído":    { color: "#22c55e", bg: "#f0fdf4", icon: "✓" },
};
const PRIORITY_CONFIG = {
  Alta:   { color: "#ef4444", label: "↑ Alta" },
  Média:  { color: "#f59e0b", label: "→ Média" },
  Baixa:  { color: "#22c55e", label: "↓ Baixa" },
};

const today = () => new Date().toISOString().split("T")[0];

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date(today())) / 86400000);
  return diff;
}

function DeadlineBadge({ date }) {
  if (!date) return <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>;
  const d = daysUntil(date);
  const color = d < 0 ? "#ef4444" : d <= 3 ? "#f59e0b" : "#64748b";
  const label = d < 0 ? `${Math.abs(d)}d atrasado` : d === 0 ? "Hoje" : `${d}d`;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, background: color + "18", padding: "2px 7px", borderRadius: 20 }}>
      {new Date(date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} · {label}
    </span>
  );
}

const EMPTY_ITEM = { id: "", title: "", type: "task", projectId: "", status: "Não iniciado", priority: "Média", deadline: "", responsible: "", notes: "" };

// ─── Main Component ──────────────────────────────────────────────────────────
export default function Dashboard() {
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [driveFileId, setDriveFileId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [filterStatus, setFilterStatus] = useState("Todos");
  const [filterPriority, setFilterPriority] = useState("Todas");
  const [filterProject, setFilterProject] = useState("Todos");
  const [view, setView] = useState("board"); // board | list
  const [modal, setModal] = useState(null); // null | { mode: 'new'|'edit', item }
  const [form, setForm] = useState(EMPTY_ITEM);
  const [driveHistory, setDriveHistory] = useState([]);
  const [tab, setTab] = useState("tasks"); // tasks | projects

  // ── Load from Drive on mount ──
  useEffect(() => { loadFromDrive(); }, []);

  async function loadFromDrive() {
    setSyncing(true);
    setSyncMsg("Conectando ao Google Drive…");
    try {
      const history = [];
      const res1 = await callDriveAI(
        `Procure um arquivo chamado "${SHEET_FILE_NAME}.json" no Google Drive. Se encontrar, retorne seu ID e conteúdo. Responda APENAS com JSON: {"found": true/false, "fileId": "...", "content": {...}}`,
        history
      );
      history.push({ role: "user", content: `Procure um arquivo chamado "${SHEET_FILE_NAME}.json" no Google Drive. Se encontrar, retorne seu ID e conteúdo. Responda APENAS com JSON: {"found": true/false, "fileId": "...", "content": {...}}` });

      const textBlocks = res1.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "{}";
      history.push({ role: "assistant", content: res1.content });
      setDriveHistory(history);

      let parsed = {};
      try { parsed = JSON.parse(textBlocks.replace(/```json|```/g, "").trim()); } catch {}

      if (parsed.found && parsed.content) {
        setDriveFileId(parsed.fileId || null);
        setItems(parsed.content.items || []);
        setProjects(parsed.content.projects || []);
        setSyncMsg("✓ Dados carregados do Drive");
      } else {
        // First time — seed sample data
        const seed = getSeedData();
        setItems(seed.items);
        setProjects(seed.projects);
        setSyncMsg("✓ Novo arquivo criado no Drive");
        await saveToDrive(seed.items, seed.projects, history);
      }
    } catch (e) {
      setSyncMsg("Drive não conectado — trabalhando offline");
      const seed = getSeedData();
      setItems(seed.items);
      setProjects(seed.projects);
    }
    setSyncing(false);
  }

  async function saveToDrive(currentItems, currentProjects, history = driveHistory) {
    setSyncing(true);
    setSyncMsg("Salvando no Drive…");
    const payload = JSON.stringify({ items: currentItems, projects: currentProjects });
    try {
      const prompt = driveFileId
        ? `Atualize o arquivo com ID "${driveFileId}" no Google Drive com este conteúdo JSON: ${payload}. Responda com JSON: {"success": true}`
        : `Crie um arquivo chamado "${SHEET_FILE_NAME}.json" no Google Drive com este conteúdo: ${payload}. Responda com JSON: {"success": true, "fileId": "..."}`;

      const res = await callDriveAI(prompt, history);
      const textBlocks = res.content?.filter(b => b.type === "text").map(b => b.text).join("") || "{}";
      let parsed = {};
      try { parsed = JSON.parse(textBlocks.replace(/```json|```/g, "").trim()); } catch {}
      if (parsed.fileId) setDriveFileId(parsed.fileId);
      setSyncMsg("✓ Salvo no Drive · " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    } catch {
      setSyncMsg("⚠ Salvo localmente (Drive offline)");
    }
    setSyncing(false);
  }

  // ── CRUD ──
  function openNew(type = "task") {
    setForm({ ...EMPTY_ITEM, id: crypto.randomUUID(), type });
    setModal({ mode: "new" });
  }
  function openEdit(item) {
    setForm({ ...item });
    setModal({ mode: "edit" });
  }
  function saveForm() {
    let next;
    if (modal.mode === "new") {
      next = type === "project"
        ? { newItems: items, newProjects: [...projects, { id: form.id, title: form.title, status: form.status, deadline: form.deadline, responsible: form.responsible, notes: form.notes }] }
        : { newItems: [...items, form], newProjects: projects };
      if (form.type === "project") {
        const np = [...projects, { id: form.id, title: form.title, status: form.status, deadline: form.deadline, responsible: form.responsible, notes: form.notes }];
        setProjects(np);
        saveToDrive(items, np);
      } else {
        const ni = [...items, form];
        setItems(ni);
        saveToDrive(ni, projects);
      }
    } else {
      if (form.type === "project") {
        const np = projects.map(p => p.id === form.id ? { ...p, ...form } : p);
        setProjects(np);
        saveToDrive(items, np);
      } else {
        const ni = items.map(i => i.id === form.id ? form : i);
        setItems(ni);
        saveToDrive(ni, projects);
      }
    }
    setModal(null);
  }
  function deleteItem(id, type) {
    if (type === "project") {
      const np = projects.filter(p => p.id !== id);
      const ni = items.filter(i => i.projectId !== id);
      setProjects(np); setItems(ni);
      saveToDrive(ni, np);
    } else {
      const ni = items.filter(i => i.id !== id);
      setItems(ni);
      saveToDrive(ni, projects);
    }
  }
  function cycleStatus(id, type) {
    const statuses = Object.keys(STATUS_CONFIG);
    if (type === "project") {
      const np = projects.map(p => p.id === id ? { ...p, status: statuses[(statuses.indexOf(p.status) + 1) % statuses.length] } : p);
      setProjects(np); saveToDrive(items, np);
    } else {
      const ni = items.map(i => i.id === id ? { ...i, status: statuses[(statuses.indexOf(i.status) + 1) % statuses.length] } : i);
      setItems(ni); saveToDrive(ni, projects);
    }
  }

  // ── Filtered view ──
  const filteredItems = items.filter(i => {
    if (filterStatus !== "Todos" && i.status !== filterStatus) return false;
    if (filterPriority !== "Todas" && i.priority !== filterPriority) return false;
    if (filterProject !== "Todos" && i.projectId !== filterProject) return false;
    return true;
  });

  // ── Stats ──
  const totalTasks = items.length;
  const done = items.filter(i => i.status === "Concluído").length;
  const overdue = items.filter(i => i.deadline && daysUntil(i.deadline) < 0 && i.status !== "Concluído").length;
  const urgent = items.filter(i => i.deadline && daysUntil(i.deadline) >= 0 && daysUntil(i.deadline) <= 3 && i.status !== "Concluído").length;

  // ── Styles ──
  const s = {
    wrap: { fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: "#f8fafc", minHeight: "100vh", padding: "0 0 60px" },
    header: { background: "#0f172a", color: "#f1f5f9", padding: "20px 28px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
    logoText: { fontSize: 20, fontWeight: 700, letterSpacing: -0.5 },
    syncBadge: { fontSize: 11, color: syncing ? "#fbbf24" : "#86efac", background: "#1e293b", padding: "4px 10px", borderRadius: 20, display: "flex", alignItems: "center", gap: 5 },
    statsRow: { display: "flex", gap: 12, padding: "16px 28px", flexWrap: "wrap" },
    statCard: (accent) => ({ flex: "1 1 120px", background: "#fff", border: `2px solid ${accent}22`, borderRadius: 12, padding: "14px 18px", minWidth: 110 }),
    statNum: (accent) => ({ fontSize: 28, fontWeight: 800, color: accent, lineHeight: 1 }),
    statLabel: { fontSize: 11, color: "#94a3b8", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 },
    toolbar: { display: "flex", gap: 8, padding: "0 28px 12px", flexWrap: "wrap", alignItems: "center" },
    select: { fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", outline: "none" },
    btn: (variant = "primary") => ({
      fontSize: 12, fontWeight: 600, padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer",
      background: variant === "primary" ? "#0f172a" : variant === "ghost" ? "transparent" : "#f1f5f9",
      color: variant === "primary" ? "#fff" : "#334155",
    }),
    tabBtn: (active) => ({ fontSize: 13, fontWeight: active ? 700 : 500, padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", background: active ? "#0f172a" : "transparent", color: active ? "#fff" : "#64748b" }),
    board: { display: "flex", gap: 16, padding: "0 28px", overflowX: "auto" },
    col: { minWidth: 240, flex: "1 1 240px", background: "#fff", borderRadius: 14, padding: "14px", boxShadow: "0 1px 4px #0001" },
    colHeader: (accent) => ({ fontSize: 12, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }),
    card: { background: "#f8fafc", borderRadius: 10, padding: "11px 12px", marginBottom: 8, cursor: "pointer", border: "1px solid #e2e8f0", transition: "box-shadow .15s" },
    cardTitle: { fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 5 },
    list: { padding: "0 28px" },
    listRow: { background: "#fff", borderRadius: 10, padding: "11px 16px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10, border: "1px solid #e2e8f0", cursor: "pointer" },
    overlay: { position: "fixed", inset: 0, background: "#0007", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" },
    modal: { background: "#fff", borderRadius: 16, padding: "28px", width: "min(96vw, 480px)", maxHeight: "90vh", overflowY: "auto" },
    label: { fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 },
    input: { width: "100%", padding: "8px 11px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" },
    textarea: { width: "100%", padding: "8px 11px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", resize: "vertical", minHeight: 72, boxSizing: "border-box" },
  };

  const boardCols = Object.entries(STATUS_CONFIG).map(([status, cfg]) => ({
    status, cfg, items: filteredItems.filter(i => i.status === status),
  }));

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.logoText}>📋 Dashboard de Gestão</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Projetos · Tarefas · Prazos</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span style={s.syncBadge}>
            {syncing ? "⟳ Sincronizando…" : syncMsg || "Google Drive"}
          </span>
          <button style={{ ...s.btn("ghost"), color: "#94a3b8", fontSize: 11 }} onClick={loadFromDrive}>↻ Recarregar</button>
        </div>
      </div>

      {/* Stats */}
      <div style={s.statsRow}>
        <div style={s.statCard("#3b82f6")}>
          <div style={s.statNum("#3b82f6")}>{totalTasks}</div>
          <div style={s.statLabel}>Total tarefas</div>
        </div>
        <div style={s.statCard("#22c55e")}>
          <div style={s.statNum("#22c55e")}>{done}</div>
          <div style={s.statLabel}>Concluídas</div>
        </div>
        <div style={s.statCard("#f59e0b")}>
          <div style={s.statNum("#f59e0b")}>{urgent}</div>
          <div style={s.statLabel}>Vencem em 3d</div>
        </div>
        <div style={s.statCard("#ef4444")}>
          <div style={s.statNum("#ef4444")}>{overdue}</div>
          <div style={s.statLabel}>Atrasadas</div>
        </div>
        <div style={s.statCard("#8b5cf6")}>
          <div style={s.statNum("#8b5cf6")}>{projects.length}</div>
          <div style={s.statLabel}>Projetos</div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={s.toolbar}>
        <button style={s.tabBtn(tab === "tasks")} onClick={() => setTab("tasks")}>Tarefas</button>
        <button style={s.tabBtn(tab === "projects")} onClick={() => setTab("projects")}>Projetos</button>
        <div style={{ flex: 1 }} />
        {tab === "tasks" && <>
          <select style={s.select} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option>Todos</option>
            {Object.keys(STATUS_CONFIG).map(s => <option key={s}>{s}</option>)}
          </select>
          <select style={s.select} value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
            <option>Todas</option>
            {Object.keys(PRIORITY_CONFIG).map(p => <option key={p}>{p}</option>)}
          </select>
          <select style={s.select} value={filterProject} onChange={e => setFilterProject(e.target.value)}>
            <option value="Todos">Todos projetos</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <button style={s.btn()} onClick={() => setView(v => v === "board" ? "list" : "board")}>
            {view === "board" ? "☰ Lista" : "⊞ Board"}
          </button>
        </>}
        <button style={{ ...s.btn("primary"), background: "#3b82f6" }} onClick={() => openNew(tab === "projects" ? "project" : "task")}>
          + {tab === "projects" ? "Projeto" : "Tarefa"}
        </button>
      </div>

      {/* Content */}
      {tab === "projects" ? (
        <div style={s.list}>
          {projects.length === 0 && (
            <div style={{ textAlign: "center", color: "#94a3b8", padding: "40px 0", fontSize: 14 }}>
              Nenhum projeto ainda. Clique em "+ Projeto" para começar!
            </div>
          )}
          {projects.map(p => {
            const pTasks = items.filter(i => i.projectId === p.id);
            const pDone = pTasks.filter(i => i.status === "Concluído").length;
            const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG["Não iniciado"];
            return (
              <div key={p.id} style={{ ...s.listRow, borderLeft: `4px solid ${cfg.color}` }} onClick={() => { setForm({ ...p, type: "project" }); setModal({ mode: "edit" }); }}>
                <span style={{ fontSize: 18 }}>{cfg.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{p.title}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    {pTasks.length} tarefa{pTasks.length !== 1 ? "s" : ""} · {pDone}/{pTasks.length} concluídas
                    {p.responsible && ` · ${p.responsible}`}
                  </div>
                </div>
                <DeadlineBadge date={p.deadline} />
                <span style={{ fontSize: 11, background: cfg.bg, color: cfg.color, padding: "3px 8px", borderRadius: 12, fontWeight: 600 }}>{p.status}</span>
                <button style={{ ...s.btn("ghost"), color: "#ef4444", padding: "4px 8px" }} onClick={e => { e.stopPropagation(); if (confirm("Excluir projeto e suas tarefas?")) deleteItem(p.id, "project"); }}>✕</button>
              </div>
            );
          })}
        </div>
      ) : view === "board" ? (
        <div style={s.board}>
          {boardCols.map(({ status, cfg, items: colItems }) => (
            <div key={status} style={s.col}>
              <div style={s.colHeader(cfg.color)}>
                <span>{cfg.icon} {status}</span>
                <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>{colItems.length}</span>
              </div>
              {colItems.map(item => {
                const proj = projects.find(p => p.id === item.projectId);
                const pc = PRIORITY_CONFIG[item.priority];
                return (
                  <div key={item.id} style={s.card} onClick={() => openEdit(item)}>
                    <div style={s.cardTitle}>{item.title}</div>
                    {proj && <div style={{ fontSize: 10, color: "#8b5cf6", marginBottom: 4, fontWeight: 600 }}>📁 {proj.title}</div>}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                      {pc && <span style={{ fontSize: 10, color: pc.color, fontWeight: 700 }}>{pc.label}</span>}
                      <DeadlineBadge date={item.deadline} />
                    </div>
                    {item.responsible && <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>👤 {item.responsible}</div>}
                  </div>
                );
              })}
              {colItems.length === 0 && <div style={{ fontSize: 12, color: "#cbd5e1", textAlign: "center", padding: "20px 0" }}>Vazio</div>}
            </div>
          ))}
        </div>
      ) : (
        <div style={s.list}>
          {filteredItems.length === 0 && (
            <div style={{ textAlign: "center", color: "#94a3b8", padding: "40px 0", fontSize: 14 }}>
              Nenhuma tarefa encontrada com esses filtros.
            </div>
          )}
          {filteredItems.map(item => {
            const proj = projects.find(p => p.id === item.projectId);
            const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG["Não iniciado"];
            const pc = PRIORITY_CONFIG[item.priority];
            return (
              <div key={item.id} style={{ ...s.listRow, borderLeft: `4px solid ${cfg.color}` }} onClick={() => openEdit(item)}>
                <button style={{ ...s.btn("ghost"), padding: "2px 6px", fontSize: 16, color: cfg.color }} onClick={e => { e.stopPropagation(); cycleStatus(item.id, "task"); }} title="Clique para avançar status">{cfg.icon}</button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: item.status === "Concluído" ? "#94a3b8" : "#0f172a", textDecoration: item.status === "Concluído" ? "line-through" : "none" }}>{item.title}</div>
                  {proj && <span style={{ fontSize: 10, color: "#8b5cf6", fontWeight: 600 }}>📁 {proj.title}</span>}
                </div>
                {pc && <span style={{ fontSize: 11, color: pc.color, fontWeight: 700, whiteSpace: "nowrap" }}>{pc.label}</span>}
                <DeadlineBadge date={item.deadline} />
                {item.responsible && <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>👤 {item.responsible}</span>}
                <button style={{ ...s.btn("ghost"), color: "#ef4444", padding: "4px 8px" }} onClick={e => { e.stopPropagation(); if (confirm("Excluir tarefa?")) deleteItem(item.id, "task"); }}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div style={s.overlay} onClick={() => setModal(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 18, color: "#0f172a" }}>
              {modal.mode === "new" ? (form.type === "project" ? "Novo Projeto" : "Nova Tarefa") : "Editar"}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>Tipo</label>
              <select style={{ ...s.input }} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value, projectId: "" }))}>
                <option value="task">Tarefa</option>
                <option value="project">Projeto</option>
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>Título *</label>
              <input style={s.input} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Descreva a tarefa…" />
            </div>

            {form.type === "task" && (
              <div style={{ marginBottom: 12 }}>
                <label style={s.label}>Projeto (opcional)</label>
                <select style={s.input} value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}>
                  <option value="">— Nenhum —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={s.label}>Status</label>
                <select style={s.input} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {Object.keys(STATUS_CONFIG).map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Prioridade</label>
                <select style={s.input} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                  {Object.keys(PRIORITY_CONFIG).map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={s.label}>Prazo</label>
                <input type="date" style={s.input} value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
              </div>
              <div>
                <label style={s.label}>Responsável / Parceiro</label>
                <input style={s.input} value={form.responsible} onChange={e => setForm(f => ({ ...f, responsible: e.target.value }))} placeholder="Nome…" />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={s.label}>Notas</label>
              <textarea style={s.textarea} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Contexto, links, observações…" />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={s.btn("secondary")} onClick={() => setModal(null)}>Cancelar</button>
              <button style={{ ...s.btn(), background: "#3b82f6" }} onClick={saveForm} disabled={!form.title.trim()}>
                {modal.mode === "new" ? "Criar" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Seed data ──
function getSeedData() {
  const proj1 = crypto.randomUUID();
  const proj2 = crypto.randomUUID();
  return {
    projects: [
      { id: proj1, title: "Planejamento Aliança 2026", status: "Em andamento", deadline: "2026-06-30", responsible: "Bianca", notes: "Síntese de oficinas e prioridades estratégicas" },
      { id: proj2, title: "Fórum Itinerante", status: "Não iniciado", deadline: "2026-07-15", responsible: "Parceiros Aliança", notes: "Formato recorrente com 4 parceiros" },
    ],
    items: [
      { id: crypto.randomUUID(), title: "Consolidar resultados ICA 2025", type: "task", projectId: proj1, status: "Em andamento", priority: "Alta", deadline: "2026-06-05", responsible: "Bianca", notes: "" },
      { id: crypto.randomUUID(), title: "Revisar dados de equidade racial", type: "task", projectId: proj1, status: "Não iniciado", priority: "Alta", deadline: "2026-06-10", responsible: "Bianca", notes: "" },
      { id: crypto.randomUUID(), title: "Preparar pauta do Fórum", type: "task", projectId: proj2, status: "Não iniciado", priority: "Média", deadline: "2026-07-01", responsible: "Equipe Aliança", notes: "" },
      { id: crypto.randomUUID(), title: "Enviar relatório para Instituto Natura", type: "task", projectId: "", status: "Não iniciado", priority: "Alta", deadline: "2026-05-28", responsible: "Bianca", notes: "Tarefa solta — sem projeto vinculado" },
      { id: crypto.randomUUID(), title: "Revisão de comunicado Barueri", type: "task", projectId: "", status: "Concluído", priority: "Baixa", deadline: "", responsible: "", notes: "" },
    ],
  };
}
