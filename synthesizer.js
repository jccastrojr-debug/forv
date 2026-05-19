const fetch = require('node-fetch');
if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// Use Haiku for cheap quick summaries, Sonnet for deep synthesis
const MODEL_QUICK = 'claude-haiku-4-5-20251001';
const MODEL_DEEP = 'claude-sonnet-4-20250514';

// Helper: call Anthropic API
async function callClaude(model, prompt, maxTokens) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();

  if (!data.content || !data.content[0]) {
    console.error('Anthropic API error:', data);
    return null;
  }

  return data.content[0].text.trim();
}

// Parse JSON safely from Claude's response
function parseJSON(raw) {
  try {
    const cleaned = raw.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('JSON parse error:', err.message);
    console.error('Raw:', raw.slice(0, 200));
    return null;
  }
}

// Synthesize a small batch of papers (3-5 at a time)
async function synthesizeBatch({ papers, paperList }) {
  paperList = paperList || papers.slice(0, 20).map((p, i) =>
    `${i + 1}. "${p.title}" — ${p.journal} (${p.date}) [URL: ${p.url || 'none'}] [SOURCE: ${p.source || 'unknown'}]${p.abstract ? '\nAbstract: ' + p.abstract.slice(0, 300) : ''}`
  ).join('\n\n');

  const prompt = `You are FORV, a research synthesis engine. You have scanned the following recently published papers across oncology, structural biology, immunology, metabolic biology and epigenetics:

${paperList}

Your job is to identify the 10 most significant findings and synthesize them into structured feed cards. For each paper that has a genuinely notable finding, produce a JSON object with exactly these fields:

- headline: A single sharp sentence stating what was found. Not a question. Not vague. A finding.
- hook: Two sentences expanding the finding. Technical enough to be credible, clear enough for an engaged non-specialist.
- tags: Array of 2-3 tags from this list only: ["Oncology", "Genomics", "Immunology", "Structural Biology", "Epigenetics", "Metabolic Biology", "Virology", "High Impact", "Underexposed", "Cross-domain", "New"]
- accessible: Three paragraphs for a curious non-specialist. Use one analogy clearly marked with [ANALOGY]. No jargon without immediate plain-language explanation.
- researcher: An object with four keys: "Core Finding" (string, technical detail), "Cross-Domain Implications" (array of 4 strings connecting to other fields), "Open Questions" (array of 2 strings), "FORV Synthesis" (string, what this paper means when read against others).
- sources: Array of up to 3 objects each with title, journal, date, url, source — copied exactly from the paper list above. Use the exact URL provided in [URL: ...] and the exact source name from [SOURCE: ...]. If URL is 'none', omit it.
- domain: Single primary domain from the tag list.
- impact: Either "High Impact" or "Underexposed"
- timestamp: How many hours ago published, as a string like "3h ago"
- paperId: The unique identifier for this paper (use the paper title as-is)

Return ONLY a valid JSON array of card objects. No preamble. No explanation. No markdown. Raw JSON only.`;

  const raw = await callClaude(MODEL_DEEP, prompt, 6000);
  if (!raw) return [];

  const cards = parseJSON(raw);
  return Array.isArray(cards) ? cards : [];
}

// Main synthesis function with caching
async function synthesizePapers(papers, existingCache = {}) {
  console.log('Running synthesis with caching...');

  // Filter out papers we already have cached
  const newPapers = papers.filter(p => !existingCache[p.title]);
  const cachedCards = Object.values(existingCache);

  console.log(`${papers.length} total papers, ${cachedCards.length} already cached, ${newPapers.length} new to synthesize`);

  if (newPapers.length === 0) {
    console.log('All papers already cached. No API calls needed.');
    return cachedCards;
  }

  // Process new papers in batches of 5
  const paperList = newPapers.slice(0, 20).map((p, i) =>
    `${i + 1}. "${p.title}" — ${p.journal} (${p.date}) [URL: ${p.url || 'none'}] [SOURCE: ${p.source || 'unknown'}]${p.abstract ? '\nAbstract: ' + p.abstract.slice(0, 300) : ''}`
  ).join('\n\n');

  const allCards = await synthesizeBatch({ papers: newPapers, paperList });
  console.log(`Generated ${allCards.length} synthesis cards`);
  return allCards;
}

async function generateCrossDomainLinks(cards) {
  if (!cards.length) return [];

  const summaries = cards.slice(0, 10).map((c, i) =>
    `${i + 1}. ${c.headline}`
  ).join('\n');

  const prompt = `You are FORV's cross-domain synthesis engine. Given these research findings:

${summaries}

Identify 5 non-obvious connections between them that no single paper makes. Each connection should be a genuine intellectual insight where two findings from different domains intersect to suggest something neither paper individually proposes.

Return ONLY a valid JSON array of 5 objects each with:
- label: Either "Emerging Link" or "Research Gap"
- text: Two sentences max. Name the specific findings being connected. Be precise.

Raw JSON only. No preamble.`;

  // Use Haiku for cross-domain links (cheaper, fast enough for this task)
  const raw = await callClaude(MODEL_QUICK, prompt, 800);
  if (!raw) return [];

  const links = parseJSON(raw);
  return Array.isArray(links) ? links : [];
}

module.exports = { synthesizePapers, generateCrossDomainLinks };