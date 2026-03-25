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
  'metabolic reprogramming cancer'
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
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
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
    return { title, url: id, date: published, journal: 'arXiv preprint' };
  });
}

async function fetchAllPapers() {
  console.log('Fetching papers from PubMed and ArXiv...');
  const allPapers = [];

  for (const term of SEARCH_TERMS) {
    try {
      const pubmedResults = await searchPubMed(term, 4);
      const arxivResults = await fetchArXiv(term, 2);
      allPapers.push(...pubmedResults, ...arxivResults);
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      console.error(`Error fetching term "${term}":`, err.message);
    }
  }

  const seen = new Set();
  const unique = allPapers.filter(p => {
    if (seen.has(p.title)) return false;
    seen.add(p.title);
    return true;
  });

  console.log(`Fetched ${unique.length} unique papers`);
  return unique;
}

module.exports = { fetchAllPapers };