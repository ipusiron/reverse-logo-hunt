// Wikimedia Commons の問い合わせの組み立てと結果の解析（計算部。DOM にも通信にも依存しない）
//
// サムネイルの配信元は thumb.wikimedia.org（2026-10-09 時点の API の応答）。古い応答の upload.wikimedia.org も受け付ける。
// 作者（Artist）は Commons では HTML で返るので、文字だけを取り出して表示する（HTML として画面に入れない）。

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
// Commons が用意している既定の幅の1つ。既定にない幅は大きい幅に丸められ、取得の制限も厳しい
export const THUMB_WIDTH = 330;
export const IMAGE_HOSTS = Object.freeze(["thumb.wikimedia.org", "upload.wikimedia.org"]);

export function normalizeFileName(name) {
  return String(name || "")
    .replace(/^File:/i, "")
    .replace(/_/g, " ")
    .trim();
}

export function imageInfoUrl(fileNames, { width = THUMB_WIDTH } = {}) {
  const names = [...new Set((fileNames || []).map(normalizeFileName).filter((n) => n && !n.includes("|")))];
  if (!names.length) throw new Error("ファイル名がありません");
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: String(width),
    iiextmetadatafilter: "Artist|LicenseShortName",
    titles: names.slice(0, 20).map((n) => `File:${n}`).join("|"),
  });
  return `${COMMONS_API}?${params.toString()}`;
}

function parseUrl(u) {
  try {
    return new URL(String(u || ""));
  } catch {
    return null;
  }
}

export function isAllowedImageUrl(u) {
  const url = parseUrl(u);
  return !!url && url.protocol === "https:" && IMAGE_HOSTS.includes(url.hostname);
}

export function isCommonsPageUrl(u) {
  const url = parseUrl(u);
  return !!url && url.protocol === "https:" && url.hostname === "commons.wikimedia.org" && url.pathname.startsWith("/wiki/");
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// HTML から文字だけを取り出す（タグを捨て、文字参照を戻し、空白をまとめる）
export function htmlToText(html, maxLength = 200) {
  const s = String(html || "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : " ";
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
    })
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...s].slice(0, maxLength).join("");
}

// imageinfo の応答を、ファイル名（空白区切り）ごとの { thumburl, descUrl, artist, license } にする
export function parseImageInfo(json) {
  const out = new Map();
  const q = json && json.query ? json.query : {};
  const pages = q.pages && typeof q.pages === "object" ? Object.values(q.pages) : [];
  for (const p of pages) {
    if (!p || typeof p.title !== "string" || p.missing !== undefined) continue;
    const ii = Array.isArray(p.imageinfo) ? p.imageinfo[0] : null;
    if (!ii) continue;
    const thumb = ii.thumburl || ii.url;
    if (!isAllowedImageUrl(thumb)) continue;
    const em = ii.extmetadata || {};
    out.set(normalizeFileName(p.title), {
      thumburl: thumb,
      descUrl: isCommonsPageUrl(ii.descriptionurl) ? ii.descriptionurl : "",
      artist: htmlToText(em.Artist && em.Artist.value) || "",
      license: htmlToText(em.LicenseShortName && em.LicenseShortName.value, 80) || "",
    });
  }
  return out;
}
