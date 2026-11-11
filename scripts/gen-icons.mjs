// Gera src/components/icons.tsx com apenas os Material Symbols (Rounded, peso 400) usados no site.
// Uso: node scripts/gen-icons.mjs  — para adicionar um ícone, inclua o nome em NAMES.
import { readFileSync, writeFileSync } from 'node:fs';

const NAMES = [
  'bolt', 'search', 'link', 'edit_note', 'send', 'tune', 'monitoring', 'lock', 'check', 'check_circle',
  'check_circle-fill', 'arrow_forward', 'arrow_outward', 'keyboard_arrow_down', 'schedule', 'shopping_bag', 'star-fill',
  'groups', 'rocket_launch', 'cloud', 'computer', 'support_agent', 'verified_user', 'close', 'menu', 'error',
  'info', 'download', 'logout', 'filter_alt', 'trending_up', 'mobile', 'dns', 'history', 'percent',
  'sync', 'chat', 'east', 'remove', 'add', 'block', 'forum', 'person', 'mail', 'call', 'arrow_back', 'headphones', 'coffee_maker', 'watch', 'speaker', 'done_all', 'more_vert', 'qr_code_2', 'link_off', 'refresh', 'warning', 'play_arrow', 'open_in_new', 'visibility', 'visibility_off', 'pause_circle', 'cancel', 'key', 'table_view', 'bar_chart', 'dashboard', 'settings', 'cancel-fill', 'error-fill', 'warning-fill', 'pause_circle-fill', 'help',
  'movie', 'smart_display', 'thumb_up', 'thumb_down', 'delete', 'autorenew', 'star', 'image', 'hourglass_top', 'video_library', 'content_copy', 'edit', 'category', 'rate_review', 'add_circle',
];
const dir = 'node_modules/@material-symbols/svg-400/rounded';
const entries = NAMES.map((n) => {
  const svg = readFileSync(`${dir}/${n}.svg`, 'utf8');
  const d = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(' ');
  if (!d) throw new Error(`Ícone sem path: ${n}`);
  return `  '${n.replace('-fill', '_fill')}': '${d}',`;
});

writeFileSync('src/components/icons.tsx', `// Gerado por scripts/gen-icons.mjs — não edite à mão.
// Material Symbols Rounded (Apache-2.0, Google).
const PATHS = {
${entries.join('\n')}
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, className = '', label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      className={\`shrink-0 \${className}\`}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
`);
console.log(`OK: ${NAMES.length} ícones`);
