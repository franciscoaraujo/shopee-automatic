// Gera os tokens de cor do Material Design 3 (src/app/theme.css) a partir de uma cor-semente.
// Uso: node scripts/gen-theme.mjs [#hex]
import { argbFromHex, hexFromArgb, Hct, SchemeFidelity, MaterialDynamicColors } from '@material/material-color-utilities';
import { writeFileSync } from 'node:fs';

const seed = process.argv[2] || '#C2410C';
const roles = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
  'surface', 'onSurface', 'onSurfaceVariant', 'surfaceDim', 'surfaceBright',
  'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest',
  'outline', 'outlineVariant', 'inverseSurface', 'inverseOnSurface', 'inversePrimary', 'scrim', 'shadow',
];
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const scheme = new SchemeFidelity(Hct.fromInt(argbFromHex(seed)), false, 0);
const lines = roles.map((r) => `  --md-${kebab(r)}: ${hexFromArgb(MaterialDynamicColors[r].getArgb(scheme))};`);
writeFileSync('src/app/theme.css', `/* Gerado por scripts/gen-theme.mjs (semente ${seed}) — não edite à mão */\n:root {\n${lines.join('\n')}\n}\n`);
console.log(lines.join('\n'));
