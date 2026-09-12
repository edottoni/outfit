/* Atelier Editorial: domínio local do Traje. Este arquivo concentra o vocabulário do arquivo, prazos e formatos de intercâmbio. */
import JSZip from "jszip";
import { deletePhotoFile, readLegacyIndexedDB, readPhotoFile, readStructuredFile, writePhotoFile, writeStructuredFile } from "./storage";

export type PieceType = "terno" | "gravata" | "camisa";
export type ViewMode = "detalhado" | "compacto" | "grade";

// Auxiliares só para o formato de troca (ZIP de backup): converter entre Blob (o
// que o JSZip dá/recebe) e DataURL (o que o resto do app usa em memória).
async function dataURLToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}
// Redimensiona/comprime uma foto (vinda de um ZIP importado, por exemplo) antes de
// guardá-la. Fotos de câmeras/celulares reais podem ter vários MB em tamanho
// original — grandes demais para uma única chamada de plugin nativo (Capacitor
// Filesystem) sem risco de o arquivo ficar truncado/corrompido de forma
// silenciosa. A câmera do próprio app já comprime a foto capturada; agora a
// importação faz o mesmo para qualquer foto vinda de fora.
async function compressPhotoBlob(blob: Blob, maxSize = 1280, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas indisponível"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Não foi possível processar a foto importada"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface Piece {
  id: string;
  type: PieceType;
  name: string;
  code: string;
  photo?: string;
  createdAt: string;
}

export interface Outfit {
  id: string;
  suitId: string;
  tieId: string;
  shirtId: string;
  createdAt: string;
}

export interface UseRecord {
  id: string;
  outfitId: string;
  date: string;
}

export interface Settings {
  outfitDays: number;
  suitDays: number;
  tieDays: number;
  shirtDays: number;
  viewModes: Record<PieceType | "conjuntos", ViewMode>;
  gridColumns: Record<PieceType | "conjuntos", number>;
  themeMode: "system" | "claro" | "escuro";
}

export interface TrajeData {
  pieces: Piece[];
  outfits: Outfit[];
  uses: UseRecord[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  outfitDays: 30,
  suitDays: 21,
  tieDays: 14,
  shirtDays: 7,
  viewModes: {
    terno: "detalhado",
    gravata: "detalhado",
    camisa: "detalhado",
    conjuntos: "detalhado",
  },
  gridColumns: {
    terno: 3,
    gravata: 3,
    camisa: 3,
    conjuntos: 3,
  },
  themeMode: "system",
};

export const EMPTY_DATA: TrajeData = { pieces: [], outfits: [], uses: [], settings: DEFAULT_SETTINGS };
// Chave antiga: só é lida uma vez, para migrar quem já tinha dados salvos no
// formato anterior (tudo, incluindo fotos em Base64, numa única string).
export const STORAGE_KEY = "traje-local-v1";
const MIGRATION_FLAG_KEY = "traje-migrated-v1";
type StoredPiece = Omit<Piece, "photo">;
type StoredData = { pieces: StoredPiece[]; outfits: Outfit[]; uses: UseRecord[]; settings: Partial<Settings> };
// Cache em memória: evita reconverter/regravar a foto de uma peça no IndexedDB a
// cada save se ela não mudou desde o último salvamento (savePiece salva o objeto
// TrajeData inteiro a cada alteração, não só a peça alterada).
const persistedPhotoCache = new Map<string, string | undefined>();

function mergeSettings(partial?: Partial<Settings>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...partial, viewModes: { ...DEFAULT_SETTINGS.viewModes, ...partial?.viewModes }, gridColumns: { ...DEFAULT_SETTINGS.gridColumns, ...partial?.gridColumns } };
  // A opção "Peças" foi removida do app; quem tinha essa preferência salva de uma
  // versão anterior volta para o modo Detalhado, em vez de manter um valor inválido.
  for (const key of Object.keys(merged.viewModes) as (PieceType | "conjuntos")[]) if ((merged.viewModes[key] as string) === "pecas") merged.viewModes[key] = "detalhado";
  return merged;
}

// Migra o formato antigo (localStorage, uma chave só, fotos em Base64 dentro do
// JSON) para o arquivo de dados atual. Só remove a chave antiga depois de
// confirmar que a gravação no novo formato realmente terminou.
async function migrateFromLocalStorage(onProgress?: (done: number, total: number) => void): Promise<StoredData | undefined> {
  try {
    if (localStorage.getItem(MIGRATION_FLAG_KEY)) return undefined;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { localStorage.setItem(MIGRATION_FLAG_KEY, "1"); return undefined; }
    const parsed = JSON.parse(raw) as Partial<TrajeData>;
    const pieces = parsed.pieces ?? [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (piece.photo?.startsWith("data:image/")) { try { await writePhotoFile(piece.id, piece.photo); } catch { /* uma foto corrompida não deve travar a migração das demais peças */ } }
      onProgress?.(i + 1, pieces.length);
    }
    const lite: StoredData = { pieces: pieces.map(({ photo: _photo, ...rest }) => rest), outfits: parsed.outfits ?? [], uses: parsed.uses ?? [], settings: parsed.settings ?? {} };
    await writeStructuredFile(lite);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(MIGRATION_FLAG_KEY, "1");
    return lite;
  } catch (error) {
    console.error("Falha ao migrar dados antigos do Traje (localStorage mantido intacto):", error);
    return undefined;
  }
}

// Migra o formato intermediário (IndexedDB, usado numa versão anterior deste
// app) para o arquivo de dados atual, caso exista.
async function migrateFromLegacyIndexedDB(onProgress?: (done: number, total: number) => void): Promise<StoredData | undefined> {
  try {
    const legacy = await readLegacyIndexedDB<StoredData>();
    if (!legacy) return undefined;
    for (let i = 0; i < legacy.data.pieces.length; i++) {
      const piece = legacy.data.pieces[i];
      try { const photo = await legacy.getPhoto(piece.id); if (photo) await writePhotoFile(piece.id, photo); } catch { /* uma foto corrompida não deve travar a migração das demais peças */ }
      onProgress?.(i + 1, legacy.data.pieces.length);
    }
    await writeStructuredFile(legacy.data);
    return legacy.data;
  } catch (error) {
    console.error("Falha ao migrar dados do IndexedDB (versão anterior):", error);
    return undefined;
  }
}

export async function loadData(onProgress?: (done: number, total: number) => void): Promise<TrajeData> {
  try {
    const structured = (await readStructuredFile<StoredData>()) ?? (await migrateFromLegacyIndexedDB(onProgress)) ?? (await migrateFromLocalStorage(onProgress));
    if (!structured) return EMPTY_DATA;
    const pieces: Piece[] = [];
    for (let i = 0; i < structured.pieces.length; i++) {
      const base = structured.pieces[i];
      let photo: string | undefined;
      try { photo = await readPhotoFile(base.id); } catch { photo = undefined; }
      pieces.push({ ...base, photo });
      persistedPhotoCache.set(base.id, photo);
      onProgress?.(i + 1, structured.pieces.length);
    }
    return { pieces, outfits: structured.outfits ?? [], uses: structured.uses ?? [], settings: mergeSettings(structured.settings) };
  } catch (error) {
    console.error("Falha ao carregar dados do Traje:", error);
    return EMPTY_DATA;
  }
}

export async function saveData(data: TrajeData) {
  const failed: string[] = [];
  for (const piece of data.pieces) {
    if (persistedPhotoCache.get(piece.id) === piece.photo) continue; // sem mudança nesta foto: evita reprocessar
    try {
      if (piece.photo?.startsWith("data:image/")) {
        // Grava e, na sequência, lê de volta para CONFIRMAR que a foto realmente
        // chegou no disco (não só que a chamada não jogou um erro). Se a
        // verificação falhar, tenta mais uma vez antes de desistir — é essa
        // confirmação que faltava e permitia que uma escrita falha parecesse
        // ter dado certo, só aparecendo o problema depois de reabrir o app.
        await writePhotoFile(piece.id, piece.photo);
        let confirmed = await readPhotoFile(piece.id);
        if (!confirmed) { await writePhotoFile(piece.id, piece.photo); confirmed = await readPhotoFile(piece.id); }
        if (!confirmed) throw new Error("A foto não pôde ser confirmada após salvar.");
      } else {
        await deletePhotoFile(piece.id);
      }
      persistedPhotoCache.set(piece.id, piece.photo);
    } catch (error) {
      // Antes, uma falha aqui só ia para o console (invisível sem depurar o
      // Android) e o app seguia como se tivesse dado tudo certo — por isso a
      // perda de foto nunca aparecia como erro. Agora ela é reportada de
      // verdade para quem chamou saveData (ver o "throw" no fim da função).
      console.error(`Não foi possível salvar a foto da peça ${piece.code}:`, error);
      failed.push(piece.code);
    }
  }
  const ids = new Set(data.pieces.map((p) => p.id));
  for (const id of persistedPhotoCache.keys()) if (!ids.has(id)) { persistedPhotoCache.delete(id); deletePhotoFile(id).catch(() => {}); }
  const lite: StoredData = { pieces: data.pieces.map(({ photo: _photo, ...rest }) => rest), outfits: data.outfits, uses: data.uses, settings: data.settings };
  await writeStructuredFile(lite);
  // Lançado só depois de gravar os dados estruturados (não queremos perder o
  // resto do salvamento por causa de uma foto) — mas precisa mesmo ser
  // lançado, para que quem chamou saveData saiba que algo falhou e possa
  // avisar o usuário, em vez do erro ficar só no console.
  if (failed.length) throw new Error(`Não foi possível confirmar a foto de: ${failed.join(", ")}.`);
}

export function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function todayISO() { return new Date().toISOString().slice(0, 10); }
export function formatDate(value?: string) {
  if (!value) return "Ainda não usado";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}
export function daysSince(value: string) {
  const start = new Date(`${value}T12:00:00`).getTime();
  return Math.max(0, Math.floor((Date.now() - start) / 86400000));
}
export function colorForUse(value: string, period: number) {
  const ratio = daysSince(value) / Math.max(period, 1);
  if (ratio > 1) return "empty";
  if (ratio > 0.72) return "green";
  if (ratio > 0.42) return "amber";
  return "red";
}
export function recentUses(data: TrajeData, outfitId: string, period: number) {
  return data.uses.filter((use) => use.outfitId === outfitId && daysSince(use.date) <= period).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
}
export function pieceUses(data: TrajeData, pieceId: string, period: number) {
  const outfitIds = data.outfits.filter((o) => o.suitId === pieceId || o.tieId === pieceId || o.shirtId === pieceId).map((o) => o.id);
  return data.uses.filter((u) => outfitIds.includes(u.outfitId) && daysSince(u.date) <= period).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
}
// Quantos conjuntos existentes incluem esta peça — usado no modo Detalhado/Compacto
// como "número de possíveis combinações".
export function combosForPiece(data: TrajeData, pieceId: string) {
  return data.outfits.filter((o) => o.suitId === pieceId || o.tieId === pieceId || o.shirtId === pieceId).length;
}
// Para um terno: com quantas gravatas distintas ele já foi combinado (e vice-versa
// para gravata/camisa, sempre relativo ao terno). Usado no modo Detalhado como
// "informações das gravatas associadas" (ou equivalente para as outras peças).
export function pairedCount(data: TrajeData, piece: Piece): { label: PieceType; count: number } {
  if (piece.type === "terno") return { label: "gravata", count: new Set(data.outfits.filter((o) => o.suitId === piece.id).map((o) => o.tieId)).size };
  if (piece.type === "gravata") return { label: "terno", count: new Set(data.outfits.filter((o) => o.tieId === piece.id).map((o) => o.suitId)).size };
  return { label: "terno", count: new Set(data.outfits.filter((o) => o.shirtId === piece.id).map((o) => o.suitId)).size };
}
export function pieceLabel(type: PieceType) { return type === "terno" ? "Ternos" : type === "gravata" ? "Gravatas" : "Camisas"; }
export function pieceSingular(type: PieceType) { return type === "terno" ? "terno" : type === "gravata" ? "gravata" : "camisa"; }

export function toLegenda(data: TrajeData) {
  return ["[TERNOS]", ...data.pieces.filter((p) => p.type === "terno").map((p) => `${p.code}|${p.name}`), "", "[GRAVATAS]", ...data.pieces.filter((p) => p.type === "gravata").map((p) => `${p.code}|${p.name}`), "", "[CAMISAS]", ...data.pieces.filter((p) => p.type === "camisa").map((p) => `${p.code}|${p.name}`)].join("\n");
}
export function toCombinacoes(data: TrajeData) {
  const byId = new Map(data.pieces.map((p) => [p.id, p]));
  return ["[COMBINACOES]", ...data.outfits.map((o) => `${byId.get(o.suitId)?.code ?? ""}|${byId.get(o.tieId)?.code ?? ""}|${byId.get(o.shirtId)?.code ?? ""}`)].join("\n");
}
export function toCalendario(data: TrajeData) {
  const byId = new Map(data.pieces.map((p) => [p.id, p]));
  return ["[CALENDARIO]", ...data.uses.map((u) => { const o = data.outfits.find((outfit) => outfit.id === u.outfitId); return o ? `${u.date}|${byId.get(o.suitId)?.code ?? ""}|${byId.get(o.tieId)?.code ?? ""}|${byId.get(o.shirtId)?.code ?? ""}` : ""; }).filter(Boolean)].join("\n");
}

export function buildGenerationPrompt(data: TrajeData) {
  return `${toLegenda(data)}\n\n${toCombinacoes(data)}\n\nPROMPT PARA GERAÇÃO DE CONJUNTOS\n\nVocê é um consultor de estilo masculino. Crie novas combinações usando exclusivamente as peças listadas acima. Não repita nenhum conjunto já existente. Considere cores, formalidade, contraste, ocasião e coerência entre terno, gravata e camisa. Responda SOMENTE com um arquivo de texto neste formato exato:\n\n[COMBINACOES]\nTERNO|GRAVATA|CAMISA\n\nInclua uma linha para cada novo conjunto. Use somente os códigos existentes nas legendas, não crie códigos novos, não inclua explicações, títulos adicionais, marcadores ou linhas vazias. Se não for possível criar uma combinação nova, retorne apenas [COMBINACOES].`;
}

export async function backupZip(data: TrajeData, onProgress?: (done: number, total: number) => void) {
  const zip = new JSZip();
  zip.file("legendas.txt", toLegenda(data));
  zip.file("combinações.txt", toCombinacoes(data));
  zip.file("calendário.txt", toCalendario(data));
  zip.file("configurações.json", JSON.stringify(data.settings, null, 2));
  const photos = zip.folder("fotos");
  const withPhoto = data.pieces.filter((p) => p.photo);
  for (let i = 0; i < withPhoto.length; i++) {
    const piece = withPhoto[i];
    try { photos?.file(`${piece.type}/${piece.code}.jpg`, await dataURLToBlob(piece.photo!)); } catch { /* uma foto corrompida não deve interromper a exportação inteira */ }
    onProgress?.(i + 1, withPhoto.length);
  }
  return zip.generateAsync({ type: "blob" });
}

export async function parseBackup(file: File, current: TrajeData, onProgress?: (done: number, total: number) => void): Promise<TrajeData> {
  const zip = await JSZip.loadAsync(file);
  const legendas = await zip.file("legendas.txt")?.async("string");
  const combinacoes = await zip.file("combinações.txt")?.async("string") ?? await zip.file("combinacoes.txt")?.async("string");
  const calendario = await zip.file("calendário.txt")?.async("string") ?? await zip.file("calendario.txt")?.async("string");
  if (!legendas) throw new Error("O ZIP não contém legendas.txt.");
  const pieces: Piece[] = [...current.pieces];
  const codeMap = new Map<string, string>();
  let type: PieceType | null = null;
  const lines = legendas.split(/\r?\n/);
  function headerType(line: string): PieceType | null { return line === "[TERNOS]" ? "terno" : line === "[GRAVATAS]" ? "gravata" : line === "[CAMISAS]" ? "camisa" : null; }
  // Pré-varredura só para saber o total de peças a processar (para o indicador de progresso).
  let totalPieceLines = 0;
  { let scanType: PieceType | null = null; for (const line of lines) { const header = headerType(line); if (header) scanType = header; else if (scanType && line.includes("|")) totalPieceLines += 1; } }
  let processed = 0;
  for (const line of lines) {
    const header = headerType(line);
    if (header) { type = header; continue; }
    if (type && line.includes("|")) {
      const [rawCode, name] = line.split("|");
      const existing = pieces.find((p) => p.type === type && p.code === rawCode);
      let code = rawCode;
      let suffix = 1;
      while (pieces.some((p) => p.type === type && p.code === code)) code = `${rawCode}-${suffix++}`;
      let created = existing;
      if (!created) {
        // Restaura a foto correspondente da pasta fotos/ do ZIP, se existir — antes essa
        // etapa não existia e a importação sempre perdia as fotos das peças novas.
        let photo: string | undefined;
        const photoFile = zip.file(`fotos/${type}/${rawCode}.jpg`);
        if (photoFile) { try { photo = await compressPhotoBlob(await photoFile.async("blob")); } catch { /* segue sem foto se o arquivo estiver corrompido */ } }
        created = { id: uid("piece"), type, name, code, photo, createdAt: new Date().toISOString() };
      }
      pieces.push(created);
      codeMap.set(`${type}:${rawCode}`, created.id);
      processed += 1;
      onProgress?.(processed, totalPieceLines);
    }
  }
  const outfits = [...current.outfits];
  if (combinacoes) for (const line of combinacoes.split(/\r?\n/)) {
    if (!line.includes("|")) continue;
    const [s, t, c] = line.split("|");
    const ids = [codeMap.get(`terno:${s}`) ?? pieces.find((p) => p.type === "terno" && p.code === s)?.id, codeMap.get(`gravata:${t}`) ?? pieces.find((p) => p.type === "gravata" && p.code === t)?.id, codeMap.get(`camisa:${c}`) ?? pieces.find((p) => p.type === "camisa" && p.code === c)?.id];
    if (ids.every(Boolean) && !outfits.some((o) => o.suitId === ids[0] && o.tieId === ids[1] && o.shirtId === ids[2])) outfits.push({ id: uid("outfit"), suitId: ids[0]!, tieId: ids[1]!, shirtId: ids[2]!, createdAt: new Date().toISOString() });
  }
  const uses = [...current.uses];
  if (calendario) for (const line of calendario.split(/\r?\n/)) {
    if (!line.includes("|")) continue;
    const [date, s, t, c] = line.split("|");
    const o = outfits.find((item) => { const ids = [item.suitId, item.tieId, item.shirtId].map((id) => pieces.find((p) => p.id === id)?.code); return ids.join("|") === `${s}|${t}|${c}`; });
    if (o && !uses.some((u) => u.outfitId === o.id && u.date === date)) uses.push({ id: uid("use"), outfitId: o.id, date });
  }
  return { ...current, pieces, outfits, uses };
}
