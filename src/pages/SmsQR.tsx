import { QRCodeSVG } from "qrcode.react";

const FROM_NUMBER = import.meta.env.VITE_SENDBLUE_FROM_NUMBER as string | undefined;
const PREFILLED_BODY = "Hi Finnear";

function formatNumber(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (m) return `+1 (${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}

export function SmsQR() {
  if (!FROM_NUMBER) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center text-muted-foreground">
        VITE_SENDBLUE_FROM_NUMBER is not configured.
      </div>
    );
  }

  const smsLink = `sms:${FROM_NUMBER}&body=${encodeURIComponent(PREFILLED_BODY)}`;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 bg-background text-foreground">
      <h1 className="text-2xl font-semibold">Text the Finnear assistant</h1>
      <p className="max-w-sm text-center text-muted-foreground">
        Scan this code with your phone to start a chat over iMessage.
      </p>
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <QRCodeSVG value={smsLink} size={240} level="M" includeMargin={false} />
      </div>
      <a
        href={smsLink}
        className="text-lg font-medium text-primary underline-offset-4 hover:underline"
      >
        {formatNumber(FROM_NUMBER)}
      </a>
    </div>
  );
}
