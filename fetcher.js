const fetch = require('node-fetch');
require('dotenv').config();

const PUBMED_KEY = process.env.PUBMED_API_KEY;

const SEARCH_TERMS = [
  'cancer immunotherapy',
  'oncology drug target',
  'tumour microenvironment',
  'AlphaFold cancer',
  'spontaneous tumour regression',
  'epigenetics cancer',
  'metabolic reprogramming cancer',
  'CRISPR cancer therapy',
  'liquid biopsy early detection',
  'CAR-T cell therapy'
];

async function searchPubMed(term, maxResults = 5) {
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=${maxResults}&sort=date&api_key=${PUBMED_KEY}&retmode=json`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();
  const ids = searchData.esearchresult.idlist;
  if (!ids.length) return [];

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&api_key=${PUBMED_KEY}&retmode=json`;
  const summaryRes = await fetch(summaryUrl);
  const summaryData = await summaryRes.json();

  return ids.map(id => {
    const paper = summaryData.result[id];
    return {
      id,
      title: paper.title,
      journal: paper.fulljournalname,
      date: paper.pubdate,
      authors: paper.authors?.slice(0, 3).map(a => a.name).join(', '),
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      source: 'PubMed'
    };
  });
}

async function fetchArXiv(term, maxResults = 3) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(term)}&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;
  const res = await fetch(url);
  const text = await res.text();
  const entries = [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries.map(match => {
    const entry = match[1];
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || '';
    const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || '';
    const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim() || '';
    return { title, url: id, date: published, journal: 'arXiv preprint', source: 'ArXiv' };
  });
}

async function fetchEuropePMC(term, maxResults = 4) {
  try {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(term)}&format=json&pageSize=${maxResults}&sort=date&resultType=core`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.resultList?.result) return [];
    return data.resultList.result.map(p => ({
      title: p.title,
      journal: p.journalTitle || 'Europe PMC',
      date: p.pubYear || '',
      authors: p.authorString || '',
      url: p.doi ? `https://doi.org/${p.doi}` : `https://europepmc.org/article/${p.source}/${p.id}`,
      source: 'Europe PMC'
    }));
  } catch (err) {
    console.error('Europe PMC error:', err.message);
    return [];
  }
}

async function fetchSemanticScholar(term, maxResults = 4) {
  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(term)}&limit=${maxResults}&fields=title,journal,year,authors,externalIds,openAccessPdf`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FORV-Research-Synthesis/1.0' }
    });
    const data = await res.json();
    if (!data.data) return [];
    return data.data.map(p => ({
      title: p.title,
      journal: p.journal?.name || 'Semantic Scholar',
      date: p.year?.toString() || '',
      authors: p.authors?.slice(0, 3).map(a => a.name).join(', ') || '',
      url: p.openAccessPdf?.url || `https://www.semanticscholar.org/paper/${p.paperId}`,
      source: 'Semantic Scholar'
    }));
  } catch (err) {
    console.error('Semantic Scholar error:', err.message);
    return [];
  }
}

async function fetchBioRxiv(term, maxResults = 3) {
  try {
    const url = `https://api.biorxiv.org/details/biorxiv/2024-01-01/2099-01-01/0/json`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.collection) return [];
    const filtered = data.collection
      .filter(p => p.title.toLowerCase().includes(term.toLowerCase()) ||
                   p.abstract.toLowerCase().includes(term.toLowerCase()))
      .slice(0, maxResults);
    return filtered.map(p => ({
      title: p.title,
      journal: 'bioRxiv preprint',
      date: p.date,
      authors: p.authors,
      url: `https://doi.org/${p.doi}`,
      source: 'bioRxiv'
    }));
  } catch (err) {
    console.error('bioRxiv error:', err.message);
    return [];
  }
}

async function fetchAllPapers() {
  console.log('Fetching papers from PubMed, ArXiv, Europe PMC, Semantic Scholar, bioRxiv...');
  const allPapers = [];

  for (const term of SEARCH_TERMS) {
    try {
      const [pubmed, arxiv, europepmc, semantic] = await Promise.all([
        searchPubMed(term, 4),
        fetchArXiv(term, 2),
        fetchEuropePMC(term, 3),
        fetchSemanticScholar(term, 3)
      ]);
      allPapers.push(...pubmed, ...arxiv, ...europepmc, ...semantic);
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`Error fetching term "${term}":`, err.message);
    }
  }

  // bioRxiv searched separately for key terms
  for (const term of ['cancer immunotherapy', 'CAR-T', 'AlphaFold']) {
    try {
      const biorxiv = await fetchBioRxiv(term, 3);
      allPapers.push(...biorxiv);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`bioRxiv error for "${term}":`, err.message);
    }
  }

  const seen = new Set();
  const unique = allPapers.filter(p => {
    if (!p.title || seen.has(p.title)) return false;
    seen.add(p.title);
    return true;
  });

  console.log(`Fetched ${unique.length} unique papers across all sources`);
  return unique;
}

module.exports = { fetchAllPapers };
