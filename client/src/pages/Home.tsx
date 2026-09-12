/* Atelier Editorial: arquivo de roupas masculino, navegação contextual e edição sob demanda. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera as NativeCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { toast } from "sonner";
import { Archive, Camera as CameraIcon, ChevronLeft, ChevronRight, Download, FileText, FolderArchive, Maximize2, Plus, Search, Settings2, Shirt, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import { backupZip, buildGenerationPrompt, colorForUse, combosForPiece, daysSince, EMPTY_DATA, formatDate, loadData, Outfit, pairedCount, parseBackup, Piece, PieceType, pieceLabel, pieceSingular, pieceUses, recentUses, saveData, todayISO, TrajeData, uid, ViewMode } from "@/lib/traje";

type RelationFlow = { source: PieceType; suitId?: string; tieId?: string; shirtId?: string };
// Snapshot salvo no localStorage logo antes de abrir a câmera nativa. Se o Android
// matar o processo do app enquanto a câmera está em primeiro plano (comum em
// aparelhos com pouca RAM), o app recarrega do zero ao voltar — sem isso, o
// usuário perderia tipo/nome/código/foto já preenchidos no formulário.
const PIECE_DRAFT_KEY = "traje:piece-draft-v1";
type PieceDraft = { at: number; pieceType: PieceType; editingId: string | null; name: string; code: string; photo: string };

function Indicator({ values, period }: { values: { date: string }[]; period: number }) {
  return <div className="indicators">{[0, 1, 2].map((index) => <span key={index} className={`indicator ${values[index] ? `indicator-${colorForUse(values[index].date, period)}` : "indicator-empty"}`} title={values[index] ? formatDate(values[index].date) : "Sem uso recente"} />)}</div>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal-card" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">Traje / arquivo</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div>{children}</div></div>;
}
function Photo({ piece, size = "regular" }: { piece?: Piece; size?: "regular" | "small" }) {
  return piece?.photo ? <img className={`piece-photo ${size}`} src={piece.photo} alt="" /> : <div className={`piece-photo placeholder ${size}`}><Shirt size={size === "small" ? 18 : 26} /></div>;
}

export default function Home() {
  const [data, setData] = useState<TrajeData>(EMPTY_DATA);
  const [ready, setReady] = useState(false);
  const [bootProgress, setBootProgress] = useState({ done: 0, total: 0 });
  const [section, setSection] = useState<PieceType | "conjuntos">("conjuntos");
  const [query, setQuery] = useState("");
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [expandedCalendar, setExpandedCalendar] = useState(false);
  const [modal, setModal] = useState<"piece" | "outfit" | "exports" | "settings" | "calendar" | "relations" | null>(null);
  const [editing, setEditing] = useState<Piece | null>(null);
  const [relationPiece, setRelationPiece] = useState<Piece | null>(null);
  const [relationFlow, setRelationFlow] = useState<RelationFlow | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [calendarOutfitId, setCalendarOutfitId] = useState<string | null>(null);
  const [pieceType, setPieceType] = useState<PieceType>("terno");
  const [selectedSuit, setSelectedSuit] = useState("");
  const [selectedTie, setSelectedTie] = useState("");
  const [selectedShirt, setSelectedShirt] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [exportName, setExportName] = useState("backup-traje");
  const [photoDraft, setPhotoDraft] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [activeDayUses, setActiveDayUses] = useState<UseRecord[]>([]);
  const [task, setTask] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [confirmDeleteOutfit, setConfirmDeleteOutfit] = useState<Outfit | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = (next: TrajeData) => { setData(next); return saveData(next).catch((error) => { console.error("Falha ao salvar dados do Traje:", error); toast.error(error instanceof Error ? error.message : "Não foi possível salvar as alterações.", { duration: 10000 }); throw error; }); };
  // Carrega os dados (agora do IndexedDB, não mais do localStorage) de forma
  // assíncrona. Enquanto isso, mostramos uma tela leve de carregamento — e, se
  // houver uma migração do formato antigo em andamento, o progresso dela.
  useEffect(() => {
    let cancelled = false;
    // Pede ao navegador/WebView para tratar o armazenamento como persistente
    // (reduz o risco de o sistema limpar o IndexedDB sob pressão de memória).
    // Best-effort: se a API não existir ou for negada, o app segue normalmente.
    navigator.storage?.persist?.().catch(() => {});
    loadData((done, total) => { if (!cancelled) setBootProgress({ done, total }); }).then((loaded) => { if (!cancelled) { setData(loaded); setReady(true); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Aplica o tema escolhido (seguir sistema / claro / escuro) na raiz do documento.
  // O Tailwind já está configurado com @custom-variant dark (&:is(.dark *)), então
  // basta alternar a classe "dark" no <html>.
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    const mode = data.settings.themeMode;
    if (mode === "escuro") { root.classList.add("dark"); return; }
    if (mode === "claro") { root.classList.remove("dark"); return; }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => root.classList.toggle("dark", query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [ready, data.settings.themeMode]);
  function persistPieceDraft(photo: string) {
    try { localStorage.setItem(PIECE_DRAFT_KEY, JSON.stringify({ at: Date.now(), pieceType, editingId: editing?.id ?? null, name: draftName, code: draftCode, photo } satisfies PieceDraft)); } catch { /* localStorage indisponível: recuperação de rascunho fica desativada, sem afetar o resto do app */ }
  }
  function clearPieceDraft() { try { localStorage.removeItem(PIECE_DRAFT_KEY); } catch { /* ver acima */ } }
  function closePieceModal() { clearPieceDraft(); setModal(null); }
  // Ao montar, verifica se existe um cadastro interrompido por uma recriação do
  // processo (ex.: durante a câmera) e devolve o usuário exatamente para onde
  // estava, com o formulário e a foto já preenchidos.
  useEffect(() => {
    if (!ready) return;
    try {
      const raw = localStorage.getItem(PIECE_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as PieceDraft;
      if (!draft || Date.now() - draft.at > 10 * 60 * 1000) { localStorage.removeItem(PIECE_DRAFT_KEY); return; }
      const found = draft.editingId ? data.pieces.find((p) => p.id === draft.editingId) ?? null : null;
      setPieceType(draft.pieceType);
      setEditing(found);
      setDraftName(draft.name ?? "");
      setDraftCode(draft.code ?? "");
      setPhotoDraft(draft.photo ?? "");
      setModal("piece");
      toast.info("Retomamos o cadastro de onde você parou.");
    } catch { /* rascunho corrompido ou indisponível: segue sem restaurar */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const [filters, setFilters] = useState<{ photo: "all" | "with" | "without"; unused30: boolean; leastUsed: boolean }>({ photo: "all", unused30: false, leastUsed: false });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<PieceType | "conjuntos" | null>(null);
  const activeFilterCount = (filters.photo !== "all" ? 1 : 0) + (filters.unused30 ? 1 : 0) + (filters.leastUsed ? 1 : 0);
  const pieces = useMemo(() => {
    let list = data.pieces.filter((piece) => !query || `${piece.name} ${piece.code}`.toLowerCase().includes(query.toLowerCase()));
    if (filters.photo === "with") list = list.filter((p) => Boolean(p.photo));
    if (filters.photo === "without") list = list.filter((p) => !p.photo);
    if (filters.leastUsed) list = [...list].sort((a, b) => combosForPiece(data, a.id) - combosForPiece(data, b.id));
    return list;
  }, [data, query, filters]);
  const byId = useMemo(() => new Map(data.pieces.map((piece) => [piece.id, piece])), [data.pieces]);
  const outfits = useMemo(() => {
    let list = data.outfits.filter((outfit) => [outfit.suitId, outfit.tieId, outfit.shirtId].some((id) => `${byId.get(id)?.name} ${byId.get(id)?.code}`.toLowerCase().includes(query.toLowerCase())));
    if (filters.unused30) list = list.filter((o) => !data.uses.some((u) => u.outfitId === o.id && daysSince(u.date) <= 30));
    if (filters.leastUsed) list = [...list].sort((a, b) => data.uses.filter((u) => u.outfitId === a.id).length - data.uses.filter((u) => u.outfitId === b.id).length);
    return list;
  }, [data, byId, query, filters]);
  const currentMonth = calendarDate.toLocaleString("pt-BR", { month: "long" });

  function openPiece(type: PieceType, piece?: Piece) { setPieceType(type); setEditing(piece ?? null); setDraftName(piece?.name ?? ""); setDraftCode(piece?.code ?? ""); setPhotoDraft(piece?.photo ?? ""); setModal("piece"); }
  function selectPiece(piece: Piece) { if (!piece.id) return openPiece(piece.type); if (editMode) return openPiece(piece.type, piece); const flow: RelationFlow = piece.type === "terno" ? { source: piece.type, suitId: piece.id } : piece.type === "gravata" ? { source: piece.type, tieId: piece.id } : { source: piece.type, shirtId: piece.id }; setRelationPiece(piece); setRelationFlow(flow); setModal("relations"); }
  async function takePhoto() {
    // Snapshot salvo já aqui, antes de sair para o app de câmera: é o instante em
    // que o Android pode matar o processo por memória — se isso acontecer, o
    // useEffect de restauração devolve nome/código/tipo/foto ao reabrir.
    persistPieceDraft(photoDraft);
    try {
      // allowEditing:true used to open a system "crop" activity after the shot; many
      // Android builds (and Android 11+ package-visibility rules) don't ship one, which
      // made the whole capture fail before ever showing the camera. Cropping isn't
      // essential here, so it's disabled for reliability.
      //
      // resultType: Uri (em vez de DataUrl) evita que o plugin nativo tenha que
      // codificar a foto inteira em uma string Base64 dentro do processo Java/Kotlin
      // logo depois da captura — essa conversão nativa de uma foto de 12MP+ é o que
      // derrubava o processo do app bem no instante da confirmação (parecia um
      // "reinício"). Com Uri, o plugin só copia o arquivo; quem redimensiona e
      // comprime para Base64 é o JS, via canvas, já em um tamanho pequeno e controlado.
      const photo = await NativeCamera.getPhoto({ quality: 88, width: 1280, height: 1280, allowEditing: false, resultType: CameraResultType.Uri, source: CameraSource.Camera, saveToGallery: false });
      if (photo.webPath) {
        const compressed = await compressImage(photo.webPath);
        setPhotoDraft(compressed);
        persistPieceDraft(compressed);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Erro ao abrir a câmera:", message);
      if (/cancel/i.test(message)) toast.info("A câmera foi cancelada.");
      else toast.error(`Erro da câmera: ${message || "desconhecido"}`, { duration: 10000 });
    }
  }
  // Recebe um webPath (arquivo local devolvido pela câmera) e devolve um DataUrl
  // JPEG já redimensionado e comprimido, evitando manter em memória qualquer
  // versão da imagem maior do que o necessário para a prévia/armazenamento.
  function compressImage(webPath: string, maxSize = 1024, quality = 0.72): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas indisponível"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Não foi possível processar a foto"));
      img.src = webPath;
    });
  }
  function selectPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.type !== "image/jpeg") return toast.error("Escolha uma imagem JPG.");
    // Fotos escolhidas da galeria podem vir em resolução original (vários MB) —
    // mesmo risco de fotos importadas: grande demais para a ponte do Capacitor
    // sem redimensionar. Reaproveita a mesma compressão usada para a câmera.
    const url = URL.createObjectURL(file);
    compressImage(url)
      .then((compressed) => setPhotoDraft(compressed))
      .catch(() => toast.error("Não foi possível processar a foto."))
      .finally(() => URL.revokeObjectURL(url));
  }
  async function savePiece(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const name = draftName.trim(); const code = draftCode.trim().toUpperCase();
    const type = editing?.type ?? pieceType; // ao editar, o tipo da peça nunca muda, mesmo que as abas de tipo tenham sido tocadas
    if (!name || !code) return toast.error("Preencha nome e código.");
    if (data.pieces.some((p) => p.type === type && p.code === code && p.id !== editing?.id)) return toast.error("Este código já existe neste tipo de peça.");
    const photo = photoDraft;
    const nextPiece: Piece = { id: editing?.id ?? uid("piece"), type, name, code, photo: photo || undefined, createdAt: editing?.createdAt ?? new Date().toISOString() };
    try {
      // Só fecha o modal e limpa o rascunho DEPOIS que a gravação (incluindo a foto,
      // no IndexedDB) realmente terminou — evita perder a foto se o usuário fechar o
      // app logo em seguida, antes do salvamento assíncrono concluir.
      await persist({ ...data, pieces: editing ? data.pieces.map((p) => p.id === editing.id ? nextPiece : p) : [...data.pieces, nextPiece] });
      clearPieceDraft(); setModal(null); toast.success(editing ? "Peça atualizada." : "Peça cadastrada.");
    } catch { /* persist() já mostrou o erro; mantém o modal aberto para o usuário tentar de novo */ }
  }
  async function deletePiece(piece: Piece) {
    if (!confirm(`Excluir ${piece.name}? Combinações relacionadas também serão removidas.`)) return;
    const outfitIds = data.outfits.filter((o) => [o.suitId, o.tieId, o.shirtId].includes(piece.id)).map((o) => o.id);
    try { await persist({ ...data, pieces: data.pieces.filter((p) => p.id !== piece.id), outfits: data.outfits.filter((o) => !outfitIds.includes(o.id)), uses: data.uses.filter((u) => !outfitIds.includes(u.outfitId)) }); toast.success("Peça e referências removidas."); } catch { /* erro já mostrado por persist() */ }
  }
  async function saveOutfit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedSuit || !selectedTie || !selectedShirt) return toast.error("Selecione terno, gravata e camisa.");
    if (data.outfits.some((o) => o.suitId === selectedSuit && o.tieId === selectedTie && o.shirtId === selectedShirt)) return toast.error("Este conjunto já está no arquivo.");
    try { await persist({ ...data, outfits: [...data.outfits, { id: uid("outfit"), suitId: selectedSuit, tieId: selectedTie, shirtId: selectedShirt, createdAt: new Date().toISOString() }] }); setModal(null); toast.success("Conjunto criado."); } catch { /* erro já mostrado por persist() */ }
  }
  // Exclui somente a associação terno+gravata+camisa — nunca as peças individuais.
  // Também remove os usos (calendário) que apontavam para este conjunto, para não
  // deixar referências quebradas.
  async function deleteOutfit(outfit: Outfit) {
    try {
      await persist({ ...data, outfits: data.outfits.filter((o) => o.id !== outfit.id), uses: data.uses.filter((u) => u.outfitId !== outfit.id) });
      setConfirmDeleteOutfit(null);
      if (calendarOutfitId === outfit.id) { setCalendarOutfitId(null); setModal(null); }
      setActiveDayUses((uses) => uses.filter((use) => use.outfitId !== outfit.id));
      toast.success("Conjunto excluído com sucesso.");
    } catch { /* erro já mostrado por persist() */ }
  }
  async function registerUse(outfitId: string, date = selectedDate) { try { await persist({ ...data, uses: [...data.uses, { id: uid("use"), outfitId, date }] }); toast.success("Uso registrado no calendário."); } catch { /* erro já mostrado por persist() */ } }
  async function removeUse(useId: string) { try { await persist({ ...data, uses: data.uses.filter((use) => use.id !== useId) }); setActiveDayUses((uses) => uses.filter((use) => use.id !== useId)); toast.success("Conjunto removido deste dia."); } catch { /* erro já mostrado por persist() */ } }
  function openOutfitCalendar(outfitId: string) { setCalendarOutfitId(outfitId); setSelectedDate(todayISO()); setActiveDayUses(data.uses.filter((use) => use.outfitId === outfitId && use.date === todayISO())); setModal("calendar"); }
  function changeView(type: PieceType | "conjuntos", mode: ViewMode) { persist({ ...data, settings: { ...data.settings, viewModes: { ...data.settings.viewModes, [type]: mode } } }); }
  function changeGrid(type: PieceType | "conjuntos", columns: number) { persist({ ...data, settings: { ...data.settings, gridColumns: { ...data.settings.gridColumns, [type]: columns } } }); }
  async function downloadBackup() {
    if (task) return toast.info("Aguarde a operação atual terminar.");
    setTask({ stage: "Preparando exportação…", done: 0, total: 0 });
    try {
      const blob = await backupZip(data, (done, total) => setTask({ stage: total ? `Exportando ${done} de ${total} fotos` : "Exportando dados…", done, total }));
      await download(blob, `${exportName || "backup-traje"}.zip`);
      toast.success("Exportação concluída.");
      setModal(null);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível concluir a exportação."); }
    finally { setTask(null); }
  }
  async function downloadPrompt() { await download(new Blob([buildGenerationPrompt(data)], { type: "text/plain;charset=utf-8" }), `${exportName || "prompt-conjuntos"}.txt`); toast.success("Prompt exportado."); setModal(null); }
  async function download(blob: Blob, name: string) {
    // Android WebView does not reliably support the <a download> + blob: URL trick used on
    // the web (it either silently no-ops or opens the blob in a viewer). On native platforms
    // we write the file to the app's cache dir instead and hand it to the OS share sheet, so
    // the user can save it to Files/Drive/WhatsApp/etc. On the web build this keeps working
    // exactly as before.
    if (Capacitor.isNativePlatform()) {
      const base64 = await blobToBase64(blob);
      const written = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache });
      await Share.share({ title: name, dialogTitle: "Salvar ou compartilhar arquivo", url: written.uri });
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (task) return toast.info("Aguarde a importação atual terminar."); // impede duas importações simultâneas, que poderiam corromper os dados
    setTask({ stage: "Importando dados…", done: 0, total: 0 });
    try {
      const next = await parseBackup(file, data, (done, total) => setTask({ stage: total ? `Importando ${done} de ${total} peças` : "Importando dados…", done, total }));
      setTask({ stage: "Salvando fotos importadas…", done: 0, total: 0 });
      // ESSENCIAL: aguardar o salvamento terminar de verdade (fotos incluídas) antes
      // de dizer "concluído" e fechar a barra de progresso. Antes esta chamada não
      // era aguardada — o app dizia que a importação tinha terminado e liberava o
      // usuário para fechar o app enquanto as fotos ainda estavam sendo gravadas em
      // segundo plano, interrompendo a gravação e fazendo as fotos sumirem depois.
      await persist(next);
      toast.success("Importação concluída.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível concluir a importação."); }
    finally { setTask(null); }
  }
  function calendarDays() { const year = calendarDate.getFullYear(); const month = calendarDate.getMonth(); const start = new Date(year, month, 1).getDay(); const count = new Date(year, month + 1, 0).getDate(); const leading: Array<number | null> = [...Array(start === 0 ? 6 : start - 1)].map(() => null); return leading.concat([...Array(count)].map((_, i) => i + 1)); }
  // Semana de 7 dias (3 antes + hoje + 3 depois) para o calendário minimizado —
  // independente do mês navegado no calendário expandido.
  function miniDays() { const today = new Date(); today.setHours(12, 0, 0, 0); return [...Array(7)].map((_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + (i - 3))); }
  function isoOf(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
  function dayKey(day: number) { return `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
  function showDay(day: number) { showDayISO(dayKey(day)); }
  function showDayISO(key: string) { setActiveDayUses(data.uses.filter((use) => use.date === key)); setSelectedDate(key); setModal("calendar"); }

  if (!ready) return <div className="boot-screen"><img src="/logo-navy.png" alt="" /><strong>Traje</strong><p>{bootProgress.total ? `Preparando seus dados… ${bootProgress.done} de ${bootProgress.total}` : "Preparando seus dados…"}</p></div>;
  const nav = [{ id: "conjuntos", label: "Conjuntos" }, { id: "terno", label: "Ternos" }, { id: "gravata", label: "Gravatas" }, { id: "camisa", label: "Camisas" }] as const;
  return <>
  <div className="app-shell">
    <aside className="sidebar"><div className="brand"><img src="/logo-white.png" alt="" /><div><strong>Traje</strong><span>arquivo masculino</span></div></div><nav>{nav.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><span className={`nav-dot ${item.id}`} />{item.label}<small>{item.id === "conjuntos" ? data.outfits.length : data.pieces.filter((p) => p.type === item.id).length}</small></button>)}</nav><div className="sidebar-foot"><button onClick={() => setModal("settings")}><Settings2 size={17} /> Configurações</button><p>Dados locais<br /><span>sem nuvem, sem ruído</span></p></div></aside>
    <main className="content"><header className="topbar"><div className="title-lockup"><div className="top-signature-row"><div className="top-signature"><img src="/logo-navy.png" alt="" /><span>TRAJE / ARQUIVO MASCULINO</span></div><button className="icon-button" onClick={() => setModal("settings")} aria-label="Configurações"><Settings2 size={20} /></button></div><span className="eyebrow">Quarta-feira · 06 setembro 2026</span><h1>{section === "conjuntos" ? "Seu arquivo, sua próxima combinação." : pieceLabel(section)}</h1></div></header>
      {/* Só a barra superior e tudo o que vem antes da lista (calendário, ações
          rápidas, cabeçalho da seção, busca e filtros) ficam fixos, sem rolar —
          "o menu de pesquisa fica junto do menu dos arquivos de peça, mas fora
          da área de rolagem deles". Só a lista de peças/conjuntos (.content-scroll)
          tem rolagem própria e independente; min-height garante que ela nunca
          fique invisível mesmo se o conteúdo fixo acima for alto demais numa
          tela pequena. */}
      <div className="content-fixed">
      <section className={`calendar-strip ${expandedCalendar ? "expanded" : ""}`}><div className="calendar-header"><div><span className="eyebrow">Ritmo de uso</span><h2>Calendário</h2></div>{expandedCalendar && <div className="calendar-tools"><button className="icon-button" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}><ChevronLeft size={17} /></button><strong>{currentMonth} {calendarDate.getFullYear()}</strong><button className="icon-button" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}><ChevronRight size={17} /></button><button className="outline-button" onClick={() => setCalendarDate(new Date())}>Hoje</button></div>}</div>
        <div className="calendar-body">
          {!expandedCalendar && <div className="mini-week">{miniDays().map((date) => { const iso = isoOf(date); const isToday = iso === todayISO(); const hasUse = data.uses.some((u) => u.date === iso); return <button key={iso} className={`${isToday ? "today" : ""} ${hasUse ? "has-use" : ""}`} onClick={() => showDayISO(iso)}><span className="mini-week-label">{date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</span><strong>{date.getDate()}</strong>{hasUse && <i />}</button>; })}</div>}
          <div className="calendar-full"><div className="calendar-full-inner">
            <div className="weekdays">{["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="calendar-grid">{calendarDays().map((day, i) => day ? <button className={`${dayKey(day) === todayISO() ? "today" : ""} ${data.uses.some((u) => u.date === dayKey(day)) ? "has-use" : ""}`} key={i} onClick={() => showDay(day)}><span>{day}</span>{data.uses.some((u) => u.date === dayKey(day)) && <i />}</button> : <span key={i} />)}</div>
          </div></div>
        </div>
        <div className="calendar-caption"><span><i className="legend-dot" /> uso registrado</span><button className="text-button" onClick={() => { setExpandedCalendar(!expandedCalendar); if (!expandedCalendar) setCalendarDate(new Date()); }}>{expandedCalendar ? "Recolher" : "Ver mês completo"} <ChevronRight size={15} /></button></div>
      </section>
      <section className="quick-actions"><button onClick={() => openPiece("terno")}><span><Plus size={18} /></span><div><small className="action-label">ficha 01 · entrada</small><strong>Adicionar peça</strong><small>Comece seu arquivo</small></div></button><button onClick={() => fileRef.current?.click()}><span><Upload size={18} /></span><div><small className="action-label">ficha 02 · importar</small><strong>Importar combinações</strong><small>ZIP ou arquivo exportado</small></div></button><button onClick={() => setModal("exports")}><span><Download size={18} /></span><div><small className="action-label">ficha 03 · preservar</small><strong>Exportar configurações</strong><small>Backup ou prompt de conjuntos</small></div></button><input ref={fileRef} type="file" accept=".zip" hidden onChange={(e) => importFile(e.target.files?.[0])} /></section>
      <div className="section-heading"><div><span className="eyebrow">Arquivo de peças</span><h2>{section === "conjuntos" ? "Combinações em circulação" : `Todos os ${pieceLabel(section).toLowerCase()}`}</h2></div><div className="section-actions"><button className={`edit-toggle ${editMode ? "active" : ""}`} onClick={() => setEditMode(!editMode)}>{editMode ? "Concluir edição" : "Editar peças"}</button><button className="primary-button" onClick={() => section === "conjuntos" ? setModal("outfit") : openPiece(section)}><Plus size={17} /> Adicionar {section === "conjuntos" ? "conjunto" : section}</button></div></div>
      <div className="list-toolbar"><label className="search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nome ou código" /></label><button className={`icon-button ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-label="Filtros">{activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}<SlidersHorizontal size={18} /></button><button className="icon-button" onClick={() => setExpandedSection(section)} aria-label="Expandir seção"><Maximize2 size={18} /></button></div>
      {filtersOpen && <FiltersPanel filters={filters} onChange={setFilters} onClear={() => setFilters({ photo: "all", unused30: false, leastUsed: false })} />}
      </div>
      <div className="content-scroll">
        <Gallery type={section} pieces={pieces.filter((p) => p.type === section)} outfits={outfits} data={data} byId={byId} mode={data.settings.viewModes[section]} gridColumns={data.settings.gridColumns[section]} onModeChange={(mode) => changeView(section, mode)} onGridChange={(n) => changeGrid(section, n)} onSelectPiece={selectPiece} onDeletePiece={deletePiece} onUseOutfit={openOutfitCalendar} onDeleteOutfit={(outfit) => setConfirmDeleteOutfit(outfit)} onCreateOutfit={() => setModal("outfit")} />
      </div>
    </main>
    {expandedSection && <div className="expand-overlay"><header className="expand-header"><h2>{expandedSection === "conjuntos" ? "Todos os conjuntos" : `Todos os ${pieceLabel(expandedSection).toLowerCase()}`}</h2><button className="icon-button" onClick={() => setExpandedSection(null)} aria-label="Fechar"><X size={20} /></button></header>
      <div className="list-toolbar"><label className="search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nome ou código" /></label><button className={`icon-button ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-label="Filtros">{activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}<SlidersHorizontal size={18} /></button></div>
      {filtersOpen && <FiltersPanel filters={filters} onChange={setFilters} onClear={() => setFilters({ photo: "all", unused30: false, leastUsed: false })} />}
      <div className="expand-scroll"><Gallery type={expandedSection} pieces={pieces.filter((p) => p.type === expandedSection)} outfits={outfits} data={data} byId={byId} mode={data.settings.viewModes[expandedSection]} gridColumns={data.settings.gridColumns[expandedSection]} onModeChange={(mode) => changeView(expandedSection, mode)} onGridChange={(n) => changeGrid(expandedSection, n)} onSelectPiece={selectPiece} onDeletePiece={deletePiece} onUseOutfit={openOutfitCalendar} onDeleteOutfit={(outfit) => setConfirmDeleteOutfit(outfit)} onCreateOutfit={() => setModal("outfit")} /></div>
    </div>}
    {modal === "piece" && <Modal title={editing ? "Editar peça" : `Adicionar ${pieceType}`} onClose={closePieceModal}><form className="form" onSubmit={savePiece}><div className="type-tabs">{(["terno", "gravata", "camisa"] as PieceType[]).map((type) => <button type="button" className={pieceType === type ? "selected" : ""} key={type} disabled={Boolean(editing)} onClick={() => setPieceType(type)}>{type}</button>)}</div><label>Nome<input name="name" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Ex.: Terno carvão" required /></label><label>Código<input name="code" value={draftCode} onChange={(e) => setDraftCode(e.target.value)} placeholder="Ex.: T01" required /></label><label>Foto JPG<div className="photo-actions"><button type="button" className="outline-button" onClick={takePhoto}><CameraIcon size={15} /> Câmera</button><button type="button" className="outline-button" onClick={() => photoInputRef.current?.click()}><Upload size={15} /> Arquivo</button>{photoDraft && <button type="button" className="outline-button" onClick={() => setPhotoDraft("")}><Trash2 size={15} /> Remover</button>}</div><input ref={photoInputRef} type="file" accept="image/jpeg,.jpg,.jpeg" hidden onChange={selectPhoto} />{photoDraft && <img className="photo-preview" src={photoDraft} alt="Prévia da peça" />}</label><div className="form-actions"><button type="button" className="outline-button" onClick={closePieceModal}>Descartar</button><button className="primary-button" type="submit">{editing ? "Salvar alterações" : "Cadastrar"}</button></div></form></Modal>}
    {modal === "outfit" && <Modal title="Criar conjunto" onClose={() => setModal(null)}><form className="form" onSubmit={saveOutfit}><p className="form-note">A sequência é intencional: <strong>terno → gravata → camisa</strong>.</p><label>Terno<select value={selectedSuit} onChange={(e) => setSelectedSuit(e.target.value)}><option value="">Selecione</option>{data.pieces.filter((p) => p.type === "terno").map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label><label>Gravata<select value={selectedTie} onChange={(e) => setSelectedTie(e.target.value)}><option value="">Selecione</option>{data.pieces.filter((p) => p.type === "gravata").map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label><label>Camisa<select value={selectedShirt} onChange={(e) => setSelectedShirt(e.target.value)}><option value="">Selecione</option>{data.pieces.filter((p) => p.type === "camisa").map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label><div className="form-actions"><button type="button" className="outline-button" onClick={() => setModal(null)}>Descartar</button><button className="primary-button" type="submit">Confirmar conjunto</button></div></form></Modal>}
    {modal === "relations" && relationPiece && relationFlow && <RelationModal piece={relationPiece} flow={relationFlow} data={data} byId={byId} onFlowChange={setRelationFlow} onChooseDay={openOutfitCalendar} onEdit={() => openPiece(relationPiece.type, relationPiece)} onClose={() => setModal(null)} />}
    {modal === "exports" && <Modal title="Exportar configurações" onClose={() => setModal(null)}><div className="export-options"><button onClick={downloadPrompt}><span className="export-icon wine"><FileText size={21} /></span><div><strong>Exportar prompt para gerar conjuntos</strong><small>TXT com legendas, conjuntos atuais e instruções para o chat retornar um arquivo importável.</small></div><ChevronRight size={18} /></button><button onClick={downloadBackup}><span className="export-icon brass"><FolderArchive size={21} /></span><div><strong>Exportar backup</strong><small>ZIP completo com peças, combinações, calendário, configurações e fotos.</small></div><ChevronRight size={18} /></button></div><label className="file-name">Nome do arquivo<input value={exportName} onChange={(e) => setExportName(e.target.value)} /></label></Modal>}
    {modal === "calendar" && <Modal title={`Escolher dia · ${formatDate(selectedDate)}`} onClose={() => { setCalendarOutfitId(null); setModal(null); }}><div className="day-uses">{calendarOutfitId ? <div className="calendar-target"><span className="eyebrow">Conjunto selecionado</span><strong>{(() => { const item = data.outfits.find((o) => o.id === calendarOutfitId); return item ? `${byId.get(item.suitId)?.code} + ${byId.get(item.tieId)?.code} + ${byId.get(item.shirtId)?.code}` : "Conjunto"; })()}</strong><p>Escolha o dia em que pretende usar este conjunto e confirme o registro.</p><label className="date-picker">Dia de uso<input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label><button className="primary-button" onClick={() => { registerUse(calendarOutfitId, selectedDate); setCalendarOutfitId(null); setModal(null); }}>Registrar em {formatDate(selectedDate)}</button><button className="text-button danger" onClick={() => { const item = data.outfits.find((o) => o.id === calendarOutfitId); if (item) setConfirmDeleteOutfit(item); }}><Trash2 size={14} /> Excluir conjunto</button></div> : activeDayUses.length ? activeDayUses.map((use) => { const item = data.outfits.find((o) => o.id === use.outfitId); return <div className="day-use" key={use.id}><div><span className="eyebrow">Conjunto registrado</span><strong>{item ? `${byId.get(item.suitId)?.code} + ${byId.get(item.tieId)?.code} + ${byId.get(item.shirtId)?.code}` : "Conjunto removido"}</strong></div><div className="day-use-actions"><button className="outline-button" onClick={() => openOutfitCalendar(use.outfitId)}>Escolher outro dia</button><button className="delete-small" onClick={() => removeUse(use.id)} aria-label="Remover conjunto deste dia"><Trash2 size={15} /></button></div></div>; }) : <p className="empty-copy">Nenhum conjunto registrado neste dia.</p>} {!calendarOutfitId && <label>Adicionar uso<select onChange={(e) => e.target.value && openOutfitCalendar(e.target.value)} defaultValue=""><option value="">Selecione um conjunto</option>{data.outfits.map((o) => <option key={o.id} value={o.id}>{byId.get(o.suitId)?.code} + {byId.get(o.tieId)?.code} + {byId.get(o.shirtId)?.code}</option>)}</select></label>}</div></Modal>}
    {confirmDeleteOutfit && <Modal title="Excluir conjunto?" onClose={() => setConfirmDeleteOutfit(null)}><div className="confirm-delete"><div className="calendar-target"><span className="eyebrow">Conjunto</span><strong>Terno: {byId.get(confirmDeleteOutfit.suitId)?.code}<br />Gravata: {byId.get(confirmDeleteOutfit.tieId)?.code}<br />Camisa: {byId.get(confirmDeleteOutfit.shirtId)?.code}</strong></div><p>Essa ação removerá este conjunto, mas não excluirá as peças.</p><div className="form-actions"><button className="outline-button" onClick={() => setConfirmDeleteOutfit(null)}>Cancelar</button><button className="primary-button danger" onClick={() => deleteOutfit(confirmDeleteOutfit)}>Excluir</button></div></div></Modal>}
    {modal === "settings" && <Modal title="Configurações do arquivo" onClose={() => setModal(null)}><div className="settings-form">{([['outfitDays', 'Conjuntos', data.settings.outfitDays], ['suitDays', 'Ternos', data.settings.suitDays], ['tieDays', 'Gravatas', data.settings.tieDays], ['shirtDays', 'Camisas', data.settings.shirtDays]] as const).map(([key, label, value]) => <label key={key}>{label}<input type="number" min="1" value={value} onChange={(e) => persist({ ...data, settings: { ...data.settings, [key]: Number(e.target.value) } })} /><small>dias até o indicador sair do período</small></label>)}<label>Aparência<div className="theme-switch">{([["system", "Seguir sistema"], ["claro", "Claro"], ["escuro", "Escuro"]] as const).map(([value, label]) => <button type="button" key={value} className={data.settings.themeMode === value ? "selected" : ""} onClick={() => persist({ ...data, settings: { ...data.settings, themeMode: value } })}>{label}</button>)}</div><small>O padrão segue o modo claro/escuro do Android.</small></label></div></Modal>}
  </div>
  {task && <div className="task-overlay" role="status" aria-live="polite"><div className="task-card"><div className="task-spinner" /><strong>{task.stage}</strong>{task.total > 0 && <div className="task-bar"><i style={{ width: `${Math.min(100, (task.done / task.total) * 100)}%` }} /></div>}</div></div>}
  </>;
}

function RelationModal({ piece, flow, data, byId, onFlowChange, onChooseDay, onEdit, onClose }: { piece: Piece; flow: RelationFlow; data: TrajeData; byId: Map<string, Piece>; onFlowChange: (flow: RelationFlow) => void; onChooseDay: (outfitId: string) => void; onEdit: () => void; onClose: () => void }) {
  const matches = data.outfits.filter((outfit) => (!flow.suitId || outfit.suitId === flow.suitId) && (!flow.tieId || outfit.tieId === flow.tieId) && (!flow.shirtId || outfit.shirtId === flow.shirtId));
  const exact = matches.filter((outfit) => outfit.suitId === flow.suitId && outfit.tieId === flow.tieId && outfit.shirtId === flow.shirtId)[0];
  const nextType: PieceType | null = flow.suitId && flow.tieId && !flow.shirtId ? "camisa" : flow.suitId && flow.shirtId && !flow.tieId ? "gravata" : !flow.suitId ? "terno" : flow.suitId && !flow.tieId && !flow.shirtId ? "gravata" : null;
  const candidateIds = nextType === "terno" ? matches.map((outfit) => outfit.suitId) : nextType === "gravata" ? matches.map((outfit) => outfit.tieId) : nextType === "camisa" ? matches.map((outfit) => outfit.shirtId) : [];
  const candidates = Array.from(new Set(candidateIds)).map((id) => byId.get(id)).filter((item): item is Piece => Boolean(item));
  const title = nextType ? `${pieceLabel(nextType)} compatíveis` : "Conjunto compatível";
  function choose(candidate: Piece) { onFlowChange({ ...flow, ...(candidate.type === "terno" ? { suitId: candidate.id } : candidate.type === "gravata" ? { tieId: candidate.id } : { shirtId: candidate.id }) }); }
  return <Modal title={title} onClose={onClose}><div className="relation-intro"><span className="code-tag">{piece.code}</span><p>{nextType ? `Selecione ${nextType === "terno" ? "um terno" : nextType === "gravata" ? "uma gravata" : "uma camisa"} para continuar a combinação.` : "Esta combinação existe no seu arquivo."}</p></div>{nextType ? candidates.length ? <div className="relation-list">{candidates.map((candidate) => <button className="relation-option" key={candidate.id} onClick={() => choose(candidate)}><Photo piece={candidate} size="small" /><span><span className="eyebrow">{candidate.type}</span><strong>{candidate.code} · {candidate.name}</strong></span><ChevronRight size={16} /></button>)}</div> : <p className="empty-copy">Nenhuma peça compatível foi encontrada para esta etapa.</p> : exact ? <div className="calendar-target"><span className="eyebrow">Conjunto completo</span><strong>{byId.get(exact.suitId)?.code} + {byId.get(exact.tieId)?.code} + {byId.get(exact.shirtId)?.code}</strong><p>Escolha o dia em que pretende usar este conjunto.</p><button className="primary-button" onClick={() => onChooseDay(exact.id)}>Escolher dia</button></div> : <p className="empty-copy">Não existe um conjunto completo para esta seleção.</p>}<div className="form-actions"><button className="outline-button" onClick={onEdit}>Editar peça</button><button className="primary-button" onClick={onClose}>Fechar</button></div></Modal>;
}

function EmptyState({ label, onClick }: { label: string; onClick: () => void }) { return <div className="empty-state"><Archive size={24} /><h3>Você ainda não cadastrou nenhum {label}.</h3><p>Comece adicionando seu primeiro item ao arquivo.</p><button className="primary-button" onClick={onClick}><Plus size={16} /> Adicionar {label}</button></div>; }
function FiltersPanel({ filters, onChange, onClear }: { filters: { photo: "all" | "with" | "without"; unused30: boolean; leastUsed: boolean }; onChange: (filters: { photo: "all" | "with" | "without"; unused30: boolean; leastUsed: boolean }) => void; onClear: () => void }) {
  return <div className="filters-panel">
    <div className="filters-group"><span>Fotos</span><div className="filters-options">{([["all", "Todas"], ["with", "Com foto"], ["without", "Sem foto"]] as const).map(([value, label]) => <button key={value} className={filters.photo === value ? "selected" : ""} onClick={() => onChange({ ...filters, photo: value })}>{label}</button>)}</div></div>
    <div className="filters-group"><span>Combinações</span><div className="filters-options"><button className={filters.unused30 ? "selected" : ""} onClick={() => onChange({ ...filters, unused30: !filters.unused30 })}>Não usadas nos últimos 30 dias</button><button className={filters.leastUsed ? "selected" : ""} onClick={() => onChange({ ...filters, leastUsed: !filters.leastUsed })}>Menos utilizadas primeiro</button></div></div>
    <button className="text-button" onClick={onClear}>Limpar filtros</button>
  </div>;
}
function ViewSwitcher({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) { return <div className="view-switcher">{(["detalhado", "compacto", "grade"] as ViewMode[]).map((item) => <button className={mode === item ? "active" : ""} onClick={() => onChange(item)} key={item}>{item}</button>)}</div>; }
// Linha de quatro pontos para escolher a densidade do modo Grade (2/3/4/5 cartões por linha).
function GridColumnPicker({ value, onChange }: { value: number; onChange: (columns: number) => void }) { return <div className="grid-dots" role="group" aria-label="Cartões por linha">{[2, 3, 4, 5].map((columns) => <button key={columns} className={value === columns ? "active" : ""} title={`${columns} cartões por linha`} aria-label={`${columns} cartões por linha`} onClick={() => onChange(columns)}><i /></button>)}</div>; }
// Componente único para "peças" (terno/gravata/camisa) e para "conjuntos": os três
// modos (Detalhado, Compacto, Grade) são compartilhados e persistidos da mesma forma.
// Conjuntos sempre mostra os conjuntos completos (terno+gravata+camisa); as demais
// seções sempre mostram a peça individual — cada uma só muda a densidade visual.
function Gallery({ type, pieces, outfits, data, byId, mode, gridColumns, onModeChange, onGridChange, onSelectPiece, onDeletePiece, onUseOutfit, onDeleteOutfit, onCreateOutfit }: { type: PieceType | "conjuntos"; pieces: Piece[]; outfits: Outfit[]; data: TrajeData; byId: Map<string, Piece>; mode: ViewMode; gridColumns: number; onModeChange: (mode: ViewMode) => void; onGridChange: (columns: number) => void; onSelectPiece: (piece: Piece) => void; onDeletePiece: (piece: Piece) => void; onUseOutfit: (outfitId: string) => void; onDeleteOutfit: (outfit: Outfit) => void; onCreateOutfit: () => void }) {
  const gridStyle = mode === "grade" ? ({ "--grid-cols": gridColumns } as React.CSSProperties) : undefined;
  const gridClass = mode === "grade" ? ` grid-cols-${gridColumns}` : "";
  return <>
    <div className="list-controls"><ViewSwitcher mode={mode} onChange={onModeChange} />{mode === "grade" && <GridColumnPicker value={gridColumns} onChange={onGridChange} />}</div>
    {type === "conjuntos"
      ? <div className={`outfit-list mode-${mode}${gridClass}`} style={gridStyle}>{outfits.length ? outfits.map((outfit, index) => <OutfitCard key={outfit.id} outfit={outfit} data={data} byId={byId} mode={mode} index={index} onUse={() => onUseOutfit(outfit.id)} onClick={() => onUseOutfit(outfit.id)} onDelete={() => onDeleteOutfit(outfit)} />) : <EmptyState label="conjunto" onClick={onCreateOutfit} />}</div>
      : <div className={`piece-list mode-${mode}${gridClass}`} style={gridStyle}>{pieces.length ? pieces.map((piece, index) => <PieceCard key={piece.id} piece={piece} type={type as PieceType} data={data} mode={mode} index={index} onSelect={onSelectPiece} onDelete={onDeletePiece} />) : <EmptyState label={type as string} onClick={() => onSelectPiece({ id: "", type: type as PieceType, name: "", code: "", createdAt: "" })} />}</div>}
  </>;
}
// Modo Detalhado: foto, código, nome, peças associadas e combinações possíveis (o máximo
// de informação sem abrir a peça). Compacto: só foto, nome e combinações — bem mais raso.
// Grade: apenas foto, nome e indicadores, em cartões verticais.
function PieceCard({ piece, type, data, mode, index, onSelect, onDelete }: { piece: Piece; type: PieceType; data: TrajeData; mode: ViewMode; index: number; onSelect: (piece: Piece) => void; onDelete: (piece: Piece) => void }) {
  const period = type === "terno" ? data.settings.suitDays : type === "gravata" ? data.settings.tieDays : data.settings.shirtDays;
  const uses = pieceUses(data, piece.id, period);
  const combos = combosForPiece(data, piece.id);
  const paired = pairedCount(data, piece);
  return <article className="piece-card" style={{ animationDelay: `${index * 35}ms` }} onClick={() => onSelect(piece)}>
    <Photo piece={piece} size={mode === "grade" ? "regular" : "small"} />
    <div className="piece-info">
      {mode === "detalhado" && <span className="code-tag">{piece.code}</span>}
      <h3>{piece.name}</h3>
      {mode === "detalhado" && <p className="piece-meta">{paired.count ? `Combina com ${paired.count} ${pieceSingular(paired.label)}${paired.count > 1 ? "s" : ""}` : `Ainda sem ${pieceSingular(paired.label)} associada`}</p>}
      {mode !== "grade" && <p className="piece-meta">{combos ? `${combos} combinaç${combos > 1 ? "ões" : "ão"} possíve${combos > 1 ? "is" : "l"}` : "Sem combinações ainda"}</p>}
    </div>
    <Indicator values={uses} period={period} />
    <button className="delete-small" onClick={(e) => { e.stopPropagation(); onDelete(piece); }} aria-label="Excluir"><Trash2 size={15} /></button>
  </article>;
}
function OutfitCard({ outfit, data, byId, mode = "detalhado", index, onUse, onClick, onDelete }: { outfit: Outfit; data: TrajeData; byId: Map<string, Piece>; mode?: ViewMode; index: number; onUse: () => void; onClick: () => void; onDelete: () => void }) {
  const last = data.uses.filter((u) => u.outfitId === outfit.id).sort((a, b) => b.date.localeCompare(a.date))[0];
  const recent = recentUses(data, outfit.id, data.settings.outfitDays);
  const pieces = [byId.get(outfit.suitId), byId.get(outfit.tieId), byId.get(outfit.shirtId)];
  const labels = ["Terno", "Gravata", "Camisa"];
  const compact = mode === "compacto" || mode === "grade";
  const detailed = mode === "detalhado";
  return <article className={`outfit-card ${detailed ? "outfit-card-detailed" : ""}`} style={{ animationDelay: `${index * 45}ms` }} onClick={onClick}>
    <div className="outfit-photos">{pieces.map((piece) => <Photo key={piece?.id} piece={piece} size="small" />)}</div>
    <div className="outfit-info">
      <span className="eyebrow">Conjunto {String(index + 1).padStart(2, "0")}</span>
      {/* Detalhado: cada peça em sua própria linha (rótulo + nome), em vez de
          espremer os três nomes numa única linha truncada — mais fácil de ler
          e melhor aproveitamento do espaço horizontal do cartão. */}
      {detailed
        ? <ul className="outfit-pieces">{pieces.map((piece, i) => <li key={labels[i]}><span>{labels[i]}</span><strong>{piece?.name ?? "—"}</strong></li>)}</ul>
        : <h3>{pieces.map((piece) => piece?.name).join(" · ")}</h3>}
      {!compact && <p>Última utilização: <strong>{formatDate(last?.date)}</strong></p>}
    </div>
    <div className="outfit-side"><Indicator values={recent} period={data.settings.outfitDays} />{!compact && <button className="outline-button" onClick={(e) => { e.stopPropagation(); onUse(); }}>Escolher dia</button>}</div>
    <button className="delete-small" onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label="Excluir conjunto"><Trash2 size={15} /></button>
  </article>;
}
type UseRecord = TrajeData["uses"][number];
