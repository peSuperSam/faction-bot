function chunkText(content) {
  const parts = String(content || '').split(/(?=^#{1,3} )/m).filter((part) => part.trim());
  const chunks = [];

  for (const part of parts) {
    const headerMatch = part.match(/^#{1,3} (.+)/);
    const section = headerMatch ? headerMatch[1].trim() : 'geral';
    const body = part.trim();
    if (body.length < 20) {
      continue;
    }

    const paragraphs = body.split(/\n{2,}/);
    let current = '';
    for (const paragraph of paragraphs) {
      const next = current ? `${current}\n\n${paragraph}` : paragraph;
      if (next.length > 800 && current) {
        chunks.push({ section, content: current.trim() });
        current = paragraph;
      } else {
        current = next;
      }
    }
    if (current.trim()) {
      chunks.push({ section, content: current.trim() });
    }
  }

  return chunks;
}

module.exports = {
  chunkText,
};
