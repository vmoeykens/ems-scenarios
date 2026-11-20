// Local QR code (no network): qrcode-generator, error correction L (same as segno error="l" in the generator).
import qrcode from "qrcode-generator";

qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s));

export function qrSvg(data: string): string {
  const q = qrcode(0, "L");
  q.addData(data, "Byte");
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

export function QR({ data, size, label }: { data: string; size: string; label: string }) {
  return (
    <figure className="flex flex-col items-center" style={{ width: size }}>
      <div className="w-full aspect-square qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: qrSvg(data) }} />
      <figcaption className="text-xs text-center">{label}</figcaption>
    </figure>
  );
}
