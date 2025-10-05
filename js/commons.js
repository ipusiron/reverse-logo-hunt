// Wikimedia Commons: fetch thumbnail & credit meta (author/license/link)

import { getCached, setCached } from './cache.js';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const ONE_DAY = 1000 * 60 * 60 * 24;

export async function fetchCommonsThumbMeta(fileName){
  if(!fileName){
    console.warn('[COMMONS] No filename provided');
    return null;
  }

  // Decode if already encoded, then re-encode properly
  const decodedFileName = decodeURIComponent(fileName);
  const cacheKey = decodedFileName.toLowerCase();
  const cached = await getCached('commons', cacheKey).catch(()=>null);
  if(cached){
    console.log('[COMMONS] Cache hit for:', decodedFileName);
    return cached;
  }
  console.log('[COMMONS] Fetching:', decodedFileName);
  const url = `${COMMONS_API}?origin=*&action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=512&format=json&titles=${encodeURIComponent('File:'+decodedFileName)}`;

  const res = await fetch(url);
  if(!res.ok){
    console.error('[COMMONS] Fetch failed:', res.status, res.statusText);
    throw new Error('Commons API error');
  }

  const data = await res.json();
  console.log('[COMMONS] API response:', data);

  const pages = data.query.pages;
  const page = pages[Object.keys(pages)[0]];

  if(!page || page.missing !== undefined){
    console.warn('[COMMONS] Page missing for file:', fileName);
    return null;
  }

  const ii = page?.imageinfo?.[0];
  if(!ii){
    console.warn('[COMMONS] No imageinfo for file:', fileName);
    return null;
  }

  console.log('[COMMONS] Thumbnail URL:', ii.thumburl || ii.url);

  const em = ii.extmetadata || {};
  const creditHtml = creditLine({
    artist: em.Artist?.value,
    license: em.LicenseShortName?.value,
    descUrl: ii.descriptionurl
  });

  const result = {
    thumburl: ii.thumburl || ii.url, // Fallback to full URL if no thumbnail
    url: ii.url,
    creditHtml,
    qid: page.title
  };
  try {
    await setCached('commons', cacheKey, result, ONE_DAY);
  } catch (err) {
    console.warn('[COMMONS] Cache store failed:', err);
  }
  return result;
}

function creditLine({artist, license, descUrl}){
  const a = artist || 'Unknown';
  const l = license || 'License';
  const u = descUrl ? `<a href="${descUrl}" target="_blank" rel="noopener noreferrer">Commons</a>` : 'Commons';
  return `作者: ${a} / ライセンス: ${l} / 出典: ${u}`;
}
