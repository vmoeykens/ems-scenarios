// Crew-facing card face (paper style, like the cut-out handouts): title, caption, static waveform or body text.
import type { DisplayCard } from "../lib/display/toDisplay.ts";
import { CapnoCard, StripCard, TwelveCard } from "./waves.tsx";

export function CardFace({ card, large = false }: { card: DisplayCard; large?: boolean }) {
  const titleCls = large ? "text-2xl font-bold" : "text-base font-bold";
  const bodyCls = large ? "text-3xl leading-snug" : "text-lg leading-snug";
  return (
    <div className="card-face" data-testid={`card-face-${card.key}`}>
      {card.kind === "tag" ? (
        <>
          <div className={`${large ? "text-lg" : "text-xs"} font-bold uppercase text-cue`}>{card.title}</div>
          <div className={bodyCls}>{card.body}</div>
        </>
      ) : card.kind === "text" ? (
        <>
          <div className={titleCls}>{card.title}</div>
          <div className={`${bodyCls} whitespace-pre-line`}>{card.body}</div>
        </>
      ) : (
        <>
          <div className={titleCls}>{card.title}</div>
          {card.caption && <div className={large ? "text-lg mb-1" : "text-xs mb-1"}>{card.caption}</div>}
          {card.kind === "strip" && (
            <StripCard rhythm={card.rhythm} rate={card.rate} p_rate={card.p_rate} lead={card.lead} st={card.st} seconds={card.seconds} />
          )}
          {card.kind === "12lead" && <TwelveCard rhythm={card.rhythm} rate={card.rate} p_rate={card.p_rate} st={card.st} />}
          {card.kind === "capno" && <CapnoCard pattern={card.pattern} etco2={card.etco2} rr={card.rr} />}
          {card.kind === "image" && <img src={card.src} alt={card.title || "show card image"} className="max-w-full border border-ink" />}
        </>
      )}
    </div>
  );
}
