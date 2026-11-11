// Entrega vídeo e miniatura a partir do armazenamento privado.
// Só responde a URLs assinadas e dentro da validade (geradas pelo servidor para o dono da conta).
// Suporta Range, necessário para o player avançar/retroceder sem baixar o arquivo inteiro.
import { Readable } from 'node:stream';
import { verifyMediaParams } from '@/server/videos/signed-url';
import { getStorage } from '@/server/videos/storage';

export async function GET(request: Request) {
  const media = verifyMediaParams(new URL(request.url).searchParams);
  if (!media) return new Response('Link inválido ou expirado.', { status: 403, headers: { 'Cache-Control': 'no-store' } });

  const range = request.headers.get('range');
  if (range && !/^bytes=\d*-\d*$/.test(range)) return new Response('Range inválido', { status: 416 });

  let obj;
  try {
    obj = await getStorage().get(media.objectKey, range ?? undefined);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') return new Response('Arquivo não encontrado.', { status: 404 });
    if (name === 'InvalidRange') return new Response('Range fora do arquivo', { status: 416 });
    console.error('Falha ao ler mídia', media.objectKey, name);
    return new Response('Falha ao ler o arquivo.', { status: 502 });
  }

  const isVideo = media.objectKey.endsWith('.mp4');
  const headers = new Headers({
    'Content-Type': isVideo ? 'video/mp4' : 'image/jpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (obj.contentLength !== undefined) headers.set('Content-Length', String(obj.contentLength));
  if (obj.contentRange) headers.set('Content-Range', obj.contentRange);
  if (media.disposition === 'attachment') {
    const name = media.filename || (isVideo ? 'video.mp4' : 'thumb.jpg');
    headers.set('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
  }
  return new Response(Readable.toWeb(obj.body) as ReadableStream, { status: obj.partial ? 206 : 200, headers });
}
