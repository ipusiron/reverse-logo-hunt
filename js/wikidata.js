// Wikidata helper: search companies/brands by term, get logo (P154), HQ (P159->P625), etc.
// Also fetch relations bundle for graph.

import { getCached, setCached } from './cache.js';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const SIX_HOURS = 1000 * 60 * 60 * 6;
const ONE_DAY = 1000 * 60 * 60 * 24;

export async function fetchCompanyBundle(term){
  console.log('[WIKIDATA] Searching for:', term);

  const normalized = term.trim().toLowerCase();
  const cacheKey = `bundle:${normalized}`;
  const cached = await getCached('wikidata', cacheKey).catch(()=>null);
  if(cached){
    console.log('[WIKIDATA] Cache hit for search:', term);
    return cached;
  }

  const q = `
SELECT ?item ?itemLabel ?logo ?hq ?coord WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "www.wikidata.org";
    wikibase:api "Search";
    mwapi:srsearch "${escapeS(term)}";
    mwapi:srlimit "50".
    ?item wikibase:apiOutputItem mwapi:title.
  }
  OPTIONAL { ?item wdt:P154 ?logo. }
  OPTIONAL { ?item wdt:P159 ?hq. ?hq wdt:P625 ?coord. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ja". }
} LIMIT 50`;
  const data = await runSparql(q);
  const items = data.results.bindings.map(b=>({
    qid: idFromUri(b.item.value),
    label: b.itemLabel?.value || '',
    logoFile: b.logo?.value?.replace('http://commons.wikimedia.org/wiki/Special:FilePath/','') || null,
    hq: b.hq?.value ? idFromUri(b.hq.value) : null,
    coord: b.coord?.value ? coordToObj(b.coord.value) : null
  }));

  console.log('[WIKIDATA] Found', items.length, 'results');
  console.log('[WIKIDATA] Results with logo:', items.filter(it=>it.logoFile).length);
  console.log('[WIKIDATA] Top 5 results:', items.slice(0,5).map(it => ({qid: it.qid, label: it.label, hasLogo: !!it.logoFile})));

  // Prioritize results with logos
  const withLogo = items.filter(it => it.logoFile);
  const withoutLogo = items.filter(it => !it.logoFile);
  const sorted = [...withLogo, ...withoutLogo];

  // offices simplification: use HQ only (offices optional future work)
  const payload = { items: sorted, offices: [] };
  try {
    await setCached('wikidata', cacheKey, payload, SIX_HOURS);
  } catch (err) {
    console.warn('[WIKIDATA] Cache store failed:', err);
  }
  return payload;
}

export async function companyRelationsBundle(qid){
  const cacheKey = `relations:${qid}`;
  const cached = await getCached('relations', cacheKey).catch(()=>null);
  if(cached){
    console.log('[WIKIDATA] Relations cache hit for', qid);
    return cached;
  }
  const q = `
SELECT ?relType ?target ?targetLabel WHERE {
  VALUES ?company { wd:${qid} }
  { ?company wdt:P355 ?target . BIND("subsidiary" AS ?relType) }
  UNION
  { ?company wdt:P749 ?target . BIND("parent" AS ?relType) }
  UNION
  { ?company wdt:P127 ?target . BIND("owned_by" AS ?relType) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ja". }
} LIMIT 200`;
  const data = await runSparql(q);
  const relations = data.results.bindings.map(b=>({
    type: b.relType.value,
    targetQ: idFromUri(b.target.value),
    targetLabel: b.targetLabel?.value || ''
  }));
  try {
    await setCached('relations', cacheKey, relations, ONE_DAY);
  } catch (err) {
    console.warn('[WIKIDATA] Cache store failed for relations:', err);
  }
  return relations;
}

// --- utilities ---
async function runSparql(query){
  const url = SPARQL_ENDPOINT + '?format=json&query=' + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'ReverseLogoHunt/1.0 (https://github.com/ipusiron/reverse-logo-hunt)'
    }
  });
  if(!res.ok) throw new Error(`SPARQL error: ${res.status} ${res.statusText}`);
  return res.json();
}
function idFromUri(u){ return u.split('/').pop(); }
function coordToObj(wkt){
  // "Point(lon lat)"
  const m = wkt.match(/Point\(([-0-9\.]+)\s+([-0-9\.]+)\)/);
  if(!m) return null;
  return { lat: parseFloat(m[2]), lng: parseFloat(m[1]) };
}
function escapeS(s){ return String(s).replace(/"/g,'\\"'); }
