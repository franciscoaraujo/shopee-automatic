import { describe, expect, it } from 'vitest';
import { imageMime, looksLikeMp4, parseProbe } from './media';
import { signMediaUrl, verifyMediaParams } from './signed-url';

const secret = Buffer.alloc(32, 7);
const key = 'accounts/11111111-1111-1111-1111-111111111111/videos/22222222-2222-2222-2222-222222222222/video.mp4';
const params = (url: string) => new URL(url, 'http://x').searchParams;

describe('URLs assinadas', () => {
  it('valida a própria assinatura dentro do prazo', () => {
    const url = signMediaUrl(key, { secret, now: 1_000_000, filename: 'Garrafa v1.mp4', disposition: 'attachment' });
    expect(verifyMediaParams(params(url), { secret, now: 1_000_000 })).toEqual({ objectKey: key, disposition: 'attachment', filename: 'Garrafa v1.mp4' });
  });
  it('recusa URL expirada, adulterada ou assinada com outra chave', () => {
    const url = signMediaUrl(key, { secret, now: 1_000_000, ttlSec: 60 });
    expect(verifyMediaParams(params(url), { secret, now: 1_000_000 + 61_000 })).toBeNull();
    expect(verifyMediaParams(params(url.replace('video.mp4', 'thumb.jpg')), { secret, now: 1_000_000 })).toBeNull();
    expect(verifyMediaParams(params(url.replace('d=inline', 'd=attachment')), { secret, now: 1_000_000 })).toBeNull();
    expect(verifyMediaParams(params(url), { secret: Buffer.alloc(32, 8), now: 1_000_000 })).toBeNull();
  });
  it('só aceita objetos de vídeo/miniatura dentro da pasta de uma conta', () => {
    const url = signMediaUrl('accounts/../../etc/passwd', { secret, now: 1_000_000 });
    expect(verifyMediaParams(params(url), { secret, now: 1_000_000 })).toBeNull();
  });
});

describe('validação de arquivos', () => {
  it('reconhece MP4 pela assinatura ftyp, não pela extensão', () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(20)]);
    expect(looksLikeMp4(mp4)).toBe(true);
    expect(looksLikeMp4(Buffer.from('<html>erro</html>        '))).toBe(false);
  });
  it('identifica imagens JPEG, PNG e WebP', () => {
    expect(imageMime(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10)]))).toBe('image/jpeg');
    expect(imageMime(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(10)]))).toBe('image/png');
    expect(imageMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]))).toBe('image/webp');
    expect(imageMime(Buffer.from('GIF89a........'))).toBeNull();
  });
  it('lê duração e resolução do ffprobe', () => {
    const out = JSON.stringify({ streams: [{ codec_type: 'audio' }, { codec_type: 'video', width: 720, height: 1280 }], format: { duration: '10.0334' } });
    expect(parseProbe(out)).toEqual({ duration: 10.03, width: 720, height: 1280 });
    expect(() => parseProbe(JSON.stringify({ streams: [{ codec_type: 'audio' }], format: {} }))).toThrow(/trilha de vídeo/);
  });
});
