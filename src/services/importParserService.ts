const SPLIT_REGEX = /([。！？!?]+|\n+)/g;

export function parsePlainText(content: string): string[] {
  if (!content) return [];
  
  // 1. Strip ASS/SSA sub formatting annotations (ex: {\an8}, {\pos(192,240)})
  let cleanContent = content.replace(/\{[^}]*\}/g, '');
  
  // 2. Strip HTML tags (ex: <i>, <font color="red">, etc.)
  cleanContent = cleanContent.replace(/<\/?[^>]+(>|$)/g, '');

  // 3. Remove sound-effect-only blocks, and leading speaker names.
  // Do NOT remove all parentheses blindly. Remove if whole line is in parens, or if it's at the start (speaker).
  cleanContent = cleanContent.split('\n').map(l => {
     let trimmed = l.trim();
     if (/^[（\(\[【].*?[）\)\]】]$/.test(trimmed)) return ''; // whole line is in parens
     trimmed = trimmed.replace(/^[（\(\[【].*?[）\)\]】]\s*/, ''); // paren at start (speaker)
     trimmed = trimmed.replace(/^[^:：]+[:：]\s*/, ''); // speaker with colon
     return trimmed;
  }).filter(Boolean).join('\n');
  
  const rawParts = cleanContent.replace(/\r\n/g, '\n').split(SPLIT_REGEX);
  
  const sentences: string[] = [];
  let current = '';
  
  for (const part of rawParts) {
     if (part.match(SPLIT_REGEX)) {
       current += part;
       if (current.trim()) {
         sentences.push(current.trim());
         current = '';
       }
     } else {
       current += part;
     }
  }
  
  if (current.trim()) {
    sentences.push(current.trim());
  }
  
  return sentences.map(s => s.trim()).filter(Boolean);
}

export function parseSrt(content: string): string[] {
  if (!content) return [];
  
  // Robustly split blocks matching any whitespace on empty lines
  const blocks = content.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const lines: string[] = [];
  
  for (const block of blocks) {
    if (!block.trim()) continue;
    
    // An SRT block is typically:
    // 1
    // 00:00:01,000 --> 00:00:04,000
    // text line 1
    // text line 2
    
    const blockLines = block.split('\n');
    let textLines: string[] = [];
    
    // Find timestamp line (00:00:01,000 --> 00:00:04,000)
    const hasTimestamp = blockLines.findIndex(l => l.includes('-->'));
    if (hasTimestamp !== -1) {
       textLines = blockLines.slice(hasTimestamp + 1);
    } else {
       // if not found, let's just strip numbers if they are single lines
       if (/^\d+$/.test(blockLines[0])) {
         textLines = blockLines.slice(1);
       } else {
         textLines = blockLines;
       }
    }
    
    // Check if the lines contain Japanese characters (Hiragana, Katakana, Kanji)
    // If they do, we should join without spaces to avoid artificial spaces in Japanese words!
    const fullBlockText = blockLines.join('');
    const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(fullBlockText);
    
    let text = '';
    const filteredTextLines = textLines.map(t => t.trim()).filter(Boolean);
    
    for (let i = 0; i < filteredTextLines.length; i++) {
        let l = filteredTextLines[i];
        if (i > 0) {
           const prev = filteredTextLines[i-1];
           if (hasJapanese) {
              if ((prev.endsWith('…') || prev.endsWith('...')) && !/^[\s]/.test(l)) {
                 text += ' ' + l; // add space after ellipsis
              } else {
                 text += l;
              }
           } else {
              text += ' ' + l;
           }
        } else {
           text += l;
        }
    }
    
    // Parse sentences out of this combined subtitle text block
    const sentences = parsePlainText(text);
    // Because SRT lines can be split across times but actually be short standalone phrases
    // we want to push them sequentially. If they're extremely short and end with ellipsis, maybe they could be joined
    // but the simplest is just to push them sequentially as the AI can handle short context.
    sentences.forEach(s => {
       const cleaned = s.trim();
       if (cleaned) lines.push(cleaned);
    });
  }
  
  // Condense single trailing ellipsis blocks if they are too small and the next one continues it? 
  // Too complex, let's trust the AI analysis to deal with short segments correctly now that we don't split by "…"
  
  return lines;
}
