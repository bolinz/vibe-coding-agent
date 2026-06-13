interface TextChunk { type: 'text'; content: string }
interface CardChunk { type: 'card'; card: Record<string, unknown> }
interface RichChunk { type: 'rich'; format: string; content: string; language?: string }
interface ErrorChunk { type: 'parse_error'; error: string; rawText: string }

type ParsedChunk = TextChunk | CardChunk | RichChunk | ErrorChunk;

function tryParseJSON(text: string): Record<string, unknown> | null {
  try { const r = JSON.parse(text); if (typeof r === 'object' && r !== null) return r; return null; }
  catch { return null; }
}

function parseTableRows(text: string): { headers: string[]; rows: string[][] } | null {
  const lines = text.trim().split('\n').filter(l => l.includes('|'));
  if (lines.length < 2) return null;

  const parseLine = (line: string) =>
    line.split('|').map(c => c.trim()).filter(c => c.length > 0);

  const headers = parseLine(lines[0]);
  if (headers.length === 0) return null;

  const rows = lines.slice(2).map(parseLine).filter(r => r.length > 0);
  return { headers, rows };
}

export function parseStreamText(input: string): ParsedChunk[] {
  const result: ParsedChunk[] = [];
  let remaining = input;

  while (remaining.length > 0) {
    // Try to match [CARD]...[/CARD]
    const cardMatch = remaining.match(/\[CARD\]\s*([\s\S]*?)\s*\[\/CARD\]/);
    if (cardMatch && cardMatch.index !== undefined) {
      if (cardMatch.index > 0) result.push({ type: 'text', content: remaining.slice(0, cardMatch.index) });
      const parsed = tryParseJSON(cardMatch[1]);
      if (parsed) {
        result.push({ type: 'card', card: parsed });
      } else {
        result.push({ type: 'text', content: cardMatch[0] });
      }
      remaining = remaining.slice(cardMatch.index + cardMatch[0].length);
      continue;
    }

    // Try to match [CODE lang=xxx]...[/CODE]
    const codeMatch = remaining.match(/\[CODE\s*(?:lang=(\w+))?\]([\s\S]*?)\[\/CODE\]/);
    if (codeMatch && codeMatch.index !== undefined) {
      if (codeMatch.index > 0) result.push({ type: 'text', content: remaining.slice(0, codeMatch.index) });
      result.push({ type: 'rich', format: 'code', content: codeMatch[2], language: codeMatch[1] || undefined });
      remaining = remaining.slice(codeMatch.index + codeMatch[0].length);
      continue;
    }

    // Try to match [TABLE]...[/TABLE]
    const tableMatch = remaining.match(/\[TABLE\]\s*([\s\S]*?)\s*\[\/TABLE\]/);
    if (tableMatch && tableMatch.index !== undefined) {
      if (tableMatch.index > 0) result.push({ type: 'text', content: remaining.slice(0, tableMatch.index) });
      const table = parseTableRows(tableMatch[1]);
      if (table) {
        result.push({ type: 'rich', format: 'table', content: JSON.stringify(table) });
      } else {
        result.push({ type: 'text', content: tableMatch[0] });
      }
      remaining = remaining.slice(tableMatch.index + tableMatch[0].length);
      continue;
    }

    // Try to match ```lang\n...\n``` (Markdown code block)
    const mdCodeMatch = remaining.match(/```(\w*)\n([\s\S]*?)```/);
    if (mdCodeMatch && mdCodeMatch.index !== undefined) {
      if (mdCodeMatch.index > 0) result.push({ type: 'text', content: remaining.slice(0, mdCodeMatch.index) });
      result.push({ type: 'rich', format: 'code', content: mdCodeMatch[2], language: mdCodeMatch[1] || undefined });
      remaining = remaining.slice(mdCodeMatch.index + mdCodeMatch[0].length);
      continue;
    }

    // No more markers — remaining is all text
    result.push({ type: 'text', content: remaining });
    break;
  }

  return result;
}
