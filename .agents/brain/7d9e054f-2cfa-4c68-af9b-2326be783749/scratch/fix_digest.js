const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../schema.sql');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Replace digest(...) without public. namespace with public.digest(...)
// We look for digest( but not public.digest( or extensions.digest(
content = content.replace(/(?<!public\.|extensions\.)digest\(/g, 'public.digest(');

// 2. Ensure all public.digest(...) calls use 'sha256'::text instead of 'sha256'
// Let's find matches like public.digest(something, 'sha256')
content = content.replace(/public\.digest\(([\s\S]+?),\s*'sha256'\)/g, (match, p1) => {
  // Let's make sure we don't cross multiple statements by checking if p1 contains any semicolons or brackets that don't match
  // Since we use [\s\S]+?, it could be greedy. A safer way is to replace specifically the end: ,'sha256')
  // Let's do a more precise replacement or split it by line.
  return match;
});

// Let's do it line by line:
const lines = content.split('\n');
const updatedLines = lines.map((line, idx) => {
  let updated = line;
  // If line has public.digest and 'sha256' (without ::text)
  if (updated.includes('public.digest(') && updated.includes("'sha256'") && !updated.includes("'sha256'::text")) {
    updated = updated.replace(/'sha256'\)/g, "'sha256'::text)");
  }
  return updated;
});

fs.writeFileSync(filePath, updatedLines.join('\n'), 'utf8');
console.log('Done');
