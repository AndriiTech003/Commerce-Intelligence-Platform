function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
}

export function renderMarkdown(source: string): string {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
      if (heading) return `<h${heading[1]!.length + 2}>${inline(heading[2]!)}</h${heading[1]!.length + 2}>`;
      if (trimmed.split('\n').every((line) => /^[-*]\s+/.test(line))) {
        return `<ul>${trimmed
          .split('\n')
          .map((line) => `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`)
          .join('')}</ul>`;
      }
      return `<p>${trimmed.split('\n').map(inline).join('<br/>')}</p>`;
    })
    .join('');
}
