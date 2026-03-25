const fetch = require('node-fetch');
require('dotenv').config();

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function synthesizePapers(papers) {
  console.log('Running synthesis across papers...');

  const paperList = papers.slice(0, 20).map((p, i) =>
    `${i + 1}. "${p.title}" — ${p.journal} (${p.date})`
  ).join('\n');

  const prompt = `You are FORV, a research synthesis engine. You have scanned the following recently published papers across oncology, structural biology, immunology, metabolic biology and epigenetics:

${paperList}

Your job is to identify the 3 most significant findings and synthesize them into structured feed cards. For each card produce a JSON object with exactly these fields:

- headline: A single sharp sentence stating what was found. Not a question. Not vague. A finding.
- hook: Two sentences expanding the finding. Technical enough to be credible, clear enough for an engaged non-specialist.
- tags: Array of 2-3 tags from this list only: ["Oncology", "Genomics", "Immunology", "Structural Biology", "Epigenetics", "Metabolic Biology", "Virology", "High Impact", "Underexposed", "Cross-domain", "New"]
- accessible: Three paragraphs for a curious non-specialist. Use one analogy clearly marked with [ANALOGY]. No jargon without immediate plain-language explanation.
- researcher: Four sections each with a label and text: "Core Finding" (technical detail), "Cross-Domain Implications" (4 bullet points connecting to other fields), "Open Questions" (2 bullet points), "FORV Synthesis" (what this paper means when read against the others — the connection no single paper makes).
- sources: Array of up to 3 objects each with title, journal, date, url — taken directly from the paper list above.
- domain: Single primary domain from the tag list.
- impact: Either "High Impact" or "Underexposed"
- timestamp: How many hours ago published, as a string like "3h ago"

Return ONLY a valid JSON array of 3 card objects. No preamble. No explanation. No markdown. Raw JSON only.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();

  if (!data.content || !data.content[0]) {
    console.error('Anthropic API error:', data);
    return [];
  }

  const raw = data.content[0].text.trim();

  try {
    const cleaned = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/```\s*$/,'').trim();
    const cards = JSON.parse(cleaned);
    console.log(`Generated ${cards.length} synthesis cards`);
    return cards;
  } catch (err) {
    console.error('Failed to parse synthesis JSON:', err.message);
    console.error('Raw output:', raw.slice(0, 300));
    return [];
  }
}

async function generateCrossDomainLinks(cards) {
  if (!cards.length) return [];

  const summaries = cards.map((c, i) =>
    `${i + 1}. ${c.headline}`
  ).join('\n');

  const prompt = `You are FORV's cross-domain synthesis engine. Given these three research findings:

${summaries}

Identify 3 non-obvious connections between them that no single paper makes. Each connection should be a genuine intellectual insight — where two findings from different domains intersect to suggest something neither paper individually proposes.

Return ONLY a valid JSON array of 3 objects each with:
- label: Either "Emerging Link" or "Research Gap"  
- text: Two sentences max. Name the specific findings being connected. Be precise.

Raw JSON only. No preamble.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();
  const raw = data.content[0].text.trim();

  try {
    const cleaned = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/```\s*$/,'').trim();
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
}

module.exports = { synthesizePapers, generateCrossDomainLinks };