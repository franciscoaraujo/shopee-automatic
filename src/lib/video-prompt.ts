// Gerador do prompt de vídeo a partir dos dados do produto. Puro: a tela mostra a prévia
// (editável) com a mesma função que o servidor usa.
import { FORMATS, LANGUAGES, NARRATIONS, STYLES, type GenerationOptions, type ProductSnapshot, type VideoFormat } from './videos';

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const ORIENTATION: Record<VideoFormat, string> = { '9:16': 'vertical', '16:9': 'horizontal', '1:1': 'quadrado' };

function narrationText(o: GenerationOptions): string {
  const lang = LANGUAGES[o.language];
  const voice = o.voiceInstructions.trim() ? ` Instruções de voz: ${o.voiceInstructions.trim()}.` : '';
  switch (o.narration) {
    case 'none': return 'Sem narração falada; use apenas trilha sonora discreta.';
    case 'female': return `Narração em voz feminina, em ${lang}.${voice}`;
    case 'male': return `Narração em voz masculina, em ${lang}.${voice}`;
    case 'text': return `Sem narração falada; transmita a mensagem com textos curtos e legíveis na tela, em ${lang}.`;
    case 'narrated_subtitles': return `Narração em ${lang} com legendas sincronizadas na tela.${voice}`;
  }
}

export function buildVideoPrompt(p: ProductSnapshot, o: GenerationOptions, format: VideoFormat, duration: number): string {
  const lines: string[] = [];
  lines.push(`Crie um vídeo promocional ${ORIENTATION[format]} (${FORMATS[format].label}) de ${duration} segundos para apresentar o produto "${p.name}".`);
  lines.push('');
  lines.push('Destaque os seguintes benefícios:');
  lines.push(p.description?.trim()
    ? p.description.trim()
    : `Use somente o que está no nome do produto e nas imagens de referência: "${p.name}".`);
  if (p.price) {
    lines.push('', 'Preço atual:', brl(p.price));
  }
  if (p.originalPrice && p.price && p.originalPrice > p.price) {
    lines.push('', 'Preço original:', `${brl(p.originalPrice)}${p.discountRate ? ` (${Math.round(p.discountRate)}% de desconto)` : ''}`);
  }
  lines.push('', 'Estilo visual:', STYLES[o.style].prompt);
  lines.push('', 'Narração:', narrationText(o));
  lines.push('');
  lines.push('Produza um vídeo dinâmico, com transições suaves, apresentação visual do produto, textos legíveis e chamada para ação.');
  lines.push('');
  lines.push('Não invente características, funcionalidades ou benefícios que não estejam presentes nas informações fornecidas.');
  lines.push('');
  lines.push('Não represente o produto de maneira diferente de suas imagens de referência.');
  if (o.extraInstructions.trim()) lines.push('', 'Instruções adicionais:', o.extraInstructions.trim());
  return lines.join('\n');
}

export const narrationNeedsAudio = (o: GenerationOptions) => NARRATIONS[o.narration].needsAudio;
