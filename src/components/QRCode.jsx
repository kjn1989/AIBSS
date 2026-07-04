import React, { useEffect, useState } from 'react';
import QR from 'qrcode';

// テキストをQRコード画像(data URL)に変換して表示する。
// data URL は自己完結なのでCSP(外部ホスト遮断)に抵触しない。
export default function QRCode({ text, size = 220 }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    setErr(false);
    QR.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((u) => { if (alive) setUrl(u); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [text, size]);

  if (err) return <div className="dim small">QRコードを生成できませんでした。</div>;
  if (!url) return <div className="dim small">QR生成中…</div>;
  return <img src={url} width={size} height={size} alt="QRコード" className="qr-img" />;
}
