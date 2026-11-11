// Gerador do prompt de vídeo a partir dos dados do produto. Puro: a tela mostra a prévia
// (editável) com a mesma função que o servidor usa.
//
// REGRA: o vídeo apenas IDENTIFICA o produto. Nada de preço, valor, desconto, promoção,
// oferta ou urgência — nem na imagem, nem no texto na tela, nem na narração. O preço fica
// só no registro interno (galeria), nunca no vídeo.
import { FORMATS, LANGUAGES, STYLES, type GenerationOptions, type ProductSnapshot, type VideoFormat } from './videos';

const ORIENTATION: Record<VideoFormat, string> = { '9:16': 'vertical', '16:9': 'horizontal', '1:1': 'quadrado' };

// Nome curto para falar em voz alta: títulos da Shopee são longos e cheios de palavras-chave.
export function spokenName(name: string): string {
  const clean = name.replace(/[\[\]{}()|/\\_*#"“”]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').filter(Boolean);
  return words.slice(0, 6).join(' ').replace(/[\s,.;:!?–-]+$/, '') || 'este produto';
}

// Fala pronta (entre aspas no prompt): modelos de vídeo dizem bem melhor um texto exato.
// Só identifica o produto — sem preço nem promoção.
export function narrationScript(p: ProductSnapshot, language: GenerationOptions['language']): string {
  const name = spokenName(p.name);
  switch (language) {
    case 'en-US': return `Introducing: ${name}.`;
    case 'es-ES': return `Conoce: ${name}.`;
    default: return `Conheça: ${name}.`;
  }
}

// Áudio do vídeo. A trilha sonora vale para todas as opções; "Sem narração" tira só a voz.
function audioText(p: ProductSnapshot, o: GenerationOptions): string {
  const lang = LANGUAGES[o.language];
  const voice = o.voiceInstructions.trim() ? ` Instruções de voz: ${o.voiceInstructions.trim()}.` : '';
  const music = 'Trilha sonora: música de fundo moderna, em volume que não atrapalhe a voz.';
  const line = narrationScript(p, o.language);
  switch (o.narration) {
    case 'none': return `${music}\nSem voz: nenhuma narração falada.`;
    case 'female': return `${music}\nNarração em voz feminina, clara, em ${lang}, dizendo exatamente: "${line}"${voice}`;
    case 'male': return `${music}\nNarração em voz masculina, clara, em ${lang}, dizendo exatamente: "${line}"${voice}`;
    case 'text': return `${music}\nSem voz: mostre apenas o nome do produto em texto curto e legível na tela: "${spokenName(p.name)}"`;
    case 'narrated_subtitles': return `${music}\nNarração em ${lang}, com legendas sincronizadas na tela, dizendo exatamente: "${line}"${voice}`;
  }
}

export function buildVideoPrompt(p: ProductSnapshot, o: GenerationOptions, format: VideoFormat, duration: number): string {
  const lines: string[] = [];
  lines.push(`Crie um vídeo ${ORIENTATION[format]} (${FORMATS[format].label}) de ${duration} segundos que apresente e identifique o produto "${p.name}".`);
  lines.push('');
  lines.push('Mostre o produto:');
  lines.push(p.description?.trim()
    ? p.description.trim()
    : `Use somente o que está no nome do produto e nas imagens de referência: "${p.name}".`);
  lines.push('', 'Estilo visual:', STYLES[o.style].prompt);
  lines.push('', 'Áudio:', audioText(p, o));
  lines.push('');
  lines.push('Produza um vídeo dinâmico, com transições suaves e boa apresentação visual do produto.');
  lines.push('');
  lines.push('Não mostre nem mencione preços, valores, moedas, descontos, promoções, ofertas, cupons, frete ou urgência (como "últimas unidades" ou "tempo limitado") — nem em imagens, nem em textos na tela, nem na narração.');
  lines.push('');
  lines.push('Não invente características, funcionalidades ou benefícios que não estejam presentes nas informações fornecidas.');
  lines.push('');
  lines.push('Não represente o produto de maneira diferente de suas imagens de referência.');
  if (o.extraInstructions.trim()) lines.push('', 'Instruções adicionais:', o.extraInstructions.trim());
  return lines.join('\n');
}
