// Validação do arquivo de vídeo e extração de metadados/miniatura com ffprobe/ffmpeg.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const MAX_VIDEO_BYTES = Number(process.env.VIDEO_MAX_BYTES || 200 * 1024 * 1024);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// MP4/MOV (ISO BMFF): bytes 4–7 = "ftyp". Rejeita HTML de erro, JSON, etc.
export function looksLikeMp4(buf: Buffer): boolean {
  return buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp';
}

export function imageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export type VideoMeta = { duration: number | null; width: number | null; height: number | null };

export function parseProbe(json: string): VideoMeta {
  const data = JSON.parse(json) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
  const v = data.streams?.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('O arquivo não contém trilha de vídeo');
  const d = Number(data.format?.duration);
  return { duration: Number.isFinite(d) ? Math.round(d * 100) / 100 : null, width: v.width ?? null, height: v.height ?? null };
}

// Lê metadados e gera a miniatura (quadro em ~1 s, largura máx. 640 px).
export async function inspectVideo(video: Buffer): Promise<VideoMeta & { thumbnail: Buffer | null }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'aa-video-'));
  try {
    const file = path.join(dir, 'in.mp4');
    const thumb = path.join(dir, 'thumb.jpg');
    await writeFile(file, video);
    const probe = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 60_000 });
    const meta = parseProbe(probe.stdout);
    const at = meta.duration && meta.duration > 2 ? '1' : '0';
    let thumbnail: Buffer | null = null;
    try {
      await run('ffmpeg', ['-v', 'error', '-ss', at, '-i', file, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '4', '-y', thumb], { timeout: 60_000 });
      thumbnail = await readFile(thumb);
    } catch {
      thumbnail = null; // sem miniatura o vídeo continua válido
    }
    return { ...meta, thumbnail };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
