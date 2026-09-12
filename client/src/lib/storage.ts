/* Camada de armazenamento do Traje.
 *
 * Histórico: primeiro tudo (incluindo fotos em Base64) ficava numa única chave
 * do localStorage — estourava a quota com poucas fotos. Depois passamos para
 * IndexedDB (dados estruturados + fotos como Blob em stores separados), mas
 * mesmo assim as fotos continuaram sendo perdidas ao fechar e reabrir o app.
 *
 * Agora as fotos e os dados estruturados são gravados como ARQUIVOS DE VERDADE
 * no armazenamento nativo do Android via Capacitor Filesystem (Directory.Data —
 * o diretório de dados privados do app, equivalente a getFilesDir() no Android).
 * Isso não depende de nenhuma peculiaridade de armazenamento do WebView
 * (localStorage/IndexedDB) e é o método documentado e mais confiável para
 * persistir arquivos binários em apps Capacitor.
 */
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

const DATA_FILE = "traje-data.json";
// Antes as fotos ficavam em uma SUBPASTA ("traje-photos/<id>.jpg"), criada com
// mkdir antes de cada escrita. Se essa subpasta não existisse de verdade na
// hora de gravar (por qualquer motivo — e essa é a diferença estrutural em
// relação ao traje-data.json, que é um arquivo direto e sempre persistia certo),
// a escrita da foto falhava e ela nunca chegava a ser salva de verdade, mesmo
// aparecendo normalmente na tela durante a sessão atual. Agora cada foto é um
// arquivo direto em Directory.Data, sem subpasta e sem depender de mkdir —
// exatamente o mesmo padrão comprovadamente confiável do arquivo de dados.
const PHOTO_PREFIX = "traje-photo-";
const PHOTO_SUFFIX = ".b64";

function photoPath(pieceId: string) { return `${PHOTO_PREFIX}${pieceId}${PHOTO_SUFFIX}`; }

export async function readStructuredFile<T>(): Promise<T | undefined> {
  try {
    const result = await Filesystem.readFile({ path: DATA_FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
    return JSON.parse(result.data as string) as T;
  } catch {
    return undefined; // arquivo ainda não existe (primeira vez, ou nada cadastrado)
  }
}

export async function writeStructuredFile(value: unknown): Promise<void> {
  await Filesystem.writeFile({ path: DATA_FILE, directory: Directory.Data, data: JSON.stringify(value), encoding: Encoding.UTF8 });
}

// As fotos usavam o modo "binário" do plugin (sem "encoding": o Base64 era
// decodificado para bytes na escrita e recodificado na leitura). Essa é a
// ÚNICA diferença estrutural em relação ao traje-data.json (que usa modo texto
// UTF-8 e sempre persistiu certo) — e "sem encoding" também tem comportamento
// documentado como inconsistente entre plataformas (ex.: devolve Blob em vez
// de string em alguns ambientes). Em vez de continuar caçando essa divergência,
// eliminamos o modo binário por completo: a foto é salva como o texto Base64
// puro (caracteres só de A-Z, a-z, 0-9, +, /, = — 100% seguros em UTF-8), pelo
// EXATO mesmo caminho, comprovadamente confiável, do arquivo de dados.
const LEGACY_PHOTO_SUFFIX = ".jpg";
function legacyPhotoPath(pieceId: string) { return `${PHOTO_PREFIX}${pieceId}${LEGACY_PHOTO_SUFFIX}`; }

export async function readPhotoFile(pieceId: string): Promise<string | undefined> {
  try {
    const result = await Filesystem.readFile({ path: photoPath(pieceId), directory: Directory.Data, encoding: Encoding.UTF8 });
    return `data:image/jpeg;base64,${result.data}`;
  } catch {
    // Fallback para o formato binário usado por uma versão anterior deste app —
    // não custa nada tentar, e evita perder uma foto que por acaso tenha
    // persistido certo daquela forma.
    try {
      const legacy = await Filesystem.readFile({ path: legacyPhotoPath(pieceId), directory: Directory.Data });
      const raw = legacy.data as unknown;
      if (typeof raw === "string") return `data:image/jpeg;base64,${raw}`;
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(raw as Blob);
      });
    } catch {
      return undefined; // esta peça não tem foto salva
    }
  }
}

export async function writePhotoFile(pieceId: string, dataUrl: string): Promise<void> {
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  await Filesystem.writeFile({ path: photoPath(pieceId), directory: Directory.Data, data: base64, encoding: Encoding.UTF8 });
}

export async function deletePhotoFile(pieceId: string): Promise<void> {
  try { await Filesystem.deleteFile({ path: photoPath(pieceId), directory: Directory.Data }); } catch { /* já não existia */ }
  try { await Filesystem.deleteFile({ path: legacyPhotoPath(pieceId), directory: Directory.Data }); } catch { /* já não existia */ }
}

/* --- A seguir: só o necessário para migrar quem já tinha dados no formato
   IndexedDB da versão anterior deste app (dados estruturados + fotos como Blob
   em dois object stores). Nada disso é usado para leitura/escrita normal. --- */
const DB_NAME = "traje-db";
const DB_VERSION = 1;
const KV_STORE = "kv";
const PHOTOS_STORE = "photos";

function openLegacyDB(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
        if (!db.objectStoreNames.contains(PHOTOS_STORE)) db.createObjectStore(PHOTOS_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
function legacyIdbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
export async function readLegacyIndexedDB<T>(): Promise<{ data: T; getPhoto: (id: string) => Promise<string | undefined> } | undefined> {
  const db = await openLegacyDB();
  if (!db) return undefined;
  const data = await legacyIdbGet<T>(db, KV_STORE, "traje-data");
  if (!data) return undefined;
  return {
    data,
    getPhoto: async (id: string) => {
      const blob = await legacyIdbGet<Blob>(db, PHOTOS_STORE, id);
      if (!blob) return undefined;
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    },
  };
}
