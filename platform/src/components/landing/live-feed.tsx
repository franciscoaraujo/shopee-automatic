'use client';

// Simulação do grupo de WhatsApp recebendo ofertas no formato real da esteira.
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../icons';

type Offer = {
  hook: string;
  title: string;
  from: string;
  price: string;
  off: number;
  rating: string;
  sold: string;
  link: string;
  icon: IconName;
  tint: string;
  time: string;
};

const OFFERS: Offer[] = [
  { hook: '🚨 ACHADO DO DIA NA SHOPEE! 🚨', title: 'Fone de Ouvido Bluetooth TWS Pro 3', from: 'R$ 99,90', price: 'R$ 60,00', off: 40, rating: '4,8', sold: '12,3 mil', link: 's.shopee.com.br/1LhEho…', icon: 'headphones', tint: 'from-[#f3e7e1] to-[#e6d3ca]', time: '10:30' },
  { hook: '🔥 PROMOÇÃO RELÂMPAGO! 🔥', title: 'Cafeteira Elétrica Inox 1,2 L Programável', from: 'R$ 189,90', price: 'R$ 129,90', off: 32, rating: '4,9', sold: '3,1 mil', link: 's.shopee.com.br/6q2BFv…', icon: 'coffee_maker', tint: 'from-[#e8ece4] to-[#d4dccd]', time: '10:30' },
  { hook: '⚡ OFERTA IMPERDÍVEL ⚡', title: 'Smartwatch Esportivo com Monitor Cardíaco', from: 'R$ 159,00', price: 'R$ 89,90', off: 43, rating: '4,7', sold: '8,4 mil', link: 's.shopee.com.br/1qdVIj…', icon: 'watch', tint: 'from-[#e4e8f3] to-[#cfd6ea]', time: '11:00' },
  { hook: '🛍️ ACHADINHO SHOPEE 🛍️', title: 'Caixa de Som Portátil à Prova d’Água 20 W', from: 'R$ 139,90', price: 'R$ 79,90', off: 43, rating: '4,8', sold: '5,6 mil', link: 's.shopee.com.br/2pQxR4…', icon: 'speaker', tint: 'from-[#f1ebdc] to-[#e2d8bf]', time: '11:00' },
];

function Bubble({ o, animate }: { o: Offer; animate: boolean }) {
  return (
    <article className={`w-[88%] rounded-[10px] rounded-tl-none bg-white p-1.5 pb-5 text-[12.5px] leading-[1.45] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,.13)] relative ${animate ? 'animate-msg-in' : ''}`}>
      <div className={`mb-2 grid h-28 place-items-center rounded-md bg-gradient-to-br ${o.tint}`}>
        <Icon name={o.icon} size={64} className="text-[#5b4a43]/70" />
      </div>
      <div className="space-y-1.5 px-1">
        <p className="font-bold">{o.hook}</p>
        <p>📦 <b>{o.title}</b></p>
        <p>
          ❌ De: <s className="text-[#667781]">{o.from}</s>
          <br />✅ <b>Por: {o.price}</b> (-{o.off}% OFF)
          <br />⭐ {o.rating} | 🛒 +{o.sold} vendidos
        </p>
        <p>
          👉 <b>COMPRE AQUI:</b> <span className="text-[#027eb5] underline">{o.link}</span>
        </p>
      </div>
      <span className="absolute bottom-1 right-2 flex items-center gap-0.5 text-[10.5px] text-[#667781]">
        {o.time} <Icon name="done_all" size={14} className="text-[#53bdeb]" />
      </span>
    </article>
  );
}

export function LiveFeed() {
  const [count, setCount] = useState(2);

  useEffect(() => {
    // Com movimento reduzido, mantém as duas primeiras mensagens paradas
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setCount((c) => (c >= OFFERS.length ? 1 : c + 1)), 3400);
    return () => clearInterval(t);
  }, []);

  // mostra as duas mensagens mais recentes
  const visible = OFFERS.slice(Math.max(0, count - 2), count);

  return (
    <div className="relative mx-auto w-full max-w-[340px]" aria-label="Simulação de ofertas sendo publicadas em um grupo de WhatsApp" role="img">
      <div className="overflow-hidden rounded-[2.6rem] border-[10px] border-[#1c1716] bg-[#1c1716] shadow-e3">
        {/* barra de status */}
        <div className="flex items-center justify-between bg-wa px-5 pb-1 pt-2 text-[11px] font-semibold text-white/90">
          <span>10:30</span>
          <span className="h-4 w-20 rounded-full bg-[#1c1716]" aria-hidden />
          <span className="tracking-widest">●●●</span>
        </div>
        {/* cabeçalho do grupo */}
        <div className="flex items-center gap-3 bg-wa px-3 pb-3 pt-1 text-white">
          <Icon name="arrow_back" size={20} />
          <span className="grid size-9 place-items-center rounded-full bg-[#f6d9cd] text-[#9b2f00]">
            <Icon name="shopping_bag" size={20} />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[14px] font-semibold">Ofertas do Dia 🛍️</p>
            <p className="truncate text-[11.5px] text-white/75">Você, Ana, Bruno, Carla e mais 244</p>
          </div>
          <Icon name="more_vert" size={20} />
        </div>
        {/* conversa */}
        <div className="flex h-[470px] flex-col justify-end gap-2.5 overflow-hidden bg-wa-chat px-3 py-3" aria-live="off">
          {visible.map((o) => (
            <Bubble key={o.title} o={o} animate />
          ))}
        </div>
      </div>
      <p className="mt-4 flex items-center justify-center gap-2 text-body-s text-on-surface-variant">
        <span className="size-2 rounded-full bg-success animate-pulse-dot" aria-hidden />
        Formato real das mensagens publicadas
      </p>
    </div>
  );
}
