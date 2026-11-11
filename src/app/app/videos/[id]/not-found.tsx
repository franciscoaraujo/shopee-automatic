import { LinkButton } from '@/components/md';
import { Empty } from '../ui';

export default function VideoNotFound() {
  return (
    <div className="rounded-xl border border-outline-variant/70 bg-surface-lowest">
      <Empty icon="video_library" title="Vídeo não encontrado">
        <p>Ele pode ter sido excluído ou pertencer a outra conta.</p>
        <LinkButton href="/app/videos/galeria" size="md" className="mt-4">Voltar para a galeria</LinkButton>
      </Empty>
    </div>
  );
}
